import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearModelAdapters,
  registerModelAdapter,
  resolveAdapterForBinding,
  resolveAdapterForModel,
} from '../model-adapters/registry';
import { ModelVendor } from '../../constants/model-config';
import { inferBindingsForProviderModel } from '../provider-routing';
import type {
  ImageModelAdapter,
  VideoModelAdapter,
} from '../model-adapters/types';
import type { ProviderModelBinding } from '../provider-routing';

function createBinding(
  overrides: Partial<ProviderModelBinding>
): ProviderModelBinding {
  return {
    id: 'binding',
    profileId: 'provider-a',
    modelId: 'gemini-3-pro-image-preview',
    operation: 'image',
    protocol: 'openai.images.generations',
    requestSchema: 'openai.image.basic-json',
    responseSchema: 'openai.image.data',
    submitPath: '/images/generations',
    priority: 100,
    confidence: 'high',
    source: 'template',
    ...overrides,
  };
}

const genericImageAdapter: ImageModelAdapter = {
  id: 'generic-image',
  label: 'Generic Image',
  kind: 'image',
  matchProtocols: ['openai.images.generations', 'google.generateContent'],
  matchRequestSchemas: [
    'openai.image.basic-json',
    'google.generate-content.image-inline',
  ],
  async generateImage() {
    throw new Error('not implemented');
  },
};

const seedreamImageAdapter: ImageModelAdapter = {
  id: 'seedream-image',
  label: 'Seedream Image',
  kind: 'image',
  matchProtocols: ['openai.images.generations'],
  matchRequestSchemas: ['openai.image.seedream-json'],
  async generateImage() {
    throw new Error('not implemented');
  },
};

const gptImageAdapter: ImageModelAdapter = {
  id: 'gpt-image',
  label: 'GPT Image',
  kind: 'image',
  matchRequestSchemas: [
    'openai.image.gpt-generation-json',
    'openai.image.gpt-edit-form',
  ],
  async generateImage() {
    throw new Error('not implemented');
  },
};

const tuziGptImageAdapter: ImageModelAdapter = {
  id: 'tuzi-gpt-image',
  label: 'Tuzi GPT Image',
  kind: 'image',
  matchRequestSchemas: [
    'tuzi.image.gpt-generation-json',
    'tuzi.image.gpt-edit-json',
  ],
  async generateImage() {
    throw new Error('not implemented');
  },
};

const seedanceVideoAdapter: VideoModelAdapter = {
  id: 'seedance-video-adapter',
  label: 'Seedance Video',
  kind: 'video',
  matchProtocols: ['seedance.task'],
  matchRequestSchemas: ['seedance.video.form-auto'],
  supportedModels: [
    'seedance-1.5-pro',
    'seedance-1.0-pro',
    'seedance-1.0-pro-fast',
    'seedance-1.0-lite',
  ],
  matchPredicate(modelConfig) {
    return modelConfig.id.startsWith('seedance-1.');
  },
  async generateVideo() {
    throw new Error('not implemented');
  },
};

const seedance2VideoAdapter: VideoModelAdapter = {
  id: 'seedance-2-video-adapter',
  label: 'Seedance 2.0 Video',
  kind: 'video',
  matchProtocols: ['openai.async.video'],
  matchRequestSchemas: ['doubao.seedance-2.video.content-json'],
  matchPredicate(modelConfig) {
    return modelConfig.id.startsWith('doubao-seedance-2-0-');
  },
  async generateVideo() {
    throw new Error('not implemented');
  },
};

const happyHorseVideoAdapter: VideoModelAdapter = {
  id: 'happyhorse-video',
  label: 'HappyHorse Video',
  kind: 'video',
  matchProtocols: ['happyhorse.video'],
  matchRequestSchemas: ['happyhorse.video.json'],
  async generateVideo() {
    throw new Error('not implemented');
  },
};

const genericVideoAdapter: VideoModelAdapter = {
  id: 'generic-video',
  label: 'Generic Video',
  kind: 'video',
  matchProtocols: ['openai.async.video'],
  matchRequestSchemas: ['openai.video.form-input-reference'],
  matchPredicate(modelConfig) {
    if (modelConfig.type !== 'video') {
      return false;
    }
    const lowerId = modelConfig.id.toLowerCase();
    return (
      !lowerId.includes('kling') &&
      !lowerId.includes('seedance') &&
      !lowerId.includes('happyhorse')
    );
  },
  async generateVideo() {
    throw new Error('not implemented');
  },
};

