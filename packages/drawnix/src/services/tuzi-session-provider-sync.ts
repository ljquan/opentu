import { isTuziEmbeddedMode } from './tuzi-embedded-config';
import { getTuziSystemUserId, hasTuziSystemToken } from './tuzi-token-auth';
import { synchronizeTuziManagedProviders } from './tuzi-managed-providers';
import { TuziSessionApiClient } from './tuzi-session-api';
import { discoverChangedTuziProviderModels } from './tuzi-managed-provider-models';
import { providerProfilesSettings } from '../utils/settings-manager';
import { getTuziProviderGroupSelection } from './tuzi-provider-selection';

let activeSync: Promise<boolean> | null = null;
let activeSyncUserId = '';
let lastSuccessfulSyncAt = 0;
let lastSuccessfulUserId = '';
const SYNC_CACHE_TTL_MS = 60_000;

export function resetTuziSessionProviderSyncCache(): void {
  lastSuccessfulSyncAt = 0;
  lastSuccessfulUserId = '';
}

export function syncTuziSessionProviders(options?: {
  discoverModels?: boolean;
}): Promise<boolean> {
  if (!isTuziEmbeddedMode() || !hasTuziSystemToken())
    return Promise.resolve(false);
  const currentUserId = getTuziSystemUserId();
  if (activeSync) {
    if (currentUserId === activeSyncUserId) return activeSync;
    return activeSync.then(() => syncTuziSessionProviders(options));
  }
  if (
    currentUserId &&
    currentUserId === lastSuccessfulUserId &&
    Date.now() - lastSuccessfulSyncAt < SYNC_CACHE_TTL_MS
  ) {
    return Promise.resolve(true);
  }

  activeSyncUserId = currentUserId;
  activeSync = (async () => {
    try {
      const userId = getTuziSystemUserId();
      const selectedGroups: string[] | null | undefined = userId
        ? getTuziProviderGroupSelection(userId)
        : undefined;
      if (selectedGroups === null && userId) {
        // Managed Provider keys are browser-global, while the remembered
        // group choice is account-scoped. Never infer a new account's choice
        // from keys that may belong to a previously signed-in user.
        await synchronizeTuziManagedProviders([]);
        lastSuccessfulUserId = userId;
        lastSuccessfulSyncAt = Date.now();
        return true;
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
        await discoverChangedTuziProviderModels(providers, previousApiKeys);
      }
      lastSuccessfulSyncAt = Date.now();
      lastSuccessfulUserId = userId;
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
      activeSyncUserId = '';
    }
  })();

  return activeSync;
}
