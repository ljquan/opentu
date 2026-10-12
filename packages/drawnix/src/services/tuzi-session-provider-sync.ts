import {
  getPreviouslyReusedGroups,
  resetTuziProviderVerification,
} from './tuzi-provider-reuse-state';
import { isTuziEmbeddedMode } from './tuzi-embedded-config';
import {
  getTuziSystemToken,
  getTuziSystemUserId,
  hasTuziSystemToken,
  isLocalTuziSession,
} from './tuzi-token-auth';
import { synchronizeTuziManagedProviders } from './tuzi-managed-providers';
import { TuziSessionApiClient, TuziSessionApiError } from './tuzi-session-api';
import { discoverChangedTuziProviderModels } from './tuzi-managed-provider-models';
import {
  providerProfilesSettings,
  settingsManager,
} from '../utils/settings-manager';
import {
  getTuziProviderGroupSelection,
  saveTuziProviderGroupSelection,
} from './tuzi-provider-selection';

let activeSync: Promise<boolean> | null = null;
let activeSyncUserId = '';
let lastSuccessfulSyncAt = 0;
let lastSuccessfulUserId = '';
let lastSuccessfulProfileSignature = '';
let activeProfileSignature = '';
let activeSyncRevision = -1;
let activeSyncToken = '';
let lastSuccessfulToken = '';
let activeSyncDiscoversModels = false;
let lastSuccessfulDiscoveredModels = false;
let syncRevision = 0;
let verifiedLocalUserId = '';
let verifiedLocalToken = '';
let localSyncFailure: { userId: string; token: string; error: Error } | undefined;
const SYNC_CACHE_TTL_MS = 60_000;

export function getLocalTuziSyncFailure(): Error | undefined {
  return localSyncFailure?.userId === getTuziSystemUserId() &&
    localSyncFailure.token === getTuziSystemToken() ? localSyncFailure.error : undefined;
}

export function resetTuziSessionProviderSyncCache(): void {
  syncRevision += 1;
  lastSuccessfulSyncAt = 0;
  lastSuccessfulUserId = '';
  lastSuccessfulToken = '';
  verifiedLocalUserId = '';
  verifiedLocalToken = '';
  localSyncFailure = undefined;
}

