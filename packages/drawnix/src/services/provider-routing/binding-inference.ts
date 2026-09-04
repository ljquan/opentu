import {
  isAsyncImageModel,
  ModelVendor,
  type ModelConfig,
} from '../../constants/model-config';
import type { PricingEndpointInfo } from '../../utils/model-pricing-types';
import {
  getSeedance2Capabilities,
  isSeedance2ModelId,
} from '../../utils/seedance-model';
import type { ImageApiCompatibility } from '../../utils/settings-types';
import {
  isTuziGPTImageLegacyAlias,
  OFFICIAL_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
  TUZI_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
} from '../model-adapters/image-request-schemas';
import { isTuziCompatibleBaseUrl } from './tuzi-api-endpoints';
import { inferAllBindingHintsFromEndpoints } from './endpoint-binding-inference';
import type { ProviderModelBinding, ProviderProfileSnapshot } from './types';

function buildBindingId(
  profileId: string,
  modelId: string,
  operation: ProviderModelBinding['operation'],
  protocol: ProviderModelBinding['protocol'],
  requestSchema: string,
  baseUrlStrategy?: ProviderModelBinding['baseUrlStrategy']
): string {
  return [
    profileId,
    modelId,
    operation,
    protocol,
    requestSchema,
    baseUrlStrategy || 'preserve',
  ].join(':');
}

function buildBinding(
  profile: ProviderProfileSnapshot,
  model: ModelConfig,
  binding: Omit<
    ProviderModelBinding,
    'id' | 'profileId' | 'modelId' | 'operation'
  >
): ProviderModelBinding {
  return {
    id: buildBindingId(
      profile.id,
      model.id,
      model.type,
      binding.protocol,
      binding.requestSchema,
      binding.baseUrlStrategy
    ),
    profileId: profile.id,
    modelId: model.id,
    operation: model.type,
    ...binding,
  };
}

function normalizeModelTags(model: ModelConfig): string[] {
  return (model.tags || []).map((tag) => tag.toLowerCase());
}

function matchesAny(lowerValue: string, patterns: string[]): boolean {
  return patterns.some((pattern) => lowerValue.includes(pattern));
}

function isGeminiFamilyModel(model: ModelConfig): boolean {
  if (
    model.vendor === ModelVendor.GEMINI ||
    model.vendor === ModelVendor.GOOGLE
  ) {
    return true;
  }

  return matchesAny(model.id.toLowerCase(), [
    'gemini',
    'gemma',
    'imagen',
    'banana',
    'learnlm',
  ]);
}

function isTuziProviderProfile(profile: ProviderProfileSnapshot): boolean {
  return isTuziBaseUrl(profile.baseUrl);
}

function isMidjourneyModel(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();
  return (
    model.vendor === ModelVendor.MIDJOURNEY ||
    lowerId.startsWith('mj') ||
    lowerId.includes('midjourney') ||
    normalizeModelTags(model).includes('mj')
  );
}

function isFluxModel(model: ModelConfig): boolean {
  return (
    model.vendor === ModelVendor.FLUX || model.id.toLowerCase().includes('flux')
  );
}

const KLING_TEXT2VIDEO_VERSION_OPTIONS = [
  'kling-v3',
  'kling-v2-6',
  'kling-v2-1',
  'kling-v1-6',
  'kling-v1-5',
];

const KLING_IMAGE2VIDEO_VERSION_OPTIONS = [
  'kling-v3',
  'kling-v2-6',
  'kling-v2-1',
  'kling-v1-6',
  'kling-v1-5',
];

const KLING_STANDARD_VERSION_OPTIONS = Array.from(
  new Set([
    ...KLING_TEXT2VIDEO_VERSION_OPTIONS,
    ...KLING_IMAGE2VIDEO_VERSION_OPTIONS,
  ])
);

function isKlingO1Model(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();
  return (
    lowerId === 'kling-video-o1' ||
    lowerId === 'kling-video-o1-edit' ||
    lowerId.startsWith('kling-video-o1-')
  );
}

