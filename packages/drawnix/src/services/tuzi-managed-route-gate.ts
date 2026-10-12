import type { ResolvedInvocationRoute } from '../utils/settings-types';
import {
  isTuziManagedProviderProfileId,
  synchronizeTuziManagedProviders,
} from './tuzi-managed-providers';
import {
  requestTuziParentContext,
  requestTuziParentAuthentication,
  isTuziBridgeConnected,
  getTuziBridgeContext,
  type TuziBridgeContext,
} from './tuzi-postmessage-bridge';
import {
  resetTuziSessionProviderSyncCache,
  syncTuziSessionProviders,
  getLocalTuziSyncFailure,
} from './tuzi-session-provider-sync';
import { getTuziProviderGroupSelection } from './tuzi-provider-selection';
import { isLocalTuziSession, getTuziSystemUserId } from './tuzi-token-auth';

export function canResumeTuziRequest(expectedUserId?: string): boolean {
  if (!isTuziBridgeConnected() && isLocalTuziSession()) {
    return (!expectedUserId || expectedUserId === getTuziSystemUserId()) &&
      Boolean(getTuziProviderGroupSelection(getTuziSystemUserId())?.length);
  }
  if (!isTuziBridgeConnected()) return true;
  const current = getTuziBridgeContext();
  return (
    current?.status === 'ready' &&
    (!expectedUserId || current.userId === expectedUserId) &&
    Boolean(getTuziProviderGroupSelection(current.userId)?.length)
  );
}

export interface TuziManagedRoutePreparation {
  context: TuziBridgeContext | null;
  managedRoute: boolean;
  requiresSetup: boolean;
}

export async function prepareTuziManagedRoute(
  route: Pick<ResolvedInvocationRoute, 'profileId' | 'apiKey'>
): Promise<TuziManagedRoutePreparation> {
  const managedRoute =
    isTuziManagedProviderProfileId(route.profileId) ||
    route.profileId?.startsWith('tuzi-token-') === true;
  const embedded = isTuziBridgeConnected();
  if (route.apiKey && !managedRoute) {
    return { context: null, managedRoute: false, requiresSetup: false };
  }

  if (!embedded && isLocalTuziSession()) {
    const userId = getTuziSystemUserId();
    const synchronized = await syncTuziSessionProviders({ discoverModels: false });
    const failure = getLocalTuziSyncFailure();
    if (!synchronized && failure) throw failure;
    const groups = getTuziProviderGroupSelection(userId) || [];
    const ready = synchronized && isLocalTuziSession() && getTuziSystemUserId() === userId && groups.length > 0;
    return {
      context: ready ? { environment: 'tuzi-api', status: 'ready', userId, groups: groups.map(group => ({ group, displayName: group })) } : null,
      managedRoute,
      requiresSetup: !ready,
    };
  }

  let context = await requestTuziParentContext({
    refresh: managedRoute || embedded,
  });
  if (context?.status === 'unauthenticated') {
    const authenticated = await requestTuziParentAuthentication();
    if (authenticated) {
      context = await requestTuziParentContext({ refresh: true });
    }
  }
  const needsAccount =
    Boolean(context) || embedded || isTuziBridgeConnected() || managedRoute;
  if (needsAccount && (!context || context.status !== 'ready')) {
    resetTuziSessionProviderSyncCache();
    await synchronizeTuziManagedProviders([]);
    return { context, managedRoute, requiresSetup: true };
  }

  if (context?.status === 'ready') {
    const synchronized = await syncTuziSessionProviders({
      discoverModels: false,
    });
    return {
      context,
      managedRoute,
      requiresSetup:
        !synchronized || !getTuziProviderGroupSelection(context.userId)?.length,
    };
  }
  return { context, managedRoute, requiresSetup: false };
}
