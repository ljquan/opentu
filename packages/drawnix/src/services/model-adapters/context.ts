import {
  resolveInvocationRoute,
  type ModelRef,
  type ResolvedInvocationRoute,
} from '../../utils/settings-manager';
import type { ModelType } from '../../constants/model-config';
import type { AdapterContext } from './types';

export const getAdapterContextFromSettings = (
  routeType: ModelType,
  modelId?: string | ModelRef | null
): AdapterContext => {
  const route: ResolvedInvocationRoute = resolveInvocationRoute(
    routeType,
    modelId
  );
  return {
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
  };
};
