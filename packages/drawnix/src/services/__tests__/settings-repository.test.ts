import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('settings-repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses the saved legacy provider type and auth type in snapshots', async () => {
    vi.doMock('../../utils/settings-manager', () => ({
      DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai-gpt-image',
      LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'tuzi-gpt-image',
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      TUZI_DEFAULT_PROVIDER_NAME: '兔子 AI',
      TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
      createModelRef: (profileId?: string | null, modelId?: string | null) => ({
        profileId: profileId ?? null,
        modelId: modelId ?? null,
      }),
      geminiSettings: {
        get: () => ({
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          textModelName: 'text-model',
          imageModelName: 'image-model',
          videoModelName: 'video-model',
        }),
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'legacy-default',
            name: 'default 分组',
            providerType: 'custom',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'query',
            enabled: true,
            capabilities: {
              supportsModelsEndpoint: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: true,
              supportsTools: true,
            },
          },
        ],
      },
      providerCatalogsSettings: {
        get: () => [],
      },
      providerPricingCacheSettings: {
        get: () => [],
      },
      resolveInvocationRoute: () => {
        throw new Error('resolveInvocationRoute should not be called');
      },
    }));

    const { listSettingsProviderProfiles } = await import(
      '../provider-routing/settings-repository'
    );

    const profiles = listSettingsProviderProfiles();

    expect(profiles[0]).toMatchObject({
      id: 'legacy-default',
      name: '兔子 AI',
      providerType: 'custom',
      authType: 'query',
      imageApiCompatibility: 'tuzi-gpt-image',
    });
  });

  it('preserves saved legacy image compatibility overrides in snapshots', async () => {
    vi.doMock('../../utils/settings-manager', () => ({
      DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai-gpt-image',
      LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'tuzi-gpt-image',
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      TUZI_DEFAULT_PROVIDER_NAME: '兔子 AI',
      TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
      createModelRef: (profileId?: string | null, modelId?: string | null) => ({
        profileId: profileId ?? null,
        modelId: modelId ?? null,
      }),
      geminiSettings: {
        get: () => ({
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          textModelName: 'text-model',
          imageModelName: 'image-model',
          videoModelName: 'video-model',
        }),
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'legacy-default',
            name: 'default 分组',
            providerType: 'custom',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'query',
            imageApiCompatibility: 'tuzi-gpt-image',
            enabled: true,
            capabilities: {
              supportsModelsEndpoint: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: true,
              supportsTools: true,
            },
          },
        ],
      },
      providerCatalogsSettings: {
        get: () => [],
      },
      providerPricingCacheSettings: {
        get: () => [],
      },
      resolveInvocationRoute: () => {
        throw new Error('resolveInvocationRoute should not be called');
      },
    }));

    const { listSettingsProviderProfiles } = await import(
      '../provider-routing/settings-repository'
    );

    const profiles = listSettingsProviderProfiles();

    expect(profiles[0]).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
  });

  it('includes manual catalog bindings and plans them ahead of inferred bindings', async () => {
    vi.doMock('../../utils/settings-manager', () => ({
      DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai-gpt-image',
      LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'tuzi-gpt-image',
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      TUZI_DEFAULT_PROVIDER_NAME: '兔子 AI',
      TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
      createModelRef: (profileId?: string | null, modelId?: string | null) => ({
        profileId: profileId ?? null,
        modelId: modelId ?? null,
      }),
      geminiSettings: {
        get: () => ({
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          textModelName: 'text-model',
          imageModelName: 'image-model',
          videoModelName: 'video-model',
        }),
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-manual',
            name: 'Manual Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'manual-key',
            authType: 'bearer',
            enabled: true,
            capabilities: {
              supportsModelsEndpoint: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: true,
              supportsAudio: true,
              supportsTools: true,
            },
          },
        ],
      },
      providerCatalogsSettings: {
        get: () => [
          {
            profileId: 'provider-manual',
            discoveredAt: Date.now(),
            discoveredModels: [
              {
                id: 'custom-gpt-image',
                label: 'Custom GPT Image',
                shortLabel: 'Custom GPT Image',
                type: 'image',
                vendor: 'GPT',
                tags: ['runtime', 'manual'],
              },
              {
                id: 'image-2',
                label: 'image-2',
                shortLabel: 'image-2',
                type: 'image',
                vendor: 'OTHER',
                tags: ['runtime', 'manual'],
              },
              {
                id: 'gemini',
                label: 'gemini',
                shortLabel: 'gemini',
                type: 'image',
                vendor: 'GEMINI',
                tags: ['runtime', 'manual'],
              },
              {
                id: 'custom-chat-model',
                label: 'Custom Chat',
                shortLabel: 'Custom Chat',
                type: 'text',
                vendor: 'GPT',
                tags: ['runtime', 'manual'],
              },
              {
                id: 'custom-video-model',
                label: 'Custom Video',
                shortLabel: 'Custom Video',
                type: 'video',
                vendor: 'OTHER',
                tags: ['runtime', 'manual'],
              },
              {
                id: 'custom-audio-model',
                label: 'Custom Audio',
                shortLabel: 'Custom Audio',
                type: 'audio',
                vendor: 'SUNO',
                tags: ['runtime', 'manual', 'suno'],
              },
            ],
            selectedModelIds: [
              'custom-gpt-image',
              'image-2',
              'gemini',
              'custom-chat-model',
              'custom-video-model',
              'custom-audio-model',
            ],
            manualBindings: [
              {
                id: 'provider-manual:custom-gpt-image:image:manual:custom-http',
                modelId: 'custom-gpt-image',
                operation: 'image',
                protocol: 'custom-http',
                requestSchema: 'custom-http',
                responseSchema: 'custom-http.image',
                submitPath: '/render',
                priority: 900,
                confidence: 'high',
                source: 'manual',
                metadata: {
                  manualHttp: {
                    method: 'POST',
                    bodyType: 'json',
                    bodyTemplate: '{"model":"{{model}}","prompt":"{{prompt}}"}',
                    responseKind: 'image',
                    responsePaths: {
                      imageUrls: 'result.images.*.url',
                    },
                  },
                },
              },
              {
                id: 'provider-manual:custom-chat-model:text:manual:openai.chat.messages',
                modelId: 'custom-chat-model',
                operation: 'text',
                protocol: 'openai.chat.completions',
                requestSchema: 'openai.chat.messages',
                responseSchema: 'openai.chat.choices',
                submitPath: '/chat/completions',
                priority: 900,
                confidence: 'high',
                source: 'manual',
              },
              {
                id: 'provider-manual:custom-video-model:video:manual:openai.video.form-input-reference',
                modelId: 'custom-video-model',
                operation: 'video',
                protocol: 'openai.async.video',
                requestSchema: 'openai.video.form-input-reference',
                responseSchema: 'openai.async.task',
                submitPath: '/videos',
                pollPathTemplate: '/videos/{taskId}',
                priority: 900,
                confidence: 'high',
                source: 'manual',
              },
              {
                id: 'provider-manual:custom-audio-model:audio:manual:tuzi.suno.music.submit',
                modelId: 'custom-audio-model',
                operation: 'audio',
                protocol: 'tuzi.suno.music',
                requestSchema: 'tuzi.suno.music.submit',
                responseSchema: 'tuzi.suno.task',
                submitPath: '/suno/submit/music',
                pollPathTemplate: '/suno/fetch/{taskId}',
                baseUrlStrategy: 'trim-v1',
                priority: 900,
                confidence: 'high',
                source: 'manual',
              },
            ],
          },
        ],
      },
      providerPricingCacheSettings: {
        get: () => [],
      },
      resolveInvocationRoute: () => {
        throw new Error('resolveInvocationRoute should not be called');
      },
    }));
    vi.doMock('../../utils/model-pricing-service', () => ({
      modelPricingService: {
        getCache: () => null,
      },
    }));

    const { listSettingsModelBindings, planInvocationFromSettings } =
      await import('../provider-routing/settings-repository');

    const bindings = listSettingsModelBindings({
      includeLegacyProfile: false,
    });
    const manualBinding = bindings.find(
      (binding) =>
        binding.id ===
        'provider-manual:custom-gpt-image:image:manual:custom-http'
    );
    const plan = planInvocationFromSettings(
      {
        operation: 'image',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'custom-gpt-image',
        },
      },
      { includeLegacyProfile: false }
    );
    const inheritedImage2Plan = planInvocationFromSettings(
      {
        operation: 'image',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'image-2',
        },
      },
      { includeLegacyProfile: false }
    );
    const inheritedGeminiPlan = planInvocationFromSettings(
      {
        operation: 'image',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'gemini',
        },
      },
      { includeLegacyProfile: false }
    );
    const textPlan = planInvocationFromSettings(
      {
        operation: 'text',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'custom-chat-model',
        },
      },
      { includeLegacyProfile: false }
    );
    const videoPlan = planInvocationFromSettings(
      {
        operation: 'video',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'custom-video-model',
        },
      },
      { includeLegacyProfile: false }
    );
    const audioPlan = planInvocationFromSettings(
      {
        operation: 'audio',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'custom-audio-model',
        },
      },
      { includeLegacyProfile: false }
    );

    expect(manualBinding).toMatchObject({
      id: 'provider-manual:custom-gpt-image:image:manual:custom-http',
      source: 'manual',
      priority: 900,
      protocol: 'custom-http',
      requestSchema: 'custom-http',
      responseSchema: 'custom-http.image',
      submitPath: '/render',
      metadata: {
        manualHttp: {
          responsePaths: {
            imageUrls: 'result.images.*.url',
          },
        },
      },
    });
    expect(bindings.some((binding) => binding.source === 'template')).toBe(
      true
    );
    expect(plan.binding.id).toBe(manualBinding?.id);
    expect(plan.binding).toMatchObject({
      source: 'manual',
      protocol: 'custom-http',
      requestSchema: 'custom-http',
    });
    expect(inheritedImage2Plan.binding).toMatchObject({
      modelId: 'image-2',
      source: 'manual',
      protocol: 'custom-http',
      requestSchema: 'custom-http',
      submitPath: '/render',
      metadata: manualBinding?.metadata,
    });
    expect(inheritedGeminiPlan.binding).toMatchObject({
      modelId: 'gemini',
      source: 'manual',
      protocol: 'custom-http',
      requestSchema: 'custom-http',
      submitPath: '/render',
      metadata: manualBinding?.metadata,
    });
    expect(textPlan.binding).toMatchObject({
      source: 'manual',
      protocol: 'openai.chat.completions',
      submitPath: '/chat/completions',
    });
    expect(videoPlan.binding).toMatchObject({
      source: 'manual',
      protocol: 'openai.async.video',
      pollPathTemplate: '/videos/{taskId}',
    });
    expect(audioPlan.binding).toMatchObject({
      source: 'manual',
      protocol: 'tuzi.suno.music',
      baseUrlStrategy: 'trim-v1',
    });
  });

  it('does not inherit an ambiguous custom HTTP template', async () => {
    vi.doMock('../../utils/settings-manager', () => ({
      DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai-gpt-image',
      LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'tuzi-gpt-image',
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      TUZI_DEFAULT_PROVIDER_NAME: '兔子 AI',
      TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
      createModelRef: (profileId?: string | null, modelId?: string | null) => ({
        profileId: profileId ?? null,
        modelId: modelId ?? null,
      }),
      geminiSettings: {
        get: () => ({
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          imageModelName: 'image-model',
        }),
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-manual',
            name: 'Manual Provider',
            providerType: 'custom',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'manual-key',
            authType: 'bearer',
            enabled: true,
            capabilities: {},
          },
        ],
      },
      providerCatalogsSettings: {
        get: () => [
          {
            profileId: 'provider-manual',
            discoveredAt: Date.now(),
            discoveredModels: [
              {
                id: 'image2',
                label: 'image2',
                type: 'image',
                vendor: 'OTHER',
              },
              {
                id: 'other-template',
                label: 'other-template',
                type: 'image',
                vendor: 'OTHER',
              },
              {
                id: 'image-2',
                label: 'image-2',
                type: 'image',
                vendor: 'OTHER',
              },
            ],
            selectedModelIds: ['image2', 'other-template', 'image-2'],
            manualBindings: ['image2', 'other-template'].map((modelId) => ({
              id: `provider-manual:${modelId}:image:manual:custom-http`,
              modelId,
              operation: 'image',
              protocol: 'custom-http',
              requestSchema: 'custom-http',
              responseSchema: 'custom-http.image',
              submitPath: '/render',
              priority: 900,
              confidence: 'high',
              source: 'manual',
              metadata: {
                manualHttp: {
                  method: 'POST',
                  bodyType: 'json',
                  bodyTemplate: '{"model":"{{model}}"}',
                  responseKind: 'image',
                },
              },
            })),
          },
        ],
      },
      resolveInvocationRoute: () => {
        throw new Error('resolveInvocationRoute should not be called');
      },
    }));
    vi.doMock('../../utils/model-pricing-service', () => ({
      modelPricingService: { getCache: () => null },
    }));

    const { planInvocationFromSettings } = await import(
      '../provider-routing/settings-repository'
    );

    const plan = planInvocationFromSettings(
      {
        operation: 'image',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'image-2',
        },
      },
      { includeLegacyProfile: false }
    );

    expect(plan.binding.protocol).not.toBe('custom-http');
    expect(plan.binding.source).not.toBe('manual');
  });
});