export function syncTuziSessionProviders(options?: {
  discoverModels?: boolean;
}): Promise<boolean> {
  if (
    !hasTuziSystemToken() ||
    (!isTuziEmbeddedMode() && !isLocalTuziSession())
  )
    return Promise.resolve(false);
  const currentUserId = getTuziSystemUserId();
  const currentToken = getTuziSystemToken();
  const shouldDiscoverModels = options?.discoverModels !== false;
  const signature = () =>
    JSON.stringify([
      getTuziProviderGroupSelection(currentUserId),
      providerProfilesSettings
        .get()
        .map((profile) => [
          profile.id,
          profile.baseUrl,
          profile.apiKey,
          profile.enabled,
        ]),
    ]);
  const currentSignature = signature();
  if (activeSync) {
    if (
      currentUserId === activeSyncUserId &&
      currentToken === activeSyncToken &&
      (!shouldDiscoverModels || activeSyncDiscoversModels) &&
      syncRevision === activeSyncRevision &&
      currentSignature === activeProfileSignature
    )
      return activeSync;
    return activeSync.then(() => syncTuziSessionProviders(options));
  }
  if (
    currentUserId &&
    currentUserId === lastSuccessfulUserId &&
    currentToken === lastSuccessfulToken &&
    (!shouldDiscoverModels || lastSuccessfulDiscoveredModels) &&
    currentSignature === lastSuccessfulProfileSignature &&
    Date.now() - lastSuccessfulSyncAt < SYNC_CACHE_TTL_MS
  ) {
    return Promise.resolve(true);
  }

  activeSyncUserId = currentUserId;
  activeSyncToken = currentToken;
  activeSyncDiscoversModels = shouldDiscoverModels;
  activeSyncRevision = syncRevision;
  activeProfileSignature = currentSignature;
  const requestRevision = syncRevision;
  const isCurrentAccount = () =>
    requestRevision === syncRevision &&
    currentUserId === getTuziSystemUserId() &&
    currentToken === getTuziSystemToken() &&
    hasTuziSystemToken();
  activeSync = (async () => {
    localSyncFailure = undefined;
    try {
      await settingsManager.waitForInitialization();
      if (!isCurrentAccount()) return false;
      if (isLocalTuziSession() &&
          (verifiedLocalUserId !== currentUserId || verifiedLocalToken !== currentToken)) {
        const account = await new TuziSessionApiClient().getAccount();
        if (!isCurrentAccount()) return false;
        if (String(account.id) !== currentUserId) {
          verifiedLocalUserId = '';
          verifiedLocalToken = '';
          return false;
        }
        verifiedLocalUserId = currentUserId;
        verifiedLocalToken = currentToken;
      }
      const userId = getTuziSystemUserId();
      const selectedGroups: string[] | null | undefined = userId
        ? getTuziProviderGroupSelection(userId)
        : undefined;
      const previousApiKeys = new Map(
        providerProfilesSettings
          .get()
          .filter((profile) => profile.id.startsWith('tuzi-managed-'))
          .map((profile) => [profile.id, profile.apiKey])
      );
      const providers = await new TuziSessionApiClient().ensureManagedProviders(
        (selectedGroups || []).filter(
          (group) => !getPreviouslyReusedGroups().includes(group)
        )
      );
      if (!isCurrentAccount()) return false;
      await synchronizeTuziManagedProviders(providers);
      if (!isCurrentAccount()) return false;
      const reusedGroups = providers
        .filter((provider) => provider.source === 'existing')
        .flatMap((provider) => provider.groups || [provider.group]);
      if (reusedGroups.length)
        saveTuziProviderGroupSelection(userId, [
          ...new Set([...(selectedGroups || []), ...reusedGroups]),
        ]);
      if (shouldDiscoverModels) {
        await discoverChangedTuziProviderModels(providers, previousApiKeys);
      }
      if (!isCurrentAccount()) return false;
      lastSuccessfulSyncAt = Date.now();
      lastSuccessfulUserId = userId;
      lastSuccessfulToken = currentToken;
      lastSuccessfulDiscoveredModels = shouldDiscoverModels;
      lastSuccessfulProfileSignature = signature();
      return true;
    } catch (error) {
      if (!isCurrentAccount()) return false;
      lastSuccessfulSyncAt = 0;
      resetTuziProviderVerification();
      // Keep locally persisted groups through transient network/model errors.
      // Clear only when Tuzi explicitly rejects the current account/token;
      // otherwise a refresh could make valid groups disappear permanently.
      const shouldClear =
        error instanceof TuziSessionApiError &&
        ['TOKEN_INVALID', 'ACCOUNT_DISABLED', 'SESSION_EXPIRED'].includes(
          error.code
        );
      if (shouldClear) {
        verifiedLocalUserId = '';
        verifiedLocalToken = '';
        lastSuccessfulUserId = '';
        lastSuccessfulToken = '';
        try {
          await synchronizeTuziManagedProviders([]);
        } catch (clearError) {
          console.warn(
            '[Tuzi] Failed to clear unavailable Session providers:',
            clearError
          );
        }
      }
      console.warn('[Tuzi] Failed to synchronize Session providers:', error);
      if (!shouldClear && isLocalTuziSession()) localSyncFailure = {
        userId: currentUserId, token: currentToken,
        error: error instanceof Error ? error : new Error('Tuzi 同步失败，请稍后重试'),
      };
      // A transport failure does not invalidate the same verified account and
      // unchanged providers. Leave the sync uncached so the next call retries.
      return !shouldClear && isLocalTuziSession() &&
        verifiedLocalUserId === currentUserId && verifiedLocalToken === currentToken &&
        lastSuccessfulUserId === currentUserId && lastSuccessfulToken === currentToken &&
        lastSuccessfulProfileSignature === signature();
    } finally {
      activeSync = null;
      activeSyncUserId = '';
    }
  })();

  return activeSync;
}