function isStandardKlingVideoModel(model: ModelConfig): boolean {
  if (model.type !== 'video' || isKlingO1Model(model)) {
    return false;
  }

  const lowerId = model.id.toLowerCase();
  return (
    lowerId === 'kling_video' ||
    /^kling-v\d(?:[-.]\d+)?$/.test(lowerId) ||
    (model.vendor === ModelVendor.KLING && lowerId.includes('kling'))
  );
}

function isSeedreamModel(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();
  return (
    lowerId.includes('seedream') ||
    normalizeModelTags(model).includes('seedream')
  );
}

function isGptImageModel(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();
  return (
    lowerId.startsWith('gpt-image') ||
    lowerId === 'chatgpt-image-latest' ||
    (model.vendor === ModelVendor.GPT && lowerId.includes('gpt-image'))
  );
}

function isSeedanceModel(model: ModelConfig): boolean {
  return model.id.toLowerCase().includes('seedance');
}

function isSeedance2Model(model: ModelConfig): boolean {
  return isSeedance2ModelId(model.id);
}

function shouldPreferAsyncImageBinding(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): boolean {
  return !!profile.preferAsyncImageEndpoint && model.type === 'image';
}

function isHappyHorseModel(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();
  return (
    model.vendor === ModelVendor.HAPPYHORSE ||
    lowerId.includes('happyhorse') ||
    normalizeModelTags(model).includes('happyhorse')
  );
}

function isSoraModel(model: ModelConfig): boolean {
  return (
    model.vendor === ModelVendor.SORA || model.id.toLowerCase().includes('sora')
  );
}

function isSunoModel(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();
  return (
    lowerId.includes('suno') ||
    lowerId.includes('chirp') ||
    normalizeModelTags(model).includes('suno') ||
    normalizeModelTags(model).includes('audio') ||
    normalizeModelTags(model).includes('music')
  );
}

function isOfficialOpenAIProfile(profile: ProviderProfileSnapshot): boolean {
  return profile.baseUrl.toLowerCase().includes('api.openai.com');
}

function isTuziProfile(profile: ProviderProfileSnapshot): boolean {
  return isTuziBaseUrl(profile.baseUrl);
}

function isTuziBaseUrl(baseUrl: string): boolean {
  return isTuziCompatibleBaseUrl(baseUrl);
}

function normalizeImageApiCompatibilityMode(
  value?: ImageApiCompatibility | string | null
): ImageApiCompatibility {
  if (
    value === 'auto' ||
    value === 'openai-gpt-image' ||
    value === 'tuzi-gpt-image' ||
    value === 'openai-compatible-basic'
  ) {
    return value;
  }

  if (value === 'tuzi-compatible') {
    return 'tuzi-gpt-image';
  }

  return 'auto';
}

function resolveImageApiCompatibility(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): Exclude<ImageApiCompatibility, 'auto'> {
  const configured = normalizeImageApiCompatibilityMode(
    profile.imageApiCompatibility
  );

  if (configured !== 'auto') {
    return configured;
  }

  if (isOfficialOpenAIProfile(profile) && isGptImageModel(model)) {
    return 'openai-gpt-image';
  }

  if (
    isTuziProfile(profile) &&
    (isGptImageModel(model) || isTuziGPTImageLegacyAlias(model.id))
  ) {
    return 'tuzi-gpt-image';
  }

  return 'openai-compatible-basic';
}

function hasAnyTag(model: ModelConfig, candidates: string[]): boolean {
  const tags = normalizeModelTags(model);
  return candidates.some((candidate) => tags.includes(candidate));
}

function isLikelyVisionCapableTextModel(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();

  if (
    hasAnyTag(model, [
      'vision',
      'multimodal',
      'vl',
      'image-input',
      'image-understanding',
    ])
  ) {
    return true;
  }

  return matchesAny(lowerId, [
    'gemini',
    'gpt-4o',
    'gpt-4.1',
    'gpt-4.5',
    'qwen-vl',
    'llava',
    'internvl',
    'minicpm-v',
    'glm-4v',
    'yi-vl',
    'vision',
    'multimodal',
  ]);
}

