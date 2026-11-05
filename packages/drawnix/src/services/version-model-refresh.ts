import {
  providerProfilesSettings,
  settingsManager,
  type ProviderProfile,
} from '../utils/settings-manager';
import {
  buildDiscoverySignature,
  canDiscoverProfileModels,
  runtimeModelDiscovery,
} from '../utils/runtime-model-discovery';
import { discoverProviderModels } from './provider-model-catalog';
import { TUZI_BRIDGE_EVENT } from './tuzi-postmessage-bridge';
import { TUZI_PROVIDER_REUSE_EVENT } from './tuzi-provider-reuse-state';

function eligible(profile: ProviderProfile): boolean {
  // The existing discovery transport uses Bearer authentication. Do not send
  // saved credentials to an endpoint requiring a different auth contract.
  return canDiscoverProfileModels(profile) && profile.authType === 'bearer';
}

function identity(profile: ProviderProfile): string {
  return JSON.stringify([
    profile.id,
    profile.baseUrl,
    profile.apiKey,
    profile.authType,
    profile.pricingUrl,
    profile.pricingGroup,
  ]);
}

/** One attempt per eligible provider identity and version in this page session. */
export class VersionModelRefresh {
  private attempts = new Map<string, Promise<void>>();

  async refresh(version: string): Promise<void> {
    if (!version || version === '0.0.0') return;
    await settingsManager.waitForInitialization();
    for (const profile of providerProfilesSettings.get()) {
      if (!eligible(profile)) continue;
      const state = runtimeModelDiscovery.getState(profile.id);
      if (
        state.lastAutoRefreshVersion === version &&
        state.signature ===
          buildDiscoverySignature(profile.baseUrl, profile.apiKey)
      )
        continue;
      const snapshot = identity(profile);
      const key = `${version}:${snapshot}`;
      const pending = this.attempts.get(key);
      if (pending) {
        await pending;
        continue;
      }
      // Do not compete with manual discovery or initial managed-account setup.
      if (state.status === 'loading') continue;
      const isCurrent = () => {
        const current = providerProfilesSettings
          .get()
          .find((item) => item.id === profile.id);
        return Boolean(
          current && eligible(current) && identity(current) === snapshot
        );
      };
      const run = Promise.resolve().then(async () => {
        if (!isCurrent()) return;
        try {
          await discoverProviderModels(profile, [], {
            refreshForVersion: version,
            forceMarketplaceRefresh: true,
            shouldApply: isCurrent,
          });
        } catch (error) {
          if (
            !isCurrent() ||
            (typeof error === 'object' &&
              error !== null &&
              'name' in error &&
              error.name === 'AbortError')
          )
            return;
          // Keep the cached catalog and avoid exposing a gateway response/key.
          runtimeModelDiscovery.setError(
            profile.id,
            '版本更新后自动获取模型失败，可手动获取或下次打开重试'
          );
        }
      });
      this.attempts.set(key, run);
      await run;
    }
  }
}

const versionModelRefresh = new VersionModelRefresh();

/** Called after the canvas mounts; no polling, focus refresh or retry timer. */
export function startVersionModelRefresh(
  version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
): () => void {
  const refresh = () => {
    void versionModelRefresh.refresh(version).catch(() => {
      // Startup should remain usable even when settings storage is unavailable.
    });
  };
  providerProfilesSettings.addListener(refresh);
  // An embedded Tuzi account may become verified after the initial canvas mount.
  window.addEventListener(TUZI_BRIDGE_EVENT, refresh);
  window.addEventListener(TUZI_PROVIDER_REUSE_EVENT, refresh);
  refresh();
  return () => {
    providerProfilesSettings.removeListener(refresh);
    window.removeEventListener(TUZI_BRIDGE_EVENT, refresh);
    window.removeEventListener(TUZI_PROVIDER_REUSE_EVENT, refresh);
  };
}
