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
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';
import { resolveInvocationPlanFromRoute } from '../provider-routing';
import type { AdapterContext } from './types';

interface AdapterContextRouteOptions {
  bindingId?: string | null;
  preferredRequestSchema?: string | readonly string[] | null;
}

export const getAdapterContextFromSettings = (
  routeType: ModelType,
  modelId?: string | ModelRef | null,
  options: AdapterContextRouteOptions = {}
): AdapterContext => {
  const plan = resolveInvocationPlanFromRoute(routeType, modelId, options);
  if (plan) {
    return {
      baseUrl: plan.provider.baseUrl,
      operation: routeType,
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
    operation: routeType,
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

export async function sendAdapterRequest(
  context: AdapterContext,
  request: ProviderTransportRequest,
  baseUrlOverride?: string
): Promise<Response> {
  const timeoutMs =
    request.timeoutMs ??
    (context.operation === 'image' ? IMAGE_GENERATION_TIMEOUT_MS : undefined);
  const isSubmissionRequest =
    (request.method || 'GET').toUpperCase() === 'POST';
  const contextResponseObserver = isSubmissionRequest
    ? context.onResponse
    : undefined;
  const providerContext = buildProviderContextFromAdapterContext(
    context,
    baseUrlOverride
  );
  const requestId =
    context.operation === 'image' && context.requestId && isSubmissionRequest
      ? context.requestId
      : undefined;

  if (requestId) {
    await context.onSubmissionAttempt?.();
  }

  return providerTransport.send(providerContext, {
    ...request,
    requestId,
    allowImageSubmissionOutcomeRecovery:
      request.allowImageSubmissionOutcomeRecovery ??
      !context.binding?.pollPathTemplate,
    controlledResponseBody:
      request.controlledResponseBody ?? context.operation === 'image',
    signal: request.signal || context.signal,
    timeoutMs,
    fetcher: context.fetcher || request.fetcher,
    onResponse:
      contextResponseObserver || request.onResponse
        ? async (response) => {
            await contextResponseObserver?.(response);
            await request.onResponse?.(response);
          }
        : undefined,
  });
}
