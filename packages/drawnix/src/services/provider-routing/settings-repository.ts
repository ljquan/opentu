import {
  getDefaultAudioModel,
  getDefaultImageModel,
  getDefaultTextModel,
  getDefaultVideoModel,
  getModelConfig,
  ModelVendor,
  type ModelConfig,
  type ModelType,
} from '../../constants/model-config';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_DEFAULT_PROVIDER_NAME,
  TUZI_PROVIDER_DEFAULT_BASE_URL,
  createModelRef,
  geminiSettings,
  providerCatalogsSettings,
  providerProfilesSettings,
  resolveInvocationRoute,
  type ModelRef,
  type ProviderProfile,
} from '../../utils/settings-manager';
import { InvocationPlanner } from './invocation-planner';
import { inferBindingsForProviderCatalog } from './binding-inference';
import { modelPricingService } from '../../utils/model-pricing-service';
import type {
  InvocationPlan,
  InvocationPlanRequest,
  InvocationPlannerRepositories,
  NormalizedModelRef,
  ProviderAuthStrategy,
  ProviderModelBinding,
  ProviderProfileSnapshot,
} from './types';

export interface SettingsInvocationPlannerOptions {
  includeLegacyProfile?: boolean;
  manualBindings?: ProviderModelBinding[];
}

function inferProviderTypeFromBaseUrl(
  baseUrl: string
): ProviderProfile['providerType'] {
  const normalizedBaseUrl = baseUrl.trim().toLowerCase();

  if (
    normalizedBaseUrl.includes('generativelanguage.googleapis.com') ||
    normalizedBaseUrl.includes('vertex.googleapis.com')
  ) {
    return 'gemini-compatible';
  }

  if (
    normalizedBaseUrl.includes('/openai') ||
    normalizedBaseUrl.endsWith('/v1') ||
    normalizedBaseUrl.includes('api.openai.com') ||
    normalizedBaseUrl.includes('api.tu-zi.com')
  ) {
    return 'openai-compatible';
  }

  return 'custom';
}

function inferAuthType(
  baseUrl: string,
  providerType: ProviderProfile['providerType'],
  authType?: ProviderProfile['authType']
): ProviderAuthStrategy {
  if (
    authType === 'bearer' ||
    authType === 'header' ||
    authType === 'query' ||
    authType === 'custom'
  ) {
    return authType;
  }

  return 'bearer';
}

function toProviderProfileSnapshot(
  profile: Pick<
    ProviderProfile,
    | 'id'
    | 'name'
    | 'providerType'
    | 'baseUrl'
    | 'apiKey'
    | 'authType'
    | 'extraHeaders'
  >
): ProviderProfileSnapshot {
  return {
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    authType: inferAuthType(
      profile.baseUrl,
      profile.providerType,
      profile.authType
    ),
    extraHeaders: profile.extraHeaders,
  };
}

function inferVendorFromModelId(modelId: string): ModelVendor {
  const lowerId = modelId.toLowerCase();

  if (lowerId.includes('flux')) return ModelVendor.FLUX;
  if (lowerId.startsWith('mj') || lowerId.includes('midjourney')) {
    return ModelVendor.MIDJOURNEY;
  }
  if (lowerId.includes('suno') || lowerId.includes('chirp')) {
    return ModelVendor.SUNO;
  }
  if (lowerId.includes('kling')) return ModelVendor.KLING;
  if (lowerId.includes('seedance') || lowerId.includes('seedream')) {
    return ModelVendor.DOUBAO;
  }
  if (lowerId.includes('veo')) return ModelVendor.VEO;
  if (
    lowerId.includes('gemini') ||
    lowerId.includes('gemma') ||
    lowerId.includes('imagen')
  ) {
    return ModelVendor.GEMINI;
  }

  return ModelVendor.OTHER;
}

function buildFallbackModelConfig(
  modelId: string,
  type: ModelType
): ModelConfig {
  return {
    id: modelId,
    label: modelId,
    shortLabel: modelId,
    type,
    vendor: inferVendorFromModelId(modelId),
  };
}

function getLegacyModelConfig(modelId: string, type: ModelType): ModelConfig {
  const staticModel = getModelConfig(modelId);
  if (staticModel) {
    return staticModel;
  }
  return buildFallbackModelConfig(modelId, type);
}

