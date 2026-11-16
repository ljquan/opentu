import {
  SEEDREAM_FLASH_MODEL_ID,
  SEEDREAM_FLASH_PATH,
  SEEDREAM_FLASH_REQUEST_SCHEMA,
} from '../../constants/seedream-flash';
import type {
  InvocationPlan,
  InvocationPlanRequest,
  InvocationPlannerRepositories,
  NormalizedModelRef,
  ProviderBindingConfidence,
  ProviderModelBinding,
  ProviderProfileSnapshot,
  ProviderProtocol,
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

function normalizePreferredRequestSchemas(
  preferredRequestSchema?: string | readonly string[] | null
): string[] {
  const rawValues = Array.isArray(preferredRequestSchema)
    ? preferredRequestSchema
    : preferredRequestSchema
    ? [preferredRequestSchema]
    : [];

  return rawValues
    .map((schema) => schema.trim())
    .filter((schema) => schema.length > 0);
}

function normalizeRequiredProtocols(
  requiredProtocol?: ProviderProtocol | readonly ProviderProtocol[] | null
): ProviderProtocol[] {
  const rawValues = Array.isArray(requiredProtocol)
    ? requiredProtocol
    : requiredProtocol
    ? [requiredProtocol]
    : [];

  return rawValues
    .map((protocol) => protocol.trim())
    .filter((protocol): protocol is ProviderProtocol => protocol.length > 0);
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

function findPriorityBinding(
  bindings: ProviderModelBinding[],
  profile: ProviderProfileSnapshot
): ProviderModelBinding | undefined {
  if (!profile.preferAsyncImageEndpoint) return undefined;
  if (bindings.some((candidate) => candidate.source === 'manual')) {
    return undefined;
  }
  return bindings.find(
    (candidate) =>
      candidate.operation === 'image' &&
      candidate.protocol === 'openai.async.media' &&
      candidate.requestSchema === 'openai.async.image.form'
  );
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

    const profile = this.repositories.getProviderProfile(
      targetModelRef.profileId
    );
    if (!profile) {
      throw new InvocationPlanningError(
        `Provider profile not found: ${targetModelRef.profileId}`
      );
    }

    const requiredProtocols = normalizeRequiredProtocols(
      request.requiredProtocol
    );
    const bindings = this.repositories
      .getModelBindings(targetModelRef, request.operation)
      .map((binding): ProviderModelBinding => {
        // Older discovery may have persisted a v1 or asynchronous Flash route.
        if (
          binding.modelId !== SEEDREAM_FLASH_MODEL_ID || binding.operation !== 'image' ||
          !['openai.images.generations', 'openai.images.edits', 'openai.async.media'].includes(binding.protocol)
        ) return binding;
        return {
          ...binding,
          protocol: 'openai.images.generations',
          requestSchema: SEEDREAM_FLASH_REQUEST_SCHEMA,
          responseSchema: 'openai.image.data',
          submitPath: SEEDREAM_FLASH_PATH,
          baseUrlStrategy: 'trim-v1',
          pollPathTemplate: undefined,
          metadata: { ...binding.metadata, image: { action: 'generation', maxImageCount: 10, supportsMask: false } },
        };
      })
      .filter(
        (binding) =>
          binding.profileId === targetModelRef.profileId &&
          binding.modelId === targetModelRef.modelId &&
          binding.operation === request.operation &&
          (requiredProtocols.length === 0 ||
            requiredProtocols.includes(binding.protocol))
      )
      .sort(compareBindings);

    if (bindings.length === 0) {
      throw new InvocationPlanningError(
        `No protocol binding for ${targetModelRef.profileId}/${
          targetModelRef.modelId
        }/${request.operation}${
          requiredProtocols.length > 0
            ? ` matching ${requiredProtocols.join(', ')}`
            : ''
        }`
      );
    }

    const preferredSchemas = normalizePreferredRequestSchemas(
      request.preferredRequestSchema
    );
    const manualBinding = bindings.find(
      (candidate) => candidate.source === 'manual'
    );
    const priorityBinding = request.bindingId
      ? undefined
      : findPriorityBinding(bindings, profile);
    const binding = request.bindingId
      ? bindings.find((candidate) => candidate.id === request.bindingId)
      : manualBinding
      ? manualBinding
      : priorityBinding
      ? priorityBinding
      : preferredSchemas.length > 0
      ? bindings.find((candidate) =>
          preferredSchemas.includes(candidate.requestSchema)
        ) || bindings[0]
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