function inferTextBindings(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): ProviderModelBinding[] {
  const bindings: ProviderModelBinding[] = [];
  const supportsImageInput =
    profile.providerType === 'gemini-compatible' ||
    profile.providerType === 'openai-compatible' ||
    profile.providerType === 'custom'
      ? true
      : isLikelyVisionCapableTextModel(model);

  if (
    isGeminiFamilyModel(model) &&
    (profile.providerType === 'gemini-compatible' ||
      isTuziProviderProfile(profile))
  ) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'google.generateContent',
        requestSchema: 'google.generate-content.chat-basic',
        responseSchema: 'google.generate-content.candidates',
        submitPath: '/v1beta/models/{model}:generateContent',
        baseUrlStrategy: 'trim-v1',
        metadata: {
          text: {
            supportsImageInput,
            imageInputMode: supportsImageInput
              ? 'google-inline-data'
              : undefined,
            maxImageCount: supportsImageInput ? 6 : undefined,
            capabilitySource: supportsImageInput ? 'template' : 'heuristic',
            capabilityConfidence: supportsImageInput ? 'high' : 'low',
          },
        },
        priority: 400,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (profile.providerType === 'openai-compatible') {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'openai.chat.completions',
        requestSchema: 'openai.chat.messages',
        responseSchema: 'openai.chat.choices',
        submitPath: '/chat/completions',
        metadata: {
          text: {
            supportsImageInput,
            imageInputMode: supportsImageInput ? 'openai-image_url' : undefined,
            maxImageCount: supportsImageInput ? 6 : undefined,
            capabilitySource: supportsImageInput ? 'template' : 'heuristic',
            capabilityConfidence: supportsImageInput ? 'medium' : 'low',
          },
        },
        priority: 300,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (profile.providerType === 'custom') {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'openai.chat.completions',
        requestSchema: 'openai.chat.messages',
        responseSchema: 'openai.chat.choices',
        submitPath: '/chat/completions',
        metadata: {
          text: {
            supportsImageInput,
            imageInputMode: supportsImageInput ? 'openai-image_url' : undefined,
            maxImageCount: supportsImageInput ? 6 : undefined,
            capabilitySource: supportsImageInput ? 'template' : 'heuristic',
            capabilityConfidence: supportsImageInput ? 'medium' : 'low',
          },
        },
        priority: 120,
        confidence: 'medium',
        source: 'template',
      })
    );
  }

  return bindings;
}

