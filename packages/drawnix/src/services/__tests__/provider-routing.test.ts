import { describe, expect, it, vi } from 'vitest';
import {
  getTextBindingMaxImageCount,
  inferBindingsForProviderModel,
  InvocationPlanner,
  InvocationPlanningError,
  supportsTextBindingImageInput,
} from '../provider-routing';
import { providerTransport } from '../provider-routing';
import { canAttachProviderRequestIdHeader } from '../provider-routing';
import {
  isLocalDevHostname,
  rewriteTuziBaseUrlForSameOriginProxy,
  supportsTuziSameOriginProxyHostname,
} from '../provider-routing/provider-transport';
import {
  TUZI_API_FALLBACK_ENDPOINTS,
  TUZI_API_REQUEST_ID_CORS_ENDPOINTS,
} from '../provider-routing/tuzi-api-endpoints';
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
  it.each([
    'localhost',
    '127.0.0.1',
    '::1',
    '10.0.0.8',
    '172.16.0.8',
    '172.31.255.8',
    '192.168.50.225',
  ])('recognizes local development hostname %s', (hostname) => {
    expect(isLocalDevHostname(hostname)).toBe(true);
  });

  it.each(['172.15.0.8', '172.32.0.8', '8.8.8.8', 'example.com'])(
    'does not treat public hostname %s as local development',
    (hostname) => {
      expect(isLocalDevHostname(hostname)).toBe(false);
    }
  );

  it('enables fixed same-origin proxy hosts without opening arbitrary origins', () => {
    expect(supportsTuziSameOriginProxyHostname('192.168.50.225', true)).toBe(
      true
    );
    expect(supportsTuziSameOriginProxyHostname('pr.opentu.ai', false)).toBe(
      true
    );
    expect(
      supportsTuziSameOriginProxyHostname('preview.vercel.app', false)
    ).toBe(true);
    expect(supportsTuziSameOriginProxyHostname('example.com', false)).toBe(
      false
    );
    expect(
      supportsTuziSameOriginProxyHostname('custom.example.com', false, true)
    ).toBe(true);
  });

  it.each([
    ['api.tu-zi.com', 'api'],
    ['apius.tu-zi.com', 'apius'],
    ['apicdn.tu-zi.com', 'apicdn'],
    ['api.sydney-ai.com', 'sydney'],
    ['api.ourzhishi.top', 'ourzhishi'],
    ['apisz.ourzhishi.top', 'ourzhishi-sz'],
  ])('preserves trusted node %s through fixed route %s', (host, route) => {
    expect(
      rewriteTuziBaseUrlForSameOriginProxy(
        `https://${host}/v1`,
        '192.168.50.225',
        true
      )
    ).toBe(`/__opentu_tuzi_proxy__/${route}/v1`);
  });

  it('never turns the fixed proxy into an arbitrary target proxy', () => {
    expect(
      rewriteTuziBaseUrlForSameOriginProxy(
        'https://images.example.com/v1',
        'custom.example.com',
        false,
        true
      )
    ).toBe('https://images.example.com/v1');
  });

  it('reports a proxy configuration error instead of parsing SPA HTML as JSON', async () => {
    vi.stubGlobal('location', { hostname: 'opentu.ai' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );

    try {
      await expect(
        providerTransport.send(
          {
            profileId: 'provider-tuzi',
            profileName: 'Tuzi',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'secret',
            authType: 'bearer',
          },
          {
            path: '/images/generations',
            method: 'POST',
            requestId: 'proxy-html-task-id',
            fetcher,
          }
        )
      ).rejects.toThrow('Tuzi 同源代理未生效');
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        '/__opentu_tuzi_proxy__/api/v1/images/generations'
      );
      expect(
        (fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>)[
          'X-Request-Id'
        ]
      ).toBe('proxy-html-task-id');
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

  it('uses preferred request schema when a model has generation and edit bindings', () => {
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [
          {
            id: 'provider-a',
            name: 'Provider A',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'key-a',
            authType: 'bearer',
          },
        ],
        bindings: [
          {
            id: 'gpt-generation',
            profileId: 'provider-a',
            modelId: 'gpt-image-2',
            operation: 'image',
            protocol: 'openai.images.generations',
            requestSchema: 'openai.image.gpt-generation-json',
            responseSchema: 'openai.image.data',
            submitPath: '/images/generations',
            priority: 320,
            confidence: 'high',
            source: 'template',
          },
          {
            id: 'gpt-edit',
            profileId: 'provider-a',
            modelId: 'gpt-image-2',
            operation: 'image',
            protocol: 'openai.images.edits',
            requestSchema: 'openai.image.gpt-edit-form',
            responseSchema: 'openai.image.data',
            submitPath: '/images/edits',
            priority: 319,
            confidence: 'high',
            source: 'template',
          },
        ],
      })
    );

    const editPlan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: 'provider-a',
        modelId: 'gpt-image-2',
      },
      preferredRequestSchema: ['missing.schema', 'openai.image.gpt-edit-form'],
    });
    const fallbackPlan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: 'provider-a',
        modelId: 'gpt-image-2',
      },
      preferredRequestSchema: 'missing.schema',
    });

    expect(editPlan.binding.id).toBe('gpt-edit');
    expect(editPlan.binding.submitPath).toBe('/images/edits');
    expect(fallbackPlan.binding.id).toBe('gpt-generation');
  });

  it('keeps an explicit manual binding ahead of schema and async preferences', () => {
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [
          {
            id: 'provider-a',
            name: 'Provider A',
            providerType: 'custom',
            baseUrl: 'https://custom.example.com',
            apiKey: 'key-a',
            authType: 'bearer',
            preferAsyncImageEndpoint: true,
          },
        ],
        bindings: [
          {
            id: 'custom-http-image',
            profileId: 'provider-a',
            modelId: 'custom-image',
            operation: 'image',
            protocol: 'custom-http',
            requestSchema: 'custom-http',
            responseSchema: 'custom-http.image',
            submitPath: '/render',
            priority: 900,
            confidence: 'high',
            source: 'manual',
          },
          {
            id: 'inferred-edit',
            profileId: 'provider-a',
            modelId: 'custom-image',
            operation: 'image',
            protocol: 'openai.images.edits',
            requestSchema: 'openai.image.gpt-edit-form',
            responseSchema: 'openai.image.data',
            submitPath: '/images/edits',
            priority: 320,
            confidence: 'high',
            source: 'template',
          },
          {
            id: 'inferred-async',
            profileId: 'provider-a',
            modelId: 'custom-image',
            operation: 'image',
            protocol: 'openai.async.media',
            requestSchema: 'openai.async.image.form',
            responseSchema: 'openai.async.task',
            submitPath: '/videos',
            priority: 300,
            confidence: 'high',
            source: 'template',
          },
        ],
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: 'provider-a',
        modelId: 'custom-image',
      },
      preferredRequestSchema: 'openai.image.gpt-edit-form',
    });

    expect(plan.binding.id).toBe('custom-http-image');
    expect(plan.binding.protocol).toBe('custom-http');
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

  it('collapses a duplicated API version at the URL join boundary', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      {
        path: '/v1/images/generations',
        method: 'POST',
      }
    );

    expect(prepared.url).toBe('https://api.tu-zi.com/v1/images/generations');
  });

  it('keeps different API version segments when joining provider URLs', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-custom',
        profileName: 'Custom Provider',
        providerType: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      {
        path: '/v1beta/models/test:generateContent',
      }
    );

    expect(prepared.url).toBe(
      'https://api.example.com/v1/v1beta/models/test:generateContent'
    );
  });

  it('collapses an exact duplicate API version path', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-custom',
        profileName: 'Custom Provider',
        providerType: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      {
        path: '/v1',
      }
    );

    expect(prepared.url).toBe('https://api.example.com/v1');
  });

  it('adds /v1 when a versioned API receives a provider origin', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com',
        apiKey: 'secret',
        authType: 'bearer',
      },
      {
        path: '/images/generations',
        baseUrlStrategy: 'ensure-v1',
      }
    );

    expect(prepared.url).toBe('https://api.tu-zi.com/v1/images/generations');
  });

  it('omits X-Request-Id for custom cross-origin providers', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-custom',
        profileName: 'Custom Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://images.example.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      {
        path: '/images/generations',
        method: 'POST',
        requestId: 'request-id-that-would-trigger-preflight',
      }
    );

    expect(
      Object.keys(prepared.headers).some(
        (name) => name.toLowerCase() === 'x-request-id'
      )
    ).toBe(false);
  });

  it('routes public Request-ID submissions to a CORS-compatible Tuzi node', () => {
    const context: ProviderProfileSnapshot = {
      id: 'provider-tuzi',
      name: 'Tuzi',
      providerType: 'openai-compatible',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'secret',
      authType: 'bearer',
    };
    const request = {
      path: '/images/generations',
      method: 'POST',
      requestId: 'public-task-id',
    };

    expect(canAttachProviderRequestIdHeader(context, request)).toBe(false);

    const prepared = providerTransport.prepareRequest(context, request);
    expect(prepared.url).toBe('https://bus.tu-zi.com/v1/images/generations');
    expect(prepared.headers['X-Request-Id']).toBe('public-task-id');
  });

  it('does not mix Request-ID CORS nodes into normal Tuzi fallback routing', () => {
    const normalOrigins = new Set(
      TUZI_API_FALLBACK_ENDPOINTS.map(({ url }) => new URL(url).origin)
    );

    for (const { url } of TUZI_API_REQUEST_ID_CORS_ENDPOINTS) {
      expect(normalOrigins.has(new URL(url).origin)).toBe(false);
    }
  });

  it.each(TUZI_API_REQUEST_ID_CORS_ENDPOINTS)(
    'keeps Request-ID submission on compatible node $url',
    ({ url }) => {
      const context: ProviderProfileSnapshot = {
        id: 'provider-tuzi',
        name: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: `${url}/v1`,
        apiKey: 'secret',
        authType: 'bearer',
      };
      const request = {
        path: '/images/generations',
        method: 'POST',
        requestId: 'compatible-task-id',
      };

      expect(canAttachProviderRequestIdHeader(context, request)).toBe(true);
      const prepared = providerTransport.prepareRequest(context, request);
      expect(prepared.url).toBe(`${url}/v1/images/generations`);
      expect(prepared.headers['X-Request-Id']).toBe('compatible-task-id');
    }
  );

  it('never retries a Request-ID submission on another node', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Failed to fetch'));

    await expect(
      providerTransport.send(
        {
          profileId: 'provider-tuzi',
          profileName: 'Tuzi',
          providerType: 'openai-compatible',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'secret',
          authType: 'bearer',
        },
        {
          path: '/images/generations',
          method: 'POST',
          requestId: 'single-submit-task-id',
          fetcher,
        }
      )
    ).rejects.toThrow('Failed to fetch');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://bus.tu-zi.com/v1/images/generations'
    );
  });

  it('removes Request ID headers from trusted Tuzi GET requests', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://bus.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
        extraHeaders: { 'x-request-id': 'stale-profile-id' },
      },
      {
        path: '/images/generations/result',
        method: 'GET',
        headers: { 'X-REQUEST-ID': 'stale-request-id' },
        requestId: 'task-id-that-must-not-be-sent',
      }
    );

    expect(
      Object.keys(prepared.headers).some(
        (name) => name.toLowerCase() === 'x-request-id'
      )
    ).toBe(false);
  });

  it('keeps normal node fallback for GET requests even if a Request ID was provided', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await providerTransport.send(
      {
        profileId: 'provider-tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      {
        path: '/images/generations/result',
        method: 'GET',
        requestId: 'get-request-id-that-must-not-change-routing',
        fetcher,
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      'https://apius.tu-zi.com/v1/images/generations/result'
    );
  });

  it('does not leak Request ID to an absolute third-party path', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
        extraHeaders: { 'x-request-id': 'stale-profile-request-id' },
      },
      {
        path: 'https://images.example.com/v1/images/generations',
        method: 'POST',
        requestId: 'task-id-that-must-not-leak',
      }
    );

    expect(prepared.url).toBe(
      'https://images.example.com/v1/images/generations'
    );
    expect(
      Object.keys(prepared.headers).some(
        (name) => name.toLowerCase() === 'x-request-id'
      )
    ).toBe(false);
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

  it('falls back to another tuzi endpoint on transient gateway responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            api_address_list: [
              { url: 'https://api.tu-zi.com' },
              { url: 'https://apius.tu-zi.com' },
            ],
          },
        })
      )
    );

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('status_code=504, bad response status code 504', {
          status: 504,
        })
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    try {
      const response = await providerTransport.send(
        {
          profileId: 'provider-tuzi',
          profileName: 'Tuzi',
          providerType: 'openai-compatible',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'secret',
          authType: 'bearer',
        },
        {
          path: '/images/generations',
          method: 'POST',
          body: '{}',
          fetcher,
        }
      );

      expect(response.ok).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(String(fetcher.mock.calls[1]?.[0])).toBe(
        'https://apius.tu-zi.com/v1/images/generations'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns deterministic model_not_found responses without switching Tuzi endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            api_address_list: [
              { url: 'https://api.tu-zi.com' },
              { url: 'https://apius.tu-zi.com' },
            ],
          },
        })
      )
    );

    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'model_not_found',
            message: '分组 default 下模型 dall-e 无可用渠道',
          },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    try {
      const response = await providerTransport.send(
        {
          profileId: 'provider-tuzi',
          profileName: 'Tuzi',
          providerType: 'openai-compatible',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'secret',
          authType: 'bearer',
        },
        {
          path: '/images/generations',
          method: 'POST',
          body: '{}',
          fetcher,
        }
      );

      expect(response.status).toBe(503);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to another tuzi endpoint on remote protocol termination', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            api_address_list: [
              { url: 'https://api.tu-zi.com' },
              { url: 'https://apius.tu-zi.com' },
            ],
          },
        })
      )
    );

    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(
        new Error(
          'UpstreamRemoteProtocolError: <ConnectionTerminated error_code:ErrorCodes.NO_ERROR, last_stream_id:1, additional_data:None> | cause=RemoteProtocolError: <ConnectionTerminated error_code:ErrorCodes.NO_ERROR, last_stream_id:1, additional_data:None> | channel=CH#18 兔子 | url=https://api.tu-zi.com | body=2198889bytes | send_took=59866ms | active_upstream=2 | elapsed=61101ms'
        )
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    try {
      const response = await providerTransport.send(
        {
          profileId: 'provider-tuzi',
          profileName: 'Tuzi',
          providerType: 'openai-compatible',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'secret',
          authType: 'bearer',
        },
        {
          path: '/images/generations',
          method: 'POST',
          body: '{}',
          fetcher,
        }
      );

      expect(response.ok).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(String(fetcher.mock.calls[1]?.[0])).toBe(
        'https://apius.tu-zi.com/v1/images/generations'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retries Tuzi image 404 responses on a trusted fallback endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                api_address_list: [
                  { url: 'https://api.tu-zi.com' },
                  { url: 'https://apius.tu-zi.com' },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<!doctype html><title>Not Found</title>', {
          status: 404,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'fallback.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const response = await providerTransport.send(
        {
          profileId: 'provider-tuzi',
          profileName: 'Tuzi',
          providerType: 'openai-compatible',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'secret',
          authType: 'bearer',
        },
        {
          path: '/images/generations',
          baseUrlStrategy: 'ensure-v1',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-image-2', prompt: 'test' }),
          fetcher,
        }
      );

      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenNthCalledWith(
        1,
        'https://api.tu-zi.com/v1/images/generations',
        expect.any(Object)
      );
      expect(fetcher).toHaveBeenNthCalledWith(
        2,
        'https://apius.tu-zi.com/v1/images/generations',
        expect.any(Object)
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats trusted Tuzi alternate domains as Tuzi GPT Image providers', () => {
    const model: ModelConfig = {
      id: 'gpt-image-2',
      label: 'GPT Image 2',
      type: 'image',
      vendor: ModelVendor.GPT,
    };

    const bindings = inferBindingsForProviderModel(
      {
        id: 'provider-tuzi-alt',
        name: 'Tuzi Alternate',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.ourzhishi.top/v1',
        apiKey: 'secret',
        authType: 'bearer',
        imageApiCompatibility: 'auto',
      },
      model
    );

    expect(bindings.map((binding) => binding.requestSchema)).toEqual([
      'tuzi.image.gpt-generation-json',
      'tuzi.image.gpt-edit-json',
    ]);
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

  it('routes the same GPT Image model by profile image compatibility', () => {
    const model: ModelConfig = {
      id: 'gpt-image-2',
      label: 'GPT Image 2',
      type: 'image',
      vendor: ModelVendor.GPT,
    };

    const officialBindings = inferBindingsForProviderModel(
      {
        id: 'provider-openai',
        name: 'OpenAI',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'openai-key',
        authType: 'bearer',
        imageApiCompatibility: 'auto',
      },
      model
    );
    const tuziBindings = inferBindingsForProviderModel(
      {
        id: 'provider-tuzi',
        name: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'tuzi-key',
        authType: 'bearer',
        imageApiCompatibility: 'auto',
      },
      model
    );
    const genericBindings = inferBindingsForProviderModel(
      {
        id: 'provider-generic',
        name: 'Generic',
        providerType: 'openai-compatible',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'generic-key',
        authType: 'bearer',
        imageApiCompatibility: 'openai-gpt-image',
      },
      model
    );

    expect(officialBindings.map((binding) => binding.requestSchema)).toEqual([
      'openai.image.gpt-generation-json',
      'openai.image.gpt-edit-form',
    ]);
    expect(officialBindings[0]?.metadata?.image).toMatchObject({
      action: 'generation',
      imageApiCompatibility: 'auto',
      resolvedImageApiCompatibility: 'openai-gpt-image',
    });
    expect(officialBindings[1]?.metadata?.image).toMatchObject({
      action: 'edit',
      maxImageCount: 16,
      supportsMask: true,
      imageApiCompatibility: 'auto',
      resolvedImageApiCompatibility: 'openai-gpt-image',
    });
    expect(tuziBindings.map((binding) => binding.requestSchema)).toEqual([
      'tuzi.image.gpt-generation-json',
      'tuzi.image.gpt-edit-json',
    ]);
    expect(tuziBindings[1]?.protocol).toBe('openai.images.edits');
    expect(tuziBindings[1]?.submitPath).toBe('/images/edits');
    expect(tuziBindings[0]?.metadata?.image).toMatchObject({
      action: 'generation',
      imageApiCompatibility: 'auto',
      resolvedImageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(tuziBindings[1]?.metadata?.image).toMatchObject({
      action: 'edit',
      maxImageCount: 16,
      supportsMask: false,
      imageApiCompatibility: 'auto',
      resolvedImageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(genericBindings[0]?.requestSchema).toBe(
      'openai.image.gpt-generation-json'
    );
  });

  it('routes tuzi gemini image models through generateContent', () => {
    const profile = {
      id: 'provider-b',
      name: 'Provider B',
      providerType: 'gemini-compatible' as const,
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'key-b',
      authType: 'query' as const,
    };
    const model: ModelConfig = {
      id: 'gemini-3.1-flash-image-preview-4k',
      label: 'Gemini Image 4K',
      type: 'image',
      vendor: ModelVendor.GEMINI,
    };
    const bindings = inferBindingsForProviderModel(profile, model);
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
    });

    expect(bindings.map((binding) => binding.protocol)).toEqual([
      'google.generateContent',
    ]);
    expect(plan.binding.protocol).toBe('google.generateContent');
    expect(plan.binding.submitPath).toBe(
      '/v1beta/models/{model}:generateContent'
    );
  });

  it('keeps third-party tuzi gemini image models on generateContent', () => {
    const profile = {
      id: 'provider-c',
      name: 'Provider C',
      providerType: 'gemini-compatible' as const,
      baseUrl: 'https://business.tu-zi.com/v1',
      apiKey: 'key-c',
      authType: 'bearer' as const,
    };
    const model: ModelConfig = {
      id: 'gemini-3-pro-image-preview',
      label: 'Gemini Image',
      type: 'image',
      vendor: ModelVendor.GEMINI,
    };
    const bindings = inferBindingsForProviderModel(profile, model);
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
    });

    expect(bindings.map((binding) => binding.protocol)).toEqual([
      'google.generateContent',
    ]);
    expect(plan.binding.protocol).toBe('google.generateContent');
    expect(plan.binding.submitPath).toBe(
      '/v1beta/models/{model}:generateContent'
    );
  });

  it('routes business tuzi GPT Image models with Tuzi compatibility in auto mode', () => {
    const model: ModelConfig = {
      id: 'gpt-image-2',
      label: 'GPT Image 2',
      type: 'image',
      vendor: ModelVendor.GPT,
    };

    const bindings = inferBindingsForProviderModel(
      {
        id: 'provider-business',
        name: 'Business',
        providerType: 'openai-compatible',
        baseUrl: 'https://business.tu-zi.com/v1',
        apiKey: 'business-key',
        authType: 'bearer',
        imageApiCompatibility: 'auto',
      },
      model
    );

    expect(bindings.map((binding) => binding.requestSchema)).toEqual([
      'tuzi.image.gpt-generation-json',
      'tuzi.image.gpt-edit-json',
    ]);
    expect(bindings[1]?.submitPath).toBe('/images/edits');
    expect(bindings[0]?.metadata?.image).toMatchObject({
      imageApiCompatibility: 'auto',
      resolvedImageApiCompatibility: 'tuzi-gpt-image',
    });
  });

  it('keeps discovered generateContent bindings below template image bindings for tuzi-gpt-image endpoints', () => {
    const profile = {
      id: 'provider-b',
      name: 'Provider B',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'key-b',
      authType: 'bearer' as const,
    };
    const model: ModelConfig = {
      id: 'gemini-2.5-flash-image',
      label: 'Gemini Image',
      type: 'image',
      vendor: ModelVendor.GEMINI,
    };
    const bindings = inferBindingsForProviderModel(profile, model, {
      image: {
        path: '/v1beta/models/gemini-2.5-flash-image:generateContent',
      } as any,
    });
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
    });

    expect(bindings.map((binding) => binding.protocol)).toContain(
      'google.generateContent'
    );
    expect(plan.binding.protocol).toBe('openai.images.generations');
    expect(plan.binding.submitPath).toBe('/images/generations');
  });

  it('does not infer discovered official GPT edit bindings for non-official compatibility profiles', () => {
    const profile = {
      id: 'provider-tuzi',
      name: 'Provider Tuzi',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'key-b',
      authType: 'bearer' as const,
      imageApiCompatibility: 'tuzi-gpt-image' as const,
    };
    const model: ModelConfig = {
      id: 'gpt-image-2',
      label: 'GPT Image 2',
      type: 'image',
      vendor: ModelVendor.GPT,
    };

    const bindings = inferBindingsForProviderModel(profile, model, {
      edit: {
        path: '/images/edits',
      } as any,
    });

    expect(bindings.map((binding) => binding.requestSchema)).toEqual([
      'tuzi.image.gpt-generation-json',
      'tuzi.image.gpt-edit-json',
    ]);
    expect(bindings[1]?.submitPath).toBe('/images/edits');
  });

  it('prefers pricing async-image /v1/videos binding for image models', () => {
    const profile = {
      id: 'provider-business',
      name: 'Business Provider',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://test-business.tu-zi.com/v1',
      apiKey: 'key-a',
      authType: 'bearer' as const,
      preferAsyncImageEndpoint: true,
    };
    const model: ModelConfig = {
      id: 'gpt-image-1-vip',
      label: 'GPT Image',
      type: 'image',
      vendor: ModelVendor.GPT,
    };
    const bindings = inferBindingsForProviderModel(profile, model, {
      generate: {
        path: '/v1/images/generations',
        method: 'POST',
      },
      'openai-video': {
        path: '/v1/videos',
        method: 'POST',
        scenario: 'async-image',
      },
    });
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
    });

    expect(bindings.map((binding) => binding.protocol)).toContain(
      'openai.async.media'
    );
    expect(plan.binding.protocol).toBe('openai.async.media');
    expect(plan.binding.requestSchema).toBe('openai.async.image.form');
    expect(plan.binding.submitPath).toBe('/videos');
    expect(plan.binding.pollPathTemplate).toBe('/videos/{taskId}');
  });

  it('keeps async-image binding ahead of GPT edit preference for reference images', () => {
    const profile = {
      id: 'provider-business',
      name: 'Business Provider',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://test-business.tu-zi.com/v1',
      apiKey: 'key-a',
      authType: 'bearer' as const,
      preferAsyncImageEndpoint: true,
    };
    const model: ModelConfig = {
      id: 'gemini-3-pro-image-preview-async',
      label: 'Gemini Async Image',
      type: 'image',
      vendor: ModelVendor.GEMINI,
    };
    const bindings = inferBindingsForProviderModel(profile, model, {
      'openai-video': {
        path: '/v1/videos',
        method: 'POST',
        scenario: 'async-image',
      },
    });
    const planner = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    );

    const plan = planner.plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
      preferredRequestSchema: 'openai.image.gpt-edit-form',
    });

    expect(bindings.map((binding) => binding.requestSchema)).toContain(
      'openai.async.image.form'
    );
    expect(plan.binding.protocol).toBe('openai.async.media');
    expect(plan.binding.requestSchema).toBe('openai.async.image.form');
    expect(plan.binding.submitPath).toBe('/videos');
  });

  it('prefers async image binding for async-listed image models when enabled', () => {
    const profile = {
      id: 'provider-business',
      name: 'Business Provider',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://test-business.tu-zi.com/v1',
      apiKey: 'key-a',
      authType: 'bearer' as const,
      preferAsyncImageEndpoint: true,
    };
    const model: ModelConfig = {
      id: 'gemini-3-pro-image-preview-async',
      label: 'Gemini Async Image',
      type: 'image',
      vendor: ModelVendor.GEMINI,
    };
    const bindings = inferBindingsForProviderModel(profile, model, {
      'openai-video': {
        path: '/v1/videos',
        method: 'POST',
        scenario: 'async-image',
      },
    });
    const plan = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    ).plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
    });

    expect(plan.binding.protocol).toBe('openai.async.media');
    expect(plan.binding.submitPath).toBe('/videos');
  });

  it('routes generic image models through /v1/videos when async image is enabled', () => {
    const profile = {
      id: 'provider-business',
      name: 'Business Provider',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://test-business.tu-zi.com/v1',
      apiKey: 'key-a',
      authType: 'bearer' as const,
      preferAsyncImageEndpoint: true,
    };
    const model: ModelConfig = {
      id: 'qwen-image-2.0',
      label: 'Qwen Image 2.0',
      type: 'image',
      vendor: ModelVendor.QWEN,
    };
    const bindings = inferBindingsForProviderModel(profile, model, {
      'openai-video': {
        path: '/v1/videos',
        method: 'POST',
        scenario: 'async-image',
      },
    });
    const plan = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    ).plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
    });

    expect(plan.binding.protocol).toBe('openai.async.media');
    expect(plan.binding.submitPath).toBe('/videos');
  });

  it('routes mj-imagine through /v1/videos when async image is enabled', () => {
    const profile = {
      id: 'provider-business',
      name: 'Business Provider',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://test-business.tu-zi.com/v1',
      apiKey: 'key-a',
      authType: 'bearer' as const,
      preferAsyncImageEndpoint: true,
    };
    const model: ModelConfig = {
      id: 'mj-imagine',
      label: 'Midjourney',
      type: 'image',
      vendor: ModelVendor.MIDJOURNEY,
      tags: ['mj'],
    };
    const bindings = inferBindingsForProviderModel(profile, model, {
      'openai-video': {
        path: '/v1/videos',
        method: 'POST',
        scenario: 'async-image',
      },
    });
    const plan = new InvocationPlanner(
      createRepositories({
        profiles: [profile],
        bindings,
      })
    ).plan({
      operation: 'image',
      modelRef: {
        profileId: profile.id,
        modelId: model.id,
      },
    });

    expect(bindings.map((binding) => binding.protocol)).toContain(
      'openai.async.media'
    );
    expect(plan.binding.protocol).toBe('openai.async.media');
    expect(plan.binding.requestSchema).toBe('openai.async.image.form');
    expect(plan.binding.submitPath).toBe('/videos');
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

  it('keeps Seedance 2.0 on the unified async video protocol', () => {
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
        id: 'doubao-seedance-2-0-260128',
        label: 'Seedance 2.0',
        type: 'video',
        vendor: ModelVendor.DOUBAO,
      },
      {
        'sora-2 官方异步端点': {
          path: '/v1/videos',
          method: 'POST',
        },
      }
    );

    expect(bindings.map((binding) => binding.protocol)).not.toContain(
      'seedance.task'
    );
    expect(bindings).toContainEqual(
      expect.objectContaining({
        protocol: 'openai.async.video',
        requestSchema: 'doubao.seedance-2.video.content-json',
      })
    );
  });

  it('keeps pricing /v1/videos binding as video when scenario is not async-image', () => {
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
        id: 'sora-2-pro',
        label: 'Sora',
        type: 'video',
        vendor: ModelVendor.GPT,
      },
      {
        'openai-video': {
          path: '/v1/videos',
          method: 'POST',
          scenario: 'video',
        },
      }
    );

    expect(bindings.map((binding) => binding.protocol)).toContain(
      'openai.async.video'
    );
    expect(bindings.map((binding) => binding.protocol)).not.toContain(
      'openai.async.media'
    );
  });

  it('infers HappyHorse video JSON bindings before generic video routing', () => {
    const bindings = inferBindingsForProviderModel(
      {
        id: 'provider-happyhorse',
        name: 'HappyHorse Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://vexrouter.com/v1',
        apiKey: 'key-a',
        authType: 'bearer',
      },
      {
        id: 'happyhorse-1.0-r2v',
        label: 'HappyHorse R2V',
        type: 'video',
        vendor: ModelVendor.OTHER,
      }
    );

    expect(bindings.map((binding) => binding.protocol)).toEqual([
      'happyhorse.video',
      'openai.async.video',
    ]);
    expect(bindings[0]?.requestSchema).toBe('happyhorse.video.json');
    expect(bindings[0]?.metadata?.video?.downloadPathTemplate).toBe(
      '/videos/{taskId}/content'
    );
  });

  it('infers trim-v1 transport for suno audio bindings', () => {
    const [binding] = inferBindingsForProviderModel(
      {
        id: 'provider-a',
        name: 'Provider A',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'key-a',
        authType: 'bearer',
      },
      {
        id: 'suno_music',
        label: 'Suno Music',
        type: 'audio',
        vendor: ModelVendor.SUNO,
        tags: ['suno', 'audio', 'music'],
      }
    );

    expect(binding?.protocol).toBe('tuzi.suno.music');
    expect(binding?.submitPath).toBe('/suno/submit/music');
    expect(binding?.pollPathTemplate).toBe('/suno/fetch/{taskId}');
    expect(binding?.baseUrlStrategy).toBe('trim-v1');
    expect(binding?.metadata?.audio?.defaultAction).toBe('music');
    expect(binding?.metadata?.audio?.submitPathByAction).toEqual({
      music: '/suno/submit/music',
      lyrics: '/suno/submit/lyrics',
    });
    expect(binding?.metadata?.audio?.versionOptions).toEqual([
      'chirp-v5-5',
      'chirp-v5',
      'chirp-v4-5',
      'chirp-v4',
      'chirp-v3-0',
      'chirp-v3-5',
    ]);
    expect(binding?.metadata?.audio?.defaultVersion).toBe('chirp-v3-5');
  });

  it('infers Kling capability bindings with action-scoped version metadata', () => {
    const [binding] = inferBindingsForProviderModel(
      {
        id: 'provider-kling',
        name: 'Kling Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'key-a',
        authType: 'bearer',
      },
      {
        id: 'kling_video',
        label: 'Kling',
        type: 'video',
        vendor: ModelVendor.KLING,
      }
    );

    expect(binding?.protocol).toBe('kling.video');
    expect(binding?.requestSchema).toBe('kling.video.auto-action-json');
    expect(binding?.submitPath).toBe('/kling/v1/videos/{action}');
    expect(binding?.pollPathTemplate).toBe(
      '/kling/v1/videos/{action}/{taskId}'
    );
    expect(binding?.metadata?.video?.versionField).toBe('model_name');
    expect(binding?.metadata?.video?.defaultVersion).toBe('kling-v1-6');
    expect(
      binding?.metadata?.video?.versionOptionsByAction?.text2video
    ).toEqual([
      'kling-v3',
      'kling-v2-6',
      'kling-v2-1',
      'kling-v1-6',
      'kling-v1-5',
    ]);
    expect(
      binding?.metadata?.video?.versionOptionsByAction?.image2video
    ).toEqual([
      'kling-v3',
      'kling-v2-6',
      'kling-v2-1',
      'kling-v1-6',
      'kling-v1-5',
    ]);
  });

  it('excludes Kling O1 models from standard kling.video routing', () => {
    const bindings = inferBindingsForProviderModel(
      {
        id: 'provider-kling',
        name: 'Kling Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'key-a',
        authType: 'bearer',
      },
      {
        id: 'kling-video-o1',
        label: 'Kling Video O1',
        type: 'video',
        vendor: ModelVendor.KLING,
      }
    );

    expect(bindings.some((binding) => binding.protocol === 'kling.video')).toBe(
      false
    );
    expect(
      bindings.some((binding) => binding.protocol === 'openai.async.video')
    ).toBe(true);
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

  it('routes tuzi gemini text models through google generateContent', () => {
    const bindings = inferBindingsForProviderModel(
      {
        id: 'provider-tuzi',
        name: 'Tuzi Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'key',
        authType: 'bearer',
      },
      {
        id: 'gemini-3.1-pro-preview-thinking',
        label: 'Gemini 3.1 Pro Preview Thinking',
        type: 'text',
        vendor: ModelVendor.GOOGLE,
      }
    );

    expect(bindings[0]?.protocol).toBe('google.generateContent');
    expect(bindings[0]?.requestSchema).toBe(
      'google.generate-content.chat-basic'
    );
    expect(bindings[0]?.baseUrlStrategy).toBe('trim-v1');
    expect(
      bindings.some((binding) => binding.protocol === 'openai.chat.completions')
    ).toBe(true);
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