describe('model adapter registry', () => {
  beforeEach(() => {
    clearModelAdapters();
    registerModelAdapter(genericImageAdapter);
    registerModelAdapter(seedreamImageAdapter);
    registerModelAdapter(gptImageAdapter);
    registerModelAdapter(tuziGptImageAdapter);
    registerModelAdapter(seedanceVideoAdapter);
    registerModelAdapter(seedance2VideoAdapter);
    registerModelAdapter(happyHorseVideoAdapter);
    registerModelAdapter(genericVideoAdapter);
  });

  afterEach(() => {
    clearModelAdapters();
  });

  it('prefers schema-specific adapter for seedream bindings', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'doubao-seedream-5-0-260128',
        requestSchema: 'openai.image.seedream-json',
      }),
      'image'
    );

    expect(adapter?.id).toBe('seedream-image');
  });

  it('routes google generateContent image bindings to the generic image adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        protocol: 'google.generateContent',
        requestSchema: 'google.generate-content.image-inline',
      }),
      'image'
    );

    expect(adapter?.id).toBe('generic-image');
  });

  it('routes official GPT Image schemas to the dedicated adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'gpt-image-2',
        requestSchema: 'openai.image.gpt-generation-json',
      }),
      'image'
    );

    expect(adapter?.id).toBe('gpt-image');
  });

  it('routes official GPT Image edit schemas to the dedicated adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'gpt-image-2',
        protocol: 'openai.images.edits',
        requestSchema: 'openai.image.gpt-edit-form',
        submitPath: '/images/edits',
      }),
      'image'
    );

    expect(adapter?.id).toBe('gpt-image');
  });

  it('routes Tuzi GPT Image schemas to the dedicated Tuzi adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'gpt-image-2',
        requestSchema: 'tuzi.image.gpt-generation-json',
      }),
      'image'
    );

    expect(adapter?.id).toBe('tuzi-gpt-image');
  });

  it('routes Tuzi GPT Image edit schemas to the dedicated Tuzi adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'gpt-image-2',
        requestSchema: 'tuzi.image.gpt-edit-json',
      }),
      'image'
    );

    expect(adapter?.id).toBe('tuzi-gpt-image');
  });

  it('routes Seedance 1.x bindings to the legacy Seedance adapter before generic video handlers', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'seedance-1.5-pro',
        operation: 'video',
        protocol: 'seedance.task',
        requestSchema: 'seedance.video.form-auto',
        responseSchema: 'seedance.video.task',
        submitPath: '/videos',
      }),
      'video'
    );

    expect(adapter?.id).toBe('seedance-video-adapter');
  });

  it('routes Seedance 2.0 content-json bindings to the dedicated adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'doubao-seedance-2-0-260128',
        operation: 'video',
        protocol: 'openai.async.video',
        requestSchema: 'doubao.seedance-2.video.content-json',
        responseSchema: 'openai.async.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
      }),
      'video'
    );

    expect(adapter?.id).toBe('seedance-2-video-adapter');
  });

  it('routes Seedance 2.5 content-json bindings to the dedicated adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'doubao-seedance-2-5-260628',
        operation: 'video',
        protocol: 'openai.async.video',
        requestSchema: 'doubao.seedance-2.video.content-json',
        responseSchema: 'openai.async.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
      }),
      'video'
    );

    expect(adapter?.id).toBe('seedance-2-video-adapter');
  });

  it('keeps Seedance 1.x and 2.0 model IDs on separate adapters', () => {
    expect(resolveAdapterForModel('seedance-1.5-pro', 'video')?.id).toBe(
      'seedance-video-adapter'
    );
    expect(
      resolveAdapterForModel('doubao-seedance-2-0-fast-260128', 'video')?.id
    ).toBe('seedance-2-video-adapter');
  });

  it('routes HappyHorse video schemas to the dedicated adapter', () => {
    const adapter = resolveAdapterForBinding(
      createBinding({
        modelId: 'happyhorse-1.0-r2v',
        operation: 'video',
        protocol: 'happyhorse.video',
        requestSchema: 'happyhorse.video.json',
        responseSchema: 'happyhorse.video.task',
        submitPath: '/videos',
      }),
      'video'
    );

    expect(adapter?.id).toBe('happyhorse-video');
  });

  it('routes Omni Flash video models to the generic async video adapter', () => {
    expect(resolveAdapterForModel('omni-flash', 'video')?.id).toBe(
      'generic-video'
    );
    expect(resolveAdapterForModel('omni-flash-components', 'video')?.id).toBe(
      'generic-video'
    );
  });

  it('routes Omni Flash provider bindings to the generic async video adapter', () => {
    const bindings = inferBindingsForProviderModel(
      {
        id: 'provider-video',
        name: 'Video Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      },
      {
        id: 'omni-flash-components',
        label: 'Gemini Omni Flash Components',
        type: 'video',
        vendor: ModelVendor.GEMINI,
      }
    );
    const binding = bindings.find(
      (candidate) => candidate.protocol === 'openai.async.video'
    );

    expect(binding).toMatchObject({
      modelId: 'omni-flash-components',
      requestSchema: 'openai.video.form-input-reference',
    });
    expect(resolveAdapterForBinding(binding!, 'video')?.id).toBe(
      'generic-video'
    );
  });
});