function inferImageBindings(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): ProviderModelBinding[] {
  const bindings: ProviderModelBinding[] = [];
  const isGeminiImageModel =
    isGeminiFamilyModel(model) && !isAsyncImageModel(model.id);
  const isGPTImageCompatibleModel =
    isGptImageModel(model) ||
    (isTuziProfile(profile) && isTuziGPTImageLegacyAlias(model.id));

  if (isMidjourneyModel(model)) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'mj.imagine',
        requestSchema: 'mj.imagine.base64-array',
        responseSchema: 'mj.task.status',
        submitPath: '/mj/submit/imagine',
        pollPathTemplate: '/mj/task/{taskId}/fetch',
        priority: 620,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (isFluxModel(model)) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'flux.task',
        requestSchema: 'flux.image.polling-json',
        responseSchema: 'flux.task.status',
        submitPath: '/flux/v1/{model}',
        pollPathTemplate: '/flux/v1/get_result?id={taskId}',
        priority: 610,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (isSeedreamModel(model)) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'openai.images.generations',
        requestSchema: 'openai.image.seedream-json',
        responseSchema: 'openai.image.data',
        submitPath: '/images/generations',
        priority: 520,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (profile.providerType === 'gemini-compatible' && isGeminiImageModel) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'google.generateContent',
        requestSchema: 'google.generate-content.image-inline',
        responseSchema: 'google.generate-content.parts',
        submitPath: '/v1beta/models/{model}:generateContent',
        baseUrlStrategy: 'trim-v1',
        priority: 480,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (
    profile.providerType === 'openai-compatible' ||
    profile.providerType === 'custom'
  ) {
    const genericPriority =
      profile.providerType === 'openai-compatible' ? 320 : 160;
    const genericConfidence =
      profile.providerType === 'openai-compatible' ? 'high' : 'medium';
    const imageApiCompatibility = normalizeImageApiCompatibilityMode(
      profile.imageApiCompatibility
    );
    const resolvedImageApiCompatibility = resolveImageApiCompatibility(
      profile,
      model
    );
    const requestSchema = isSeedreamModel(model)
      ? 'openai.image.seedream-json'
      : isGPTImageCompatibleModel &&
        resolvedImageApiCompatibility === 'openai-gpt-image'
      ? 'openai.image.gpt-generation-json'
      : isGPTImageCompatibleModel &&
        resolvedImageApiCompatibility === 'tuzi-gpt-image'
      ? 'tuzi.image.gpt-generation-json'
      : 'openai.image.basic-json';

    if (shouldPreferAsyncImageBinding(profile, model)) {
      bindings.push(
        buildBinding(profile, model, {
          protocol: 'openai.async.media',
          requestSchema: 'openai.async.image.form',
          responseSchema: 'openai.async.task',
          submitPath: '/videos',
          pollPathTemplate: '/videos/{taskId}',
          priority: genericPriority + 40,
          confidence: genericConfidence,
          source: 'template',
        })
      );
    }

    if (!shouldPreferAsyncImageBinding(profile, model)) {
      bindings.push(
        buildBinding(profile, model, {
          protocol: 'openai.images.generations',
          requestSchema,
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          metadata: {
            image: {
              action: 'generation',
              imageApiCompatibility,
              resolvedImageApiCompatibility,
            },
          },
          priority: genericPriority,
          confidence: genericConfidence,
          source: 'template',
        })
      );
    }

    if (
      !shouldPreferAsyncImageBinding(profile, model) &&
      isGPTImageCompatibleModel &&
      resolvedImageApiCompatibility === 'openai-gpt-image'
    ) {
      bindings.push(
        buildBinding(profile, model, {
          protocol: 'openai.images.edits',
          requestSchema: OFFICIAL_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
          responseSchema: 'openai.image.data',
          submitPath: '/images/edits',
          metadata: {
            image: {
              action: 'edit',
              imageApiCompatibility,
              resolvedImageApiCompatibility,
              maxImageCount: 16,
              supportsMask: true,
            },
          },
          priority: genericPriority - 1,
          confidence: genericConfidence,
          source: 'template',
        })
      );
    }

    if (
      !shouldPreferAsyncImageBinding(profile, model) &&
      isGPTImageCompatibleModel &&
      resolvedImageApiCompatibility === 'tuzi-gpt-image'
    ) {
      bindings.push(
        buildBinding(profile, model, {
          protocol: 'openai.images.edits',
          requestSchema: TUZI_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
          responseSchema: 'openai.image.data',
          submitPath: '/images/edits',
          metadata: {
            image: {
              action: 'edit',
              imageApiCompatibility,
              resolvedImageApiCompatibility,
              maxImageCount: 16,
              supportsMask: false,
            },
          },
          priority: genericPriority - 1,
          confidence: genericConfidence,
          source: 'template',
        })
      );
    }
  }

  return bindings;
}