function buildLegacyProfileSnapshot(): ProviderProfileSnapshot {
  const gemini = geminiSettings.get();
  const existingLegacyProfile = providerProfilesSettings
    .get()
    .find((profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID);
  const baseUrl = gemini.baseUrl?.trim() || TUZI_PROVIDER_DEFAULT_BASE_URL;
  const providerType =
    existingLegacyProfile?.providerType === 'openai-compatible' ||
    existingLegacyProfile?.providerType === 'gemini-compatible' ||
    existingLegacyProfile?.providerType === 'custom'
      ? existingLegacyProfile.providerType
      : inferProviderTypeFromBaseUrl(baseUrl);

  return {
    id: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    name: TUZI_DEFAULT_PROVIDER_NAME,
    providerType,
    baseUrl,
    apiKey: gemini.apiKey?.trim() || '',
    authType: inferAuthType(
      baseUrl,
      providerType,
      existingLegacyProfile?.authType
    ),
  };
}

function buildLegacyBindings(
  profile: ProviderProfileSnapshot
): ProviderModelBinding[] {
  const gemini = geminiSettings.get();
  const legacyModels: Array<{ modelId: string; type: ModelType }> = [
    {
      modelId:
        gemini.textModelName?.trim() ||
        gemini.chatModel?.trim() ||
        getDefaultTextModel(),
      type: 'text',
    },
    {
      modelId: gemini.audioModelName?.trim() || getDefaultAudioModel(),
      type: 'audio',
    },
    {
      modelId: gemini.imageModelName?.trim() || getDefaultImageModel(),
      type: 'image',
    },
    {
      modelId: gemini.videoModelName?.trim() || getDefaultVideoModel(),
      type: 'video',
    },
  ];

  return inferBindingsForProviderCatalog(
    profile,
    legacyModels.map((entry) => getLegacyModelConfig(entry.modelId, entry.type))
  );
}

function groupBindingsByModel(
  bindings: ProviderModelBinding[]
): Map<string, ProviderModelBinding[]> {
  const grouped = new Map<string, ProviderModelBinding[]>();

  bindings.forEach((binding) => {
    const key = `${binding.profileId}:${binding.modelId}:${binding.operation}`;
    const current = grouped.get(key) || [];
    current.push(binding);
    grouped.set(key, current);
  });

  return grouped;
}

export function listSettingsProviderProfiles(
  options: SettingsInvocationPlannerOptions = {}
): ProviderProfileSnapshot[] {
  const profiles = providerProfilesSettings
    .get()
    .filter((profile) => profile.enabled !== false)
    .filter((profile) => profile.id !== LEGACY_DEFAULT_PROVIDER_PROFILE_ID)
    .map((profile) => toProviderProfileSnapshot(profile));

  if (options.includeLegacyProfile !== false) {
    profiles.unshift(buildLegacyProfileSnapshot());
  }

  return profiles;
}

export function listSettingsModelBindings(
  options: SettingsInvocationPlannerOptions = {}
): ProviderModelBinding[] {
  const profiles = listSettingsProviderProfiles(options);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const catalogBindings = providerCatalogsSettings.get().flatMap((catalog) => {
    const profile = profileById.get(catalog.profileId);
    if (!profile) {
      return [];
    }
    const pricingCache = modelPricingService.getCache(catalog.profileId);
    return inferBindingsForProviderCatalog(
      profile,
      catalog.discoveredModels,
      pricingCache?.modelEndpoints ?? null
    );
  });
  const legacyBindings =
    options.includeLegacyProfile === false
      ? []
      : buildLegacyBindings(
          profileById.get(LEGACY_DEFAULT_PROVIDER_PROFILE_ID) ||
            buildLegacyProfileSnapshot()
        );

  const deduped = new Map<string, ProviderModelBinding>();
  [
    ...catalogBindings,
    ...legacyBindings,
    ...(options.manualBindings || []),
  ].forEach((binding) => {
    deduped.set(binding.id, binding);
  });

  return Array.from(deduped.values());
}

export function createSettingsInvocationPlannerRepositories(
  options: SettingsInvocationPlannerOptions = {}
): InvocationPlannerRepositories {
  return {
    getProviderProfile(profileId: string) {
      return (
        listSettingsProviderProfiles(options).find(
          (profile) => profile.id === profileId
        ) || null
      );
    },
    getModelBindings(modelRef: NormalizedModelRef, operation: ModelType) {
      const groupedBindings = groupBindingsByModel(
        listSettingsModelBindings(options)
      );
      return (
        groupedBindings.get(
          `${modelRef.profileId}:${modelRef.modelId}:${operation}`
        ) || []
      );
    },
  };
}

export function planInvocationFromSettings(
  request: InvocationPlanRequest,
  options: SettingsInvocationPlannerOptions = {}
): InvocationPlan {
  const repositories = createSettingsInvocationPlannerRepositories(options);
  return new InvocationPlanner(repositories).plan(request);
}

export function resolveInvocationPlanFromRoute(
  operation: ModelType,
  requestedModel?: string | ModelRef | null,
  options: SettingsInvocationPlannerOptions = {}
): InvocationPlan | null {
  const route = resolveInvocationRoute(operation, requestedModel);
  const modelRef = createModelRef(route.profileId, route.modelId);

  if (!modelRef) {
    return null;
  }

  try {
    return planInvocationFromSettings(
      {
        operation,
        modelRef,
      },
      options
    );
  } catch {
    return null;
  }
}
