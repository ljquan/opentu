import {
  providerTransport,
  type ProviderTransportRequest,
  type ResolvedProviderContext,
} from '../provider-routing';
import {
  resolveInvocationRoute,
  type ModelRef,
  type ResolvedInvocationRoute,
} from '../../utils/settings-manager';
import type { ModelType } from '../../constants/model-config';
import { resolveInvocationPlanFromRoute } from '../provider-routing';
import type { AdapterContext } from './types';

export const getAdapterContextFromSettings = (
  routeType: ModelType,
  modelId?: string | ModelRef | null
): AdapterContext => {
  const plan = resolveInvocationPlanFromRoute(routeType, modelId);
  if (plan) {
    return {
      baseUrl: plan.provider.baseUrl,
      apiKey: plan.provider.apiKey,
      authType: plan.provider.authType,
      extraHeaders: plan.provider.extraHeaders,
      provider: plan.provider,
      binding: plan.binding,
    };
  }

  const route: ResolvedInvocationRoute = resolveInvocationRoute(
    routeType,
    modelId
  );
  return {
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    authType: 'bearer',
    provider: null,
    binding: null,
  };
};

export function buildProviderContextFromAdapterContext(
  context: AdapterContext,
  baseUrlOverride?: string
): ResolvedProviderContext {
  if (context.provider) {
    return {
      ...context.provider,
      baseUrl: baseUrlOverride || context.provider.baseUrl,
    };
  }

  return {
    profileId: 'runtime',
    profileName: 'Runtime',
    providerType: 'custom',
    baseUrl: baseUrlOverride || context.baseUrl,
    apiKey: context.apiKey || '',
    authType: context.authType || 'bearer',
    extraHeaders: context.extraHeaders,
  };
}

export function sendAdapterRequest(
  context: AdapterContext,
  request: ProviderTransportRequest,
  baseUrlOverride?: string
): Promise<Response> {
  return providerTransport.send(
    buildProviderContextFromAdapterContext(context, baseUrlOverride),
    {
      ...request,
      fetcher: context.fetcher || request.fetcher,
    }
  );
}