function inferVideoBindings(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): ProviderModelBinding[] {
  const bindings: ProviderModelBinding[] = [];

  if (isStandardKlingVideoModel(model)) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'kling.video',
        requestSchema: 'kling.video.auto-action-json',
        responseSchema: 'kling.video.task',
        submitPath: '/kling/v1/videos/{action}',
        pollPathTemplate: '/kling/v1/videos/{action}/{taskId}',
        metadata: {
          video: {
            allowedDurations: ['5', '10'],
            defaultDuration: '5',
            durationMode: 'request-param',
            durationField: 'duration',
            strictDurationValidation: true,
            versionField: 'model_name',
            versionOptions: KLING_STANDARD_VERSION_OPTIONS,
            defaultVersion: 'kling-v1-6',
            versionOptionsByAction: {
              text2video: KLING_TEXT2VIDEO_VERSION_OPTIONS,
              image2video: KLING_IMAGE2VIDEO_VERSION_OPTIONS,
            },
          },
        },
        priority: 620,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (isSeedanceModel(model) && !isSeedance2Model(model)) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'seedance.task',
        requestSchema: 'seedance.video.form-auto',
        responseSchema: 'seedance.video.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
        priority: 610,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (isHappyHorseModel(model)) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'happyhorse.video',
        requestSchema: 'happyhorse.video.json',
        responseSchema: 'happyhorse.video.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
        metadata: {
          video: {
            allowedDurations: [
              '3',
              '4',
              '5',
              '6',
              '7',
              '8',
              '9',
              '10',
              '11',
              '12',
              '13',
              '14',
              '15',
            ],
            defaultDuration: '5',
            durationMode: 'request-param',
            durationField: 'parameters.duration',
            strictDurationValidation: false,
            resultMode: 'download-content',
            downloadPathTemplate: '/videos/{taskId}/content',
          },
        },
        priority: 630,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (
    profile.providerType === 'openai-compatible' ||
    profile.providerType === 'custom'
  ) {
    const seedance2Capabilities = getSeedance2Capabilities(model.id);
    const seedance2Metadata = seedance2Capabilities
      ? {
          video: {
            allowedDurations: Array.from(
              {
                length:
                  seedance2Capabilities.maxDuration -
                  seedance2Capabilities.minDuration +
                  1,
              },
              (_, index) =>
                String(seedance2Capabilities.minDuration + index)
            ),
            defaultDuration: String(seedance2Capabilities.defaultDuration),
            durationMode: 'request-param' as const,
            durationField: 'duration',
            strictDurationValidation: true,
            resultMode: 'download-content' as const,
            downloadPathTemplate: '/videos/{taskId}/content',
          },
        }
      : undefined;
    const soraDownloadMetadata = isSoraModel(model)
      ? {
          video: {
            downloadPathTemplate: '/videos/{taskId}/content',
          },
        }
      : undefined;

    bindings.push(
      buildBinding(profile, model, {
        protocol: 'openai.async.video',
        requestSchema: isSeedance2Model(model)
          ? 'doubao.seedance-2.video.content-json'
          : 'openai.video.form-input-reference',
        responseSchema: 'openai.async.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
        metadata:
          seedance2Metadata ||
          (isSoraModel(model) && isOfficialOpenAIProfile(profile)
            ? {
                video: {
                  allowedDurations: ['4', '8', '12'],
                  defaultDuration: '8',
                  durationMode: 'request-param',
                  durationField: 'seconds',
                  strictDurationValidation: true,
                  resultMode: 'download-content',
                  downloadPathTemplate: '/videos/{taskId}/content',
                },
              }
            : soraDownloadMetadata),
        priority: profile.providerType === 'openai-compatible' ? 320 : 160,
        confidence:
          profile.providerType === 'openai-compatible' ? 'high' : 'medium',
        source: 'template',
      })
    );
  }

  return bindings;
}

