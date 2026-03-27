import type {
  InvocationPlan,
  InvocationPlanRequest,
  InvocationPlannerRepositories,
  NormalizedModelRef,
  ProviderBindingConfidence,
  ProviderModelBinding,
  ProviderProfileSnapshot,
  ResolvedProviderContext,
} from './types';

const CONFIDENCE_WEIGHT: Record<ProviderBindingConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function normalizeModelRef(
  profileId?: string | null,
  modelId?: string | null
): NormalizedModelRef | null {
  const normalizedProfileId = profileId?.trim();
  const normalizedModelId = modelId?.trim();

  if (!normalizedProfileId || !normalizedModelId) {
    return null;
  }

  return {
    profileId: normalizedProfileId,
    modelId: normalizedModelId,
  };
}

function compareBindings(
  left: ProviderModelBinding,
  right: ProviderModelBinding
): number {
  if (right.priority !== left.priority) {
    return right.priority - left.priority;
  }

  const confidenceDiff =
    CONFIDENCE_WEIGHT[right.confidence] - CONFIDENCE_WEIGHT[left.confidence];
  if (confidenceDiff !== 0) {
    return confidenceDiff;
  }

  if (left.source !== right.source) {
    if (left.source === 'manual') return 1;
    if (right.source === 'manual') return -1;
    if (left.source === 'template') return 1;
    if (right.source === 'template') return -1;
  }

  return left.id.localeCompare(right.id, 'en');
}

function buildProviderContext(
  profile: ProviderProfileSnapshot
): ResolvedProviderContext {
  return {
    profileId: profile.id,
    profileName: profile.name,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    authType: profile.authType,
    extraHeaders: profile.extraHeaders,
  };
}

export class InvocationPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvocationPlanningError';
  }
}

export class InvocationPlanner {
  constructor(private readonly repositories: InvocationPlannerRepositories) {}

  plan(request: InvocationPlanRequest): InvocationPlan {
    const targetModelRef =
      normalizeModelRef(
        request.modelRef?.profileId || null,
        request.modelRef?.modelId || null
      ) ||
      normalizeModelRef(
        request.fallbackModelRef?.profileId || null,
        request.fallbackModelRef?.modelId || null
      );

    if (!targetModelRef) {
      throw new InvocationPlanningError(
        `Missing provider-backed model selection for ${request.operation}`
      );
    }

    const profile = this.repositories.getProviderProfile(targetModelRef.profileId);
    if (!profile) {
      throw new InvocationPlanningError(
        `Provider profile not found: ${targetModelRef.profileId}`
      );
    }

    const bindings = this.repositories
      .getModelBindings(targetModelRef, request.operation)
      .filter(
        (binding) =>
          binding.profileId === targetModelRef.profileId &&
          binding.modelId === targetModelRef.modelId &&
          binding.operation === request.operation
      )
      .sort(compareBindings);

    if (bindings.length === 0) {
      throw new InvocationPlanningError(
        `No protocol binding for ${targetModelRef.profileId}/${targetModelRef.modelId}/${request.operation}`
      );
    }

    const binding = request.bindingId
      ? bindings.find((candidate) => candidate.id === request.bindingId)
      : bindings[0];

    if (!binding) {
      throw new InvocationPlanningError(
        `Requested binding not found: ${request.bindingId}`
      );
    }

    return {
      provider: buildProviderContext(profile),
      modelRef: targetModelRef,
      binding,
    };
  }
}

export function planInvocation(
  repositories: InvocationPlannerRepositories,
  request: InvocationPlanRequest
): InvocationPlan {
  return new InvocationPlanner(repositories).plan(request);
}
