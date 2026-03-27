import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearModelAdapters,
  registerModelAdapter,
  resolveAdapterForBinding,
} from '../model-adapters/registry';
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

const seedanceVideoAdapter: VideoModelAdapter = {
  id: 'seedance-video',
  label: 'Seedance Video',
  kind: 'video',
  matchProtocols: ['seedance.task'],
  matchRequestSchemas: ['seedance.video.form-auto'],
  async generateVideo() {
    throw new Error('not implemented');
  },
};

describe('model adapter registry', () => {
  beforeEach(() => {
    clearModelAdapters();
    registerModelAdapter(genericImageAdapter);
    registerModelAdapter(seedreamImageAdapter);
    registerModelAdapter(seedanceVideoAdapter);
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

  it('routes seedance bindings to the seedance adapter before generic video handlers', () => {
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

    expect(adapter?.id).toBe('seedance-video');
  });
});
