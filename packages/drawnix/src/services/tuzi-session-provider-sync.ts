import { isTuziEmbeddedMode } from './tuzi-embedded-config';
import { hasTuziSystemToken } from './tuzi-token-auth';
import { synchronizeTuziManagedProviders } from './tuzi-managed-providers';
import { TuziSessionApiClient } from './tuzi-session-api';
import { discoverChangedTuziProviderModels } from './tuzi-managed-provider-models';
import { providerProfilesSettings } from '../utils/settings-manager';

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
      const previousApiKeys = new Map(
        providerProfilesSettings
          .get()
          .filter((profile) => profile.id.startsWith('tuzi-managed-'))
          .map((profile) => [profile.id, profile.apiKey])
      );
      const providers =
        await new TuziSessionApiClient().ensureManagedProviders();
      await synchronizeTuziManagedProviders(providers);
      if (options?.discoverModels !== false) {
        await discoverChangedTuziProviderModels(providers, previousApiKeys);
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
