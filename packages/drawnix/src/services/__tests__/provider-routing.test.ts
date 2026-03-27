import { describe, expect, it } from 'vitest';
import {
  getTextBindingMaxImageCount,
  inferBindingsForProviderModel,
  InvocationPlanner,
  InvocationPlanningError,
  supportsTextBindingImageInput,
} from '../provider-routing';
import { providerTransport } from '../provider-routing';
import type {
  InvocationPlannerRepositories,
  ProviderModelBinding,
  ProviderProfileSnapshot,
} from '../provider-routing';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';

function createRepositories(params: {
  profiles?: ProviderProfileSnapshot[];
  bindings?: ProviderModelBinding[];
}): InvocationPlannerRepositories {
  const profiles = params.profiles || [];
  const bindings = params.bindings || [];

  return {
    getProviderProfile(profileId) {
      return profiles.find((profile) => profile.id === profileId) || null;
    },
    getModelBindings(modelRef, operation) {
      return bindings.filter(
        (binding) =>
          binding.profileId === modelRef.profileId &&
          binding.modelId === modelRef.modelId &&
          binding.operation === operation
      );
    },
  };
}

describe('provider routing', () => {
  it('plans the highest-priority binding for the selected provider model', () => {
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [
          {
            id: 'provider-a',
            name: 'Provider A',
            providerType: 'openai-compatible',
            baseUrl: 'https://api-a.example.com/v1',
            apiKey: 'key-a',
            authType: 'bearer',
          },
        ],
        bindings: [
          {
            id: 'openai-image',
            profileId: 'provider-a',
            modelId: 'gemini-3-pro-image-preview',
            operation: 'image',
            protocol: 'openai.images.generations',
            requestSchema: 'openai.image.basic-json',
            responseSchema: 'openai.image.basic',
            submitPath: '/images/generations',
            priority: 100,
            confidence: 'high',
            source: 'template',
          },
          {
            id: 'google-image',
            profileId: 'provider-a',
            modelId: 'gemini-3-pro-image-preview',
            operation: 'image',
            protocol: 'google.generateContent',
            requestSchema: 'google.gemini.generate-content.image',
            responseSchema: 'google.gemini.generate-content',
            submitPath: '/v1beta/models/{model}:generateContent',
            baseUrlStrategy: 'trim-v1',
            priority: 50,
            confidence: 'medium',
            source: 'discovered',
          },
        ],
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: 'provider-a',
        modelId: 'gemini-3-pro-image-preview',
      },
    });

    expect(plan.binding.id).toBe('openai-image');
    expect(plan.binding.protocol).toBe('openai.images.generations');
    expect(plan.provider.profileId).toBe('provider-a');
  });

  it('keeps same model ids separate across different providers', () => {
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [
          {
            id: 'provider-a',
            name: 'Provider A',
            providerType: 'openai-compatible',
            baseUrl: 'https://api-a.example.com/v1',
            apiKey: 'key-a',
            authType: 'bearer',
          },
          {
            id: 'provider-b',
            name: 'Provider B',
            providerType: 'gemini-compatible',
            baseUrl: 'https://generativelanguage.googleapis.com',
            apiKey: 'key-b',
            authType: 'bearer',
          },
        ],
        bindings: [
          {
            id: 'provider-a-image',
            profileId: 'provider-a',
            modelId: 'gemini-3-pro-image-preview',
            operation: 'image',
            protocol: 'openai.images.generations',
            requestSchema: 'openai.image.basic-json',
            responseSchema: 'openai.image.basic',
            submitPath: '/images/generations',
            priority: 100,
            confidence: 'high',
            source: 'template',
          },
          {
            id: 'provider-b-image',
            profileId: 'provider-b',
            modelId: 'gemini-3-pro-image-preview',
            operation: 'image',
            protocol: 'google.generateContent',
            requestSchema: 'google.gemini.generate-content.image',
            responseSchema: 'google.gemini.generate-content',
            submitPath: '/v1beta/models/{model}:generateContent',
            baseUrlStrategy: 'trim-v1',
            priority: 100,
            confidence: 'high',
            source: 'template',
          },
        ],
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: 'provider-b',
        modelId: 'gemini-3-pro-image-preview',
      },
    });

    expect(plan.binding.id).toBe('provider-b-image');
    expect(plan.binding.protocol).toBe('google.generateContent');
    expect(plan.provider.profileId).toBe('provider-b');
    expect(plan.provider.authType).toBe('bearer');
  });

  it('throws when no binding exists for the selected operation', () => {
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [
          {
            id: 'provider-a',
            name: 'Provider A',
            providerType: 'openai-compatible',
            baseUrl: 'https://api-a.example.com/v1',
            apiKey: 'key-a',
            authType: 'bearer',
          },
        ],
      })
    );

    expect(() =>
      planner.plan({
        operation: 'video',
        modelRef: {
          profileId: 'provider-a',
          modelId: 'gemini-3-pro-image-preview',
        },
      })
    ).toThrow(InvocationPlanningError);
  });

  it('prepares bearer-auth transport requests', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-a',
        profileName: 'Provider A',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1/',
        apiKey: 'secret',
        authType: 'bearer',
      },
      {
        path: '/images/generations',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    expect(prepared.url).toBe('https://api.example.com/v1/images/generations');
    expect(prepared.headers.Authorization).toBe('Bearer secret');
    expect(prepared.headers['Content-Type']).toBe('application/json');
  });

  it('prepares query-auth transport requests', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-b',
        profileName: 'Provider B',
        providerType: 'gemini-compatible',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'secret',
        authType: 'query',
      },
      {
        path: '/v1beta/models/test:generateContent',
      }
    );

    expect(prepared.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent?key=secret'
    );
  });

  it('trims a trailing /v1 for google-compatible protocol roots', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-b',
        profileName: 'Provider B',
        providerType: 'gemini-compatible',
        baseUrl: 'https://api.tu-zi.com/v1/',
        apiKey: 'secret',
        authType: 'query',
      },
      {
        path: '/v1beta/models/test:generateContent',
        baseUrlStrategy: 'trim-v1',
      }
    );

    expect(prepared.url).toBe(
      'https://api.tu-zi.com/v1beta/models/test:generateContent?key=secret'
    );
  });

  it('infers different bindings for the same model across provider types', () => {
    const model: ModelConfig = {
      id: 'gemini-3-pro-image-preview',
      label: 'Gemini Image',
      type: 'image',
      vendor: ModelVendor.GEMINI,
    };

    const openaiBindings = inferBindingsForProviderModel(
      {
        id: 'provider-a',
        name: 'Provider A',
        providerType: 'openai-compatible',
        baseUrl: 'https://api-a.example.com/v1',
        apiKey: 'key-a',
        authType: 'bearer',
      },
      model
    );
    const geminiBindings = inferBindingsForProviderModel(
      {
        id: 'provider-b',
        name: 'Provider B',
        providerType: 'gemini-compatible',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'key-b',
        authType: 'bearer',
      },
      model
    );

    expect(openaiBindings.map((binding) => binding.protocol)).toContain(
      'openai.images.generations'
    );
    expect(geminiBindings.map((binding) => binding.protocol)).toContain(
      'google.generateContent'
    );
    expect(
      geminiBindings.find(
        (binding) => binding.protocol === 'google.generateContent'
      )?.baseUrlStrategy
    ).toBe('trim-v1');
  });

  it('infers multiple candidate bindings for multi-interface video models', () => {
    const bindings = inferBindingsForProviderModel(
      {
        id: 'provider-a',
        name: 'Provider A',
        providerType: 'openai-compatible',
        baseUrl: 'https://api-a.example.com/v1',
        apiKey: 'key-a',
        authType: 'bearer',
      },
      {
        id: 'seedance-1.5-pro',
        label: 'Seedance',
        type: 'video',
        vendor: ModelVendor.DOUBAO,
      }
    );

    expect(bindings.map((binding) => binding.protocol)).toEqual([
      'seedance.task',
      'openai.async.video',
    ]);
    expect(bindings.map((binding) => binding.requestSchema)).toEqual([
      'seedance.video.form-auto',
      'openai.video.form-input-reference',
    ]);
  });

  it('marks gemini text bindings as image-capable for gemini-family models', () => {
    const [binding] = inferBindingsForProviderModel(
      {
        id: 'provider-gemini',
        name: 'Gemini Provider',
        providerType: 'gemini-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        authType: 'bearer',
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        type: 'text',
        vendor: ModelVendor.GEMINI,
      }
    );

    expect(binding?.protocol).toBe('google.generateContent');
    expect(supportsTextBindingImageInput(binding)).toBe(true);
    expect(getTextBindingMaxImageCount(binding)).toBe(6);
  });

  it('defaults openai chat bindings to image-capable input mode', () => {
    const [binding] = inferBindingsForProviderModel(
      {
        id: 'provider-openai',
        name: 'OpenAI Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'key',
        authType: 'bearer',
      },
      {
        id: 'deepseek-chat',
        label: 'DeepSeek Chat',
        type: 'text',
        vendor: ModelVendor.DEEPSEEK,
      }
    );

    expect(binding?.protocol).toBe('openai.chat.completions');
    expect(supportsTextBindingImageInput(binding)).toBe(true);
  });
});