function inferAudioBindings(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): ProviderModelBinding[] {
  const bindings: ProviderModelBinding[] = [];

  if (
    isSunoModel(model) &&
    (profile.providerType === 'openai-compatible' ||
      profile.providerType === 'custom')
  ) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'tuzi.suno.music',
        requestSchema: 'tuzi.suno.music.submit',
        responseSchema: 'tuzi.suno.task',
        submitPath: '/suno/submit/music',
        pollPathTemplate: '/suno/fetch/{taskId}',
        baseUrlStrategy: 'trim-v1',
        metadata: {
          audio: {
            action: 'music',
            defaultAction: 'music',
            submitPathByAction: {
              music: '/suno/submit/music',
              lyrics: '/suno/submit/lyrics',
            },
            versionField: 'mv',
            versionOptions: [
              'chirp-v5-5',
              'chirp-v5',
              'chirp-v4-5',
              'chirp-v4',
              'chirp-v3-0',
              'chirp-v3-5',
            ],
            defaultVersion: 'chirp-v3-5',
            supportsContinuation: true,
            supportsUploadContinuation: true,
            supportsTags: true,
            supportsTitle: true,
            supportsLyricsPrompt: true,
          },
        },
        priority: profile.providerType === 'openai-compatible' ? 320 : 160,
        confidence:
          profile.providerType === 'openai-compatible' ? 'high' : 'medium',
        source: 'template',
      })
    );
  }

  return bindings;
}

function dedupeBindings(
  bindings: ProviderModelBinding[]
): ProviderModelBinding[] {
  const deduped = new Map<string, ProviderModelBinding>();

  bindings.forEach((binding) => {
    if (!deduped.has(binding.id)) {
      deduped.set(binding.id, binding);
    }
  });

  return Array.from(deduped.values());
}

function shouldUseDiscoveredEndpointHintForModel(
  hint: ReturnType<typeof inferAllBindingHintsFromEndpoints>[number],
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): boolean {
  if (hint.protocol === 'openai.images.edits') {
    return (
      isGptImageModel(model) &&
      resolveImageApiCompatibility(profile, model) === 'openai-gpt-image'
    );
  }

  if (hint.protocol === 'openai.async.media') {
    return model.type === 'image' && !!profile.preferAsyncImageEndpoint;
  }

  if (hint.protocol === 'openai.async.video') {
    return model.type === 'video';
  }

  return true;
}

function getDiscoveredEndpointPriority(
  hint: ReturnType<typeof inferAllBindingHintsFromEndpoints>[number],
  model: ModelConfig
): number {
  if (hint.protocol === 'openai.async.media' && model.type === 'image') {
    return 700;
  }

  return 140;
}

export function inferBindingsForProviderModel(
  profile: ProviderProfileSnapshot,
  model: ModelConfig,
  endpointHints?: Record<string, PricingEndpointInfo> | null
): ProviderModelBinding[] {
  let bindings: ProviderModelBinding[];
  switch (model.type) {
    case 'text':
      bindings = inferTextBindings(profile, model);
      break;
    case 'image':
      bindings = inferImageBindings(profile, model);
      break;
    case 'video':
      bindings = inferVideoBindings(profile, model);
      break;
    case 'audio':
      bindings = inferAudioBindings(profile, model);
      break;
    default:
      bindings = [];
  }

  if (endpointHints) {
    const hints = inferAllBindingHintsFromEndpoints(endpointHints);
    for (const hint of hints) {
      if (!shouldUseDiscoveredEndpointHintForModel(hint, profile, model)) {
        continue;
      }

      const alreadyHasSpecific = bindings.some(
        (b) =>
          b.protocol === hint.protocol &&
          b.confidence === 'high' &&
          b.source === 'template'
      );
      if (!alreadyHasSpecific) {
        bindings.push(
          buildBinding(profile, model, {
            ...hint,
            priority: getDiscoveredEndpointPriority(hint, model),
            confidence: 'medium',
            source: 'discovered',
          })
        );
      }
    }
  }

  return dedupeBindings(bindings);
}

export function inferBindingsForProviderCatalog(
  profile: ProviderProfileSnapshot,
  models: ModelConfig[],
  modelEndpointsMap?: Record<string, Record<string, PricingEndpointInfo>> | null
): ProviderModelBinding[] {
  return dedupeBindings(
    models.flatMap((model) =>
      inferBindingsForProviderModel(
        profile,
        model,
        modelEndpointsMap?.[model.id] ?? null
      )
    )
  );
}
