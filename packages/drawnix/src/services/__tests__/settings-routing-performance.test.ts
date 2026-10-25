import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import type {
  GeminiSettings,
  ModelRef,
  ProviderCatalog,
  ProviderProfile,
} from '../../utils/settings-types';
import {
  createSettingsInvocationPlanResolver,
  resolveInvocationPlanFromRoute,
} from '../provider-routing/settings-repository';

const settings = vi.hoisted(() => ({
  profiles: [] as ProviderProfile[],
  catalogs: [] as ProviderCatalog[],
  gemini: {} as GeminiSettings,
  readProfiles: vi.fn(),
  readCatalogs: vi.fn(),
}));

vi.mock('../../utils/settings-manager', () => ({
  DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai-gpt-image',
  LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'tuzi-gpt-image',
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_DEFAULT_PROVIDER_NAME: 'Tuzi',
  TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
  createModelRef: (profileId?: string | null, modelId?: string | null) =>
    modelId?.trim()
      ? { profileId: profileId?.trim() || null, modelId: modelId.trim() }
      : null,
  geminiSettings: { get: () => structuredClone(settings.gemini) },
  providerProfilesSettings: { get: settings.readProfiles },
  providerCatalogsSettings: { get: settings.readCatalogs },
  resolveInvocationRoute: (
    operation: string,
    requested?: string | ModelRef | null
  ) => {
    const ref =
      typeof requested === 'string'
        ? { profileId: null, modelId: requested }
        : requested;
    const profile = settings.profiles.find(
      (item) => item.id === ref?.profileId
    );
    return {
      routeType: operation,
      modelId: ref?.modelId || settings.gemini.imageModelName,
      profileId: profile?.id || null,
      baseUrl: profile?.baseUrl || settings.gemini.baseUrl,
      apiKey: profile?.apiKey || settings.gemini.apiKey,
    };
  },
}));

vi.mock('../../utils/model-pricing-service', () => ({
  modelPricingService: { getCache: () => null },
}));

function makeProfile(id: string): ProviderProfile {
  return {
    id,
    name: id,
    providerType: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'fixture-key',
    authType: 'bearer',
    enabled: true,
    capabilities: {},
    extraHeaders: { 'X-Fixture': 'original' },
  };
}

function makeModel(
  index: number,
  type: 'image' | 'video' = 'image'
): ModelConfig {
  return {
    id: type === 'image' ? `gpt-image-2-${index}` : `sora-2-${index}`,
    label: `Model ${index}`,
    vendor: ModelVendor.OTHER,
    type,
  };
}

function makeCatalog(
  profileId: string,
  models: ModelConfig[]
): ProviderCatalog {
  return {
    profileId,
    discoveredAt: 1,
    discoveredModels: models,
    selectedModelIds: models.map((model) => model.id),
  };
}

function manualImageBinding(modelId: string) {
  return {
    id: `fixture:${modelId}:manual`,
    modelId,
    operation: 'image' as const,
    protocol: 'custom-http',
    requestSchema: 'custom-http',
    responseSchema: 'custom-http.image',
    submitPath: '/render',
    priority: 900,
    confidence: 'high' as const,
    source: 'manual' as const,
    metadata: {
      manualHttp: {
        method: 'POST' as const,
        bodyType: 'json' as const,
        bodyTemplate: '{"model":"{{model}}"}',
        responseKind: 'image' as const,
      },
    },
  };
}

