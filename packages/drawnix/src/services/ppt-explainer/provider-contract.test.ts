import { describe, expect, it, vi } from 'vitest';
import { InvocationPlanner } from '../provider-routing/invocation-planner';
import type {
  InvocationPlan,
  InvocationPlannerRepositories,
  ProviderModelBinding,
  ProviderProfileSnapshot,
} from '../provider-routing/types';
import {
  PPT_EXPLAINER_PROVIDER_PROTOCOL,
  PPT_EXPLAINER_REQUEST_SCHEMA,
  PPT_EXPLAINER_RESPONSE_SCHEMA,
  PptExplainerProviderPreflightError,
  createPptExplainerProviderRouteSnapshot,
  isPptExplainerProviderBinding,
  preflightPptExplainerProvider,
  resolvePptExplainerProviderRouteSnapshot,
  type PptExplainerProviderRequirements,
} from './provider-contract';

const requirements: PptExplainerProviderRequirements = {
  source: 'current_ppt',
  presentationInput: 'slide_images',
  presenterMode: 'dual_voice',
};

function createProfile(
  apiKey = 'provider-secret-key',
  baseUrl = 'https://api.example.com/v1'
): ProviderProfileSnapshot {
  return {
    id: 'provider-a',
    name: 'Provider A',
    providerType: 'custom',
    baseUrl,
    apiKey,
    authType: 'bearer',
    extraHeaders: { 'X-Provider-Secret': 'header-secret' },
  };
}

function createPptExplainerBinding(
  overrides: Partial<ProviderModelBinding> = {}
): ProviderModelBinding {
  return {
    id: 'provider-a:ppt-explainer',
    profileId: 'provider-a',
    modelId: 'ppt-agent',
    operation: 'video',
    protocol: PPT_EXPLAINER_PROVIDER_PROTOCOL,
    requestSchema: PPT_EXPLAINER_REQUEST_SCHEMA,
    responseSchema: PPT_EXPLAINER_RESPONSE_SCHEMA,
    submitPath: '/ppt/jobs',
    pollPathTemplate: '/ppt/jobs/{remoteId}',
    priority: 100,
    confidence: 'high',
    source: 'manual',
    metadata: {
      pptExplainer: {
        capabilities: {
          sources: ['topic', 'current_ppt', 'pptx'],
          presentationInputs: ['pptx', 'slide_images'],
          presenterModes: [
            'single_voice',
            'dual_voice',
            'single_avatar',
            'dual_avatar',
          ],
          finalComposition: true,
        },
        responsePaths: {
          submit: {
            remoteId: 'data.id',
            status: 'data.status',
            error: 'error.message',
          },
          poll: {
            status: 'data.status',
            progress: 'data.progress',
            finalVideoUrl: 'data.video_url',
            error: 'error.message',
          },
          cancel: {
            status: 'data.status',
            error: 'error.message',
          },
        },
        statusMapping: {
          queued: ['queued'],
          processing: ['processing', 'running'],
          completed: ['completed'],
          failed: ['failed'],
          cancelled: ['cancelled'],
        },
        cancel: {
          pathTemplate: '/ppt/jobs/{remoteId}/cancel',
          method: 'POST',
        },
      },
    },
    ...overrides,
  };
}

function createPlan(
  binding = createPptExplainerBinding(),
  profile = createProfile()
): InvocationPlan {
  return {
    provider: {
      profileId: profile.id,
      profileName: profile.name,
      providerType: profile.providerType,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      authType: profile.authType,
      extraHeaders: profile.extraHeaders,
    },
    modelRef: { profileId: profile.id, modelId: binding.modelId },
    binding,
  };
}

