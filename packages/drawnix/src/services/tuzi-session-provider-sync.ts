import { isTuziEmbeddedMode } from './tuzi-embedded-config';
import {
  consumeTuziProviderGroupFromUrl,
  getTuziSystemUserId,
  hasTuziSystemToken,
} from './tuzi-token-auth';
import { synchronizeTuziManagedProviders } from './tuzi-managed-providers';
import { TuziSessionApiClient } from './tuzi-session-api';
import { discoverChangedTuziProviderModels } from './tuzi-managed-provider-models';
import { providerProfilesSettings } from '../utils/settings-manager';
import { getTuziProviderGroupSelection } from './tuzi-provider-selection';

let activeSync: Promise<boolean> | null = null;
let lastSuccessfulSyncAt = 0;
const SYNC_CACHE_TTL_MS = 60_000;

export function resetTuziSessionProviderSyncCache(): void {
  lastSuccessfulSyncAt = 0;
}

export function syncTuziSessionProviders(options?: {
  discoverModels?: boolean;
}): Promise<boolean> {
  if (!isTuziEmbeddedMode() || !hasTuziSystemToken())
    return Promise.resolve(false);
  if (activeSync) return activeSync;
  if (Date.now() - lastSuccessfulSyncAt < SYNC_CACHE_TTL_MS) {
    return Promise.resolve(true);
  }

  activeSync = (async () => {
    try {
      const userId = getTuziSystemUserId();
      let selectedGroups: string[] | null | undefined = userId
        ? getTuziProviderGroupSelection(userId)
        : undefined;
      if (selectedGroups === null && userId) {
        selectedGroups = providerProfilesSettings
          .get()
          .filter((profile) => profile.id.startsWith('tuzi-managed-'))
          .map((profile) => profile.pricingGroup || profile.name)
          .filter(Boolean);
        if (userId && selectedGroups.length > 0) {
          selectedGroups = [...new Set(selectedGroups)];
        }
      }
      if (selectedGroups === null) {
        return true;
      }
      const previousApiKeys = new Map(
        providerProfilesSettings
          .get()
          .filter((profile) => profile.id.startsWith('tuzi-managed-'))
          .map((profile) => [profile.id, profile.apiKey])
      );
      const providers = await new TuziSessionApiClient().ensureManagedProviders(
        selectedGroups
      );
      await synchronizeTuziManagedProviders(providers);
      if (options?.discoverModels !== false) {
        const requestedGroup = consumeTuziProviderGroupFromUrl();
        const requestedProvider = requestedGroup
          ? providers.find((provider) => provider.group === requestedGroup)
          : undefined;
        if (requestedProvider) {
          await discoverChangedTuziProviderModels(providers, previousApiKeys, {
            selectImageModelForProviderId: requestedProvider.id,
          });
        } else {
          await discoverChangedTuziProviderModels(providers, previousApiKeys);
        }
      }
      lastSuccessfulSyncAt = Date.now();
      return true;
    } catch (error) {
      // Never leave stale managed keys visible when the session cannot be
      // verified. A later focus/visibility sync will repopulate them.
      try {
        await synchronizeTuziManagedProviders([]);
      } catch (clearError) {
        console.warn(
          '[Tuzi] Failed to clear unavailable Session providers:',
          clearError
        );
      }
      console.warn('[Tuzi] Failed to synchronize Session providers:', error);
      return false;
    } finally {
      activeSync = null;
    }
  })();

  return activeSync;
}