describe('settings routing batch performance', () => {
  beforeEach(() => {
    settings.profiles = [makeProfile('provider-a')];
    settings.catalogs = [makeCatalog('provider-a', [makeModel(0)])];
    settings.gemini = {
      apiKey: 'legacy-fixture-key',
      baseUrl: 'https://api.example.com/v1',
      imageModelName: 'gpt-image-2',
    } as GeminiSettings;
    settings.readProfiles
      .mockReset()
      .mockImplementation(() => structuredClone(settings.profiles));
    settings.readCatalogs
      .mockReset()
      .mockImplementation(() => structuredClone(settings.catalogs));
  });

  it('matches individual routing while reading a 300-model catalog only once per batch', () => {
    const models = Array.from({ length: 300 }, (_, index) =>
      makeModel(index, index < 200 ? 'image' : 'video')
    );
    settings.catalogs = [makeCatalog('provider-a', models)];
    const started = performance.now();
    const expected = models.map((model) =>
      resolveInvocationPlanFromRoute(model.type, {
        profileId: 'provider-a',
        modelId: model.id,
      })
    );
    const individualMs = performance.now() - started;
    settings.readCatalogs.mockClear();
    settings.readProfiles.mockClear();

    const batchStarted = performance.now();
    const resolve = createSettingsInvocationPlanResolver();
    const actual = models.map((model) =>
      resolve(model.type, { profileId: 'provider-a', modelId: model.id })
    );
    const batchMs = performance.now() - batchStarted;

    expect(actual).toStrictEqual(expected);
    expect(
      actual.every((plan) => plan?.provider.apiKey === 'fixture-key')
    ).toBe(true);
    expect(settings.readCatalogs).toHaveBeenCalledTimes(1);
    expect(settings.readProfiles).toHaveBeenCalledTimes(2);
    console.info(
      `[routing benchmark] 300 models: individual=${individualMs.toFixed(
        1
      )}ms batch=${batchMs.toFixed(1)}ms`
    );
  }, 30000);

  it('preserves provider isolation, disabled providers, missing credentials and manual bindings', () => {
    const models = [makeModel(0), makeModel(1)];
    settings.profiles.push(
      { ...makeProfile('disabled'), enabled: false },
      { ...makeProfile('empty-key'), apiKey: '' },
      makeProfile('provider-b')
    );
    settings.catalogs = settings.profiles.map((profile) =>
      makeCatalog(profile.id, models)
    );
    settings.catalogs[0].manualBindings = [manualImageBinding(models[0].id)];
    const resolve = createSettingsInvocationPlanResolver();

    for (const profile of settings.profiles) {
      for (const model of models) {
        const ref = { profileId: profile.id, modelId: model.id };
        expect(resolve('image', ref)).toStrictEqual(
          resolveInvocationPlanFromRoute('image', ref)
        );
      }
    }
    expect(
      resolve('image', { profileId: 'disabled', modelId: models[0].id })
    ).toBeNull();
    expect(
      resolve('image', { profileId: 'empty-key', modelId: models[0].id })
        ?.provider.apiKey
    ).toBe('');
    expect(
      resolve('image', { profileId: 'provider-a', modelId: models[1].id })
        ?.binding
    ).toMatchObject({
      source: 'manual',
      protocol: 'custom-http',
      submitPath: '/render',
    });
    expect(
      resolve('image', { profileId: 'provider-b', modelId: models[1].id })
        ?.binding.protocol
    ).not.toBe('custom-http');
  });

  it('does not share mutable plan metadata or retain old credentials across batches', () => {
    const catalog = settings.catalogs[0];
    catalog.manualBindings = [manualImageBinding(makeModel(0).id)];
    const ref = { profileId: 'provider-a', modelId: makeModel(0).id };
    const resolve = createSettingsInvocationPlanResolver();
    const first = resolve('image', ref);
    if (!first?.provider.extraHeaders || !first.binding.metadata?.manualHttp) {
      throw new Error('Expected a complete manual binding');
    }
    first.provider.extraHeaders['X-Fixture'] = 'changed';
    first.binding.metadata.manualHttp.bodyTemplate = 'changed';

    expect(resolve('image', ref)?.provider.extraHeaders).toEqual({
      'X-Fixture': 'original',
    });
    expect(
      resolve('image', ref)?.binding.metadata?.manualHttp?.bodyTemplate
    ).toBe('{"model":"{{model}}"}');

    settings.profiles[0].apiKey = 'rotated-fixture-key';
    expect(
      createSettingsInvocationPlanResolver()('image', ref)?.provider.apiKey
    ).toBe('rotated-fixture-key');
    expect(resolveInvocationPlanFromRoute('image', ref)?.provider.apiKey).toBe(
      'rotated-fixture-key'
    );
  });

  it('keeps legacy non-default models and ambiguous manual templates compatible', () => {
    const models = [makeModel(0), makeModel(1), makeModel(2)];
    settings.catalogs = [makeCatalog('provider-a', models)];
    settings.catalogs[0].manualBindings = models
      .slice(0, 2)
      .map((model) => manualImageBinding(model.id));
    const resolve = createSettingsInvocationPlanResolver();
    const ref = { profileId: 'provider-a', modelId: models[2].id };
    expect(resolve('image', ref)).toStrictEqual(
      resolveInvocationPlanFromRoute('image', ref)
    );
    expect(resolve('image', ref)?.binding.protocol).not.toBe('custom-http');
    expect(resolve('image', 'gpt-image-2.5')).toStrictEqual(
      resolveInvocationPlanFromRoute('image', 'gpt-image-2.5')
    );
    expect(resolve('image', 'gpt-image-2.5')?.provider.profileId).toBe(
      'legacy-default'
    );
  });

  it('preserves explicit binding selection and rejects a missing requested binding', () => {
    const modelId = makeModel(0).id;
    const ref = { profileId: 'provider-a', modelId };
    const manualBinding = manualImageBinding(modelId);
    settings.catalogs[0].manualBindings = [manualBinding];
    for (const options of [
      { includeLegacyProfile: false },
      { bindingId: manualBinding.id },
      { bindingId: 'missing-binding' },
      { preferredRequestSchema: 'openai.image.generate-json' },
    ]) {
      expect(
        createSettingsInvocationPlanResolver(options)('image', ref)
      ).toStrictEqual(resolveInvocationPlanFromRoute('image', ref, options));
    }
    expect(
      createSettingsInvocationPlanResolver({ bindingId: 'missing-binding' })(
        'image',
        ref
      )
    ).toBeNull();
  });
});
