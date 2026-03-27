import {
  isAsyncImageModel,
  ModelVendor,
  type ModelConfig,
} from '../../constants/model-config';
import type {
  ProviderModelBinding,
  ProviderProfileSnapshot,
} from './types';

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
    model.vendor === ModelVendor.FLUX ||
    model.id.toLowerCase().includes('flux')
  );
}

function isKlingModel(model: ModelConfig): boolean {
  return (
    model.vendor === ModelVendor.KLING ||
    model.id.toLowerCase().includes('kling')
  );
}

function isSeedreamModel(model: ModelConfig): boolean {
  const lowerId = model.id.toLowerCase();
  return lowerId.includes('seedream') || normalizeModelTags(model).includes('seedream');
}

function isSeedanceModel(model: ModelConfig): boolean {
  return model.id.toLowerCase().includes('seedance');
}

function isSoraModel(model: ModelConfig): boolean {
  return (
    model.vendor === ModelVendor.SORA || model.id.toLowerCase().includes('sora')
  );
}

function isOfficialOpenAIProfile(profile: ProviderProfileSnapshot): boolean {
  return profile.baseUrl.toLowerCase().includes('api.openai.com');
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

  if (profile.providerType === 'gemini-compatible' && isGeminiFamilyModel(model)) {
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
            imageInputMode: supportsImageInput
              ? 'openai-image_url'
              : undefined,
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
            imageInputMode: supportsImageInput
              ? 'openai-image_url'
              : undefined,
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

  if (
    profile.providerType === 'gemini-compatible' &&
    isGeminiFamilyModel(model) &&
    !isAsyncImageModel(model.id)
  ) {
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

  if (profile.providerType === 'openai-compatible' || profile.providerType === 'custom') {
    const genericPriority =
      profile.providerType === 'openai-compatible' ? 320 : 160;
    const genericConfidence =
      profile.providerType === 'openai-compatible' ? 'high' : 'medium';

    if (!isMidjourneyModel(model) && isAsyncImageModel(model.id)) {
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

    if (!isAsyncImageModel(model.id) || isSeedreamModel(model)) {
      bindings.push(
        buildBinding(profile, model, {
          protocol: 'openai.images.generations',
          requestSchema: isSeedreamModel(model)
            ? 'openai.image.seedream-json'
            : 'openai.image.basic-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: genericPriority,
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

  if (isKlingModel(model)) {
    bindings.push(
      buildBinding(profile, model, {
        protocol: 'kling.video',
        requestSchema: 'kling.video.auto-action-json',
        responseSchema: 'kling.video.task',
        submitPath: '/kling/v1/videos/{action}',
        pollPathTemplate: '/kling/v1/videos/{action}/{taskId}',
        priority: 620,
        confidence: 'high',
        source: 'template',
      })
    );
  }

  if (isSeedanceModel(model)) {
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

  if (profile.providerType === 'openai-compatible' || profile.providerType === 'custom') {
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
        requestSchema: 'openai.video.form-input-reference',
        responseSchema: 'openai.async.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
        metadata:
          isSoraModel(model) && isOfficialOpenAIProfile(profile)
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
            : soraDownloadMetadata,
        priority: profile.providerType === 'openai-compatible' ? 320 : 160,
        confidence:
          profile.providerType === 'openai-compatible' ? 'high' : 'medium',
        source: 'template',
      })
    );
  }

  return bindings;
}

function dedupeBindings(bindings: ProviderModelBinding[]): ProviderModelBinding[] {
  const deduped = new Map<string, ProviderModelBinding>();

  bindings.forEach((binding) => {
    if (!deduped.has(binding.id)) {
      deduped.set(binding.id, binding);
    }
  });

  return Array.from(deduped.values());
}

export function inferBindingsForProviderModel(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): ProviderModelBinding[] {
  switch (model.type) {
    case 'text':
      return dedupeBindings(inferTextBindings(profile, model));
    case 'image':
      return dedupeBindings(inferImageBindings(profile, model));
    case 'video':
      return dedupeBindings(inferVideoBindings(profile, model));
    default:
      return [];
  }
}

export function inferBindingsForProviderCatalog(
  profile: ProviderProfileSnapshot,
  models: ModelConfig[]
): ProviderModelBinding[] {
  return dedupeBindings(
    models.flatMap((model) => inferBindingsForProviderModel(profile, model))
  );
}
