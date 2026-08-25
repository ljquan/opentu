import { isTuziEmbeddedMode } from './tuzi-embedded-config';
import { synchronizeTuziManagedProviders } from './tuzi-managed-providers';
import { TuziSessionApiClient, TuziSessionApiError } from './tuzi-session-api';
import { discoverChangedTuziProviderModels } from './tuzi-managed-provider-models';
import { providerProfilesSettings } from '../utils/settings-manager';

let activeSync: Promise<boolean> | null = null;

export function syncTuziSessionProviders(): Promise<boolean> {
  if (!isTuziEmbeddedMode()) return Promise.resolve(false);
  if (activeSync) return activeSync;

  activeSync = (async () => {
    try {
      const previousApiKeys = new Map(
        providerProfilesSettings
          .get()
          .filter((profile) => profile.id.startsWith('tuzi-managed-'))
          .map((profile) => [profile.id, profile.apiKey])
      );
      const providers = await new TuziSessionApiClient().ensureManagedProviders();
      await synchronizeTuziManagedProviders(providers);
      await discoverChangedTuziProviderModels(providers, previousApiKeys);
      return true;
    } catch (error) {
      if (
        error instanceof TuziSessionApiError &&
        (error.code === 'SESSION_EXPIRED' || error.code === 'ACCOUNT_DISABLED')
      ) {
        await synchronizeTuziManagedProviders([]);
      }
      console.warn('[Tuzi] Failed to synchronize Session providers:', error);
      return false;
    } finally {
      activeSync = null;
    }
  })();

  return activeSync;
}