describe('PPT explainer provider contract', () => {
  it('requires the explicit protocol instead of selecting a normal video binding', () => {
    const profile = createProfile();
    const normalVideoBinding: ProviderModelBinding = {
      id: 'normal-video',
      profileId: profile.id,
      modelId: 'ppt-agent',
      operation: 'video',
      protocol: 'openai.async.video',
      requestSchema: 'openai.video.form-input-reference',
      responseSchema: 'openai.async.task',
      submitPath: '/videos',
      pollPathTemplate: '/videos/{taskId}',
      priority: 999,
      confidence: 'high',
      source: 'manual',
    };
    const pptBinding = createPptExplainerBinding();
    const repositories: InvocationPlannerRepositories = {
      getProviderProfile: () => profile,
      getModelBindings: () => [normalVideoBinding, pptBinding],
    };

    const plan = new InvocationPlanner(repositories).plan({
      operation: 'video',
      modelRef: { profileId: profile.id, modelId: 'ppt-agent' },
      requiredProtocol: PPT_EXPLAINER_PROVIDER_PROTOCOL,
    });

    expect(plan.binding.id).toBe(pptBinding.id);
    expect(isPptExplainerProviderBinding(plan.binding)).toBe(true);
  });

  it('fails preflight before any remote side effect when the binding is generic', () => {
    const fetcher = vi.fn();
    const binding = createPptExplainerBinding({
      protocol: 'openai.async.video',
      requestSchema: 'openai.video.form-input-reference',
      responseSchema: 'openai.async.task',
    });

    expect(() =>
      preflightPptExplainerProvider(createPlan(binding), requirements)
    ).toThrow(PptExplainerProviderPreflightError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects missing credentials and unsupported presenter modes', () => {
    expect(() =>
      preflightPptExplainerProvider(
        createPlan(createPptExplainerBinding(), createProfile('')),
        requirements
      )
    ).toThrow('API Key 未配置');

    expect(() =>
      preflightPptExplainerProvider(createPlan(), {
        ...requirements,
        presenterMode: 'dual_avatar',
        presentationInput: 'slide_images',
      })
    ).not.toThrow();

    const binding = createPptExplainerBinding();
    const pptExplainerMetadata = binding.metadata?.pptExplainer;
    if (!pptExplainerMetadata) {
      throw new Error('测试 binding 缺少 PPT 讲解能力');
    }
    binding.metadata = {
      ...binding.metadata,
      pptExplainer: {
        ...pptExplainerMetadata,
        capabilities: {
          ...pptExplainerMetadata.capabilities,
          presenterModes: ['single_voice'],
        },
      },
    };
    expect(() =>
      preflightPptExplainerProvider(createPlan(binding), requirements)
    ).toThrow('不支持 dual_voice');
  });

  it('binds the canonical base URL while allowing API key rotation', () => {
    const preflight = preflightPptExplainerProvider(createPlan(), requirements);
    const snapshot = createPptExplainerProviderRouteSnapshot(preflight);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.canonicalBaseUrl).toBe('https://api.example.com/v1');
    expect(serialized).not.toContain('provider-secret-key');
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('extraHeaders');

    const restored = resolvePptExplainerProviderRouteSnapshot(
      snapshot,
      requirements,
      {
        profiles: [
          createProfile(
            'rotated-runtime-key',
            'https://API.EXAMPLE.COM:443/v1/'
          ),
        ],
      }
    );
    expect(restored.provider.apiKey).toBe('rotated-runtime-key');
    expect(restored.provider.baseUrl).toBe('https://api.example.com/v1');
    expect(restored.binding.submitPath).toBe('/ppt/jobs');
    expect(restored.binding.protocol).toBe(PPT_EXPLAINER_PROVIDER_PROTOCOL);
  });

  it('rejects recovery after the provider base URL changes', () => {
    const snapshot = createPptExplainerProviderRouteSnapshot(
      preflightPptExplainerProvider(createPlan(), requirements)
    );

    expect(() =>
      resolvePptExplainerProviderRouteSnapshot(snapshot, requirements, {
        profiles: [
          createProfile(
            'rotated-runtime-key',
            'https://api.changed.example/v1'
          ),
        ],
      })
    ).toThrow('原供应商 Base URL 已变更');

    expect(() =>
      resolvePptExplainerProviderRouteSnapshot(snapshot, requirements, {
        profiles: [
          createProfile('rotated-runtime-key', 'https://api.example.com/v2'),
        ],
      })
    ).toThrow('原供应商 Base URL 已变更');
  });

  it('fails legacy route snapshots explicitly instead of rebinding them', () => {
    const snapshot = createPptExplainerProviderRouteSnapshot(
      preflightPptExplainerProvider(createPlan(), requirements)
    );
    const legacySnapshot = {
      ...snapshot,
      schemaVersion: 1,
    } as unknown as typeof snapshot;

    expect(() =>
      resolvePptExplainerProviderRouteSnapshot(legacySnapshot, requirements, {
        profiles: [createProfile()],
      })
    ).toThrow('路由快照版本过旧或不受支持');
  });

  it('rejects credential-bearing endpoint templates', () => {
    const binding = createPptExplainerBinding({
      submitPath: '/ppt/jobs?api_key=embedded-secret',
    });

    expect(() =>
      preflightPptExplainerProvider(createPlan(binding), requirements)
    ).toThrow('不得内嵌鉴权参数');

    const nestedEncodedQueryBinding = createPptExplainerBinding({
      submitPath: '/ppt/jobs?%2561pi_key=embedded-secret',
    });
    expect(() =>
      preflightPptExplainerProvider(
        createPlan(nestedEncodedQueryBinding),
        requirements
      )
    ).toThrow('不得内嵌鉴权参数');
  });

  it('does not persist credentials embedded in the provider base URL path', () => {
    const apiKey = 'provider/secret+key';
    const profile = createProfile(
      apiKey,
      `https://api.example.com/${encodeURIComponent(apiKey)}/v1`
    );

    expect(() =>
      preflightPptExplainerProvider(
        createPlan(createPptExplainerBinding(), profile),
        requirements
      )
    ).toThrow('Base URL 不得包含供应商凭据');
  });

  it('rejects cross-origin absolute submit, poll, and cancel endpoints', () => {
    const submitBinding = createPptExplainerBinding({
      submitPath: 'https://attacker.example/ppt/jobs',
    });
    expect(() =>
      preflightPptExplainerProvider(createPlan(submitBinding), requirements)
    ).toThrow('提交路径不得跨越供应商 Base URL');

    const pollBinding = createPptExplainerBinding({
      pollPathTemplate: 'https://attacker.example/ppt/jobs/{remoteId}',
    });
    expect(() =>
      preflightPptExplainerProvider(createPlan(pollBinding), requirements)
    ).toThrow('查询路径不得跨越供应商 Base URL');

    const cancelBinding = createPptExplainerBinding();
    const cancelMetadata = cancelBinding.metadata?.pptExplainer;
    if (!cancelMetadata?.cancel) throw new Error('测试 binding 缺少取消能力');
    cancelBinding.metadata = {
      ...cancelBinding.metadata,
      pptExplainer: {
        ...cancelMetadata,
        cancel: {
          ...cancelMetadata.cancel,
          pathTemplate: 'https://attacker.example/ppt/jobs/{remoteId}/cancel',
        },
      },
    };
    expect(() =>
      preflightPptExplainerProvider(createPlan(cancelBinding), requirements)
    ).toThrow('取消路径不得跨越供应商 Base URL');
  });

  it('accepts same-origin absolute endpoints and preserves their exact route', () => {
    const binding = createPptExplainerBinding({
      submitPath: 'https://api.example.com/ppt/jobs',
      pollPathTemplate: 'https://api.example.com/ppt/jobs/{remoteId}',
    });
    const metadata = binding.metadata?.pptExplainer;
    if (!metadata?.cancel) throw new Error('测试 binding 缺少取消能力');
    binding.metadata = {
      ...binding.metadata,
      pptExplainer: {
        ...metadata,
        cancel: {
          ...metadata.cancel,
          pathTemplate: 'https://api.example.com/ppt/jobs/{remoteId}/cancel',
        },
      },
    };

    const snapshot = createPptExplainerProviderRouteSnapshot(
      preflightPptExplainerProvider(createPlan(binding), requirements)
    );
    expect(snapshot.binding.submitPath).toBe(
      'https://api.example.com/ppt/jobs'
    );
    expect(snapshot.binding.pollPathTemplate).toBe(
      'https://api.example.com/ppt/jobs/{remoteId}'
    );
    expect(snapshot.binding.pptExplainer.cancel?.pathTemplate).toBe(
      'https://api.example.com/ppt/jobs/{remoteId}/cancel'
    );
  });

  it('rejects raw and nested URL-encoded runtime credentials before snapshotting', () => {
    const apiKey = 'provider/secret+key';
    const rawBinding = createPptExplainerBinding({
      submitPath: `/ppt/jobs/${apiKey}`,
    });
    expect(() =>
      preflightPptExplainerProvider(
        createPlan(rawBinding, createProfile(apiKey)),
        requirements
      )
    ).toThrow('不得包含供应商凭据');

    const route = preflightPptExplainerProvider(
      createPlan(createPptExplainerBinding(), createProfile(apiKey)),
      requirements
    );
    route.binding.submitPath = `/ppt/jobs/${encodeURIComponent(apiKey)}`;
    expect(() => createPptExplainerProviderRouteSnapshot(route)).toThrow(
      '不得包含供应商凭据'
    );

    route.binding.submitPath = `/ppt/jobs/${encodeURIComponent(
      encodeURIComponent(apiKey)
    )}`;
    expect(() => createPptExplainerProviderRouteSnapshot(route)).toThrow(
      '不得包含供应商凭据'
    );

    const headerSecret = 'header/secret+value';
    const profile = createProfile();
    profile.extraHeaders = { 'X-Provider-Secret': headerSecret };
    const headerBinding = createPptExplainerBinding({
      submitPath: `/ppt/jobs/${encodeURIComponent(
        encodeURIComponent(headerSecret)
      )}`,
    });
    expect(() =>
      preflightPptExplainerProvider(
        createPlan(headerBinding, profile),
        requirements
      )
    ).toThrow('不得包含供应商凭据');
  });
});
