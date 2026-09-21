import type { ResolvedInvocationRoute } from '../utils/settings-types';
import {
  isTuziManagedProviderProfileId,
  synchronizeTuziManagedProviders,
} from './tuzi-managed-providers';
import {
  requestTuziParentContext,
  type TuziBridgeContext,
} from './tuzi-postmessage-bridge';
import {
  resetTuziSessionProviderSyncCache,
  syncTuziSessionProviders,
} from './tuzi-session-provider-sync';

export interface TuziManagedRoutePreparation {
  context: TuziBridgeContext | null;
  managedRoute: boolean;
}

export async function prepareTuziManagedRoute(
  route: Pick<ResolvedInvocationRoute, 'profileId' | 'apiKey'>
): Promise<TuziManagedRoutePreparation> {
  const managedRoute = isTuziManagedProviderProfileId(route.profileId);
  if (route.apiKey && !managedRoute) {
    return { context: null, managedRoute: false };
  }

  const context = await requestTuziParentContext({ refresh: managedRoute });
  if (managedRoute && (!context || context.status !== 'ready')) {
    resetTuziSessionProviderSyncCache();
    await synchronizeTuziManagedProviders([]);
    return { context, managedRoute };
  }

  if (context?.status === 'ready') {
    await syncTuziSessionProviders({ discoverModels: false });
  }
  return { context, managedRoute };
}
