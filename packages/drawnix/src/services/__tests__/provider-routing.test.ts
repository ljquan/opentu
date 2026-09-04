import { describe, expect, it, vi } from 'vitest';
import {
  getTextBindingMaxImageCount,
  inferBindingsForProviderModel,
  InvocationPlanner,
  InvocationPlanningError,
  supportsTextBindingImageInput,
} from '../provider-routing';
import {
  IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
  isImageSubmissionOutcomeUnknownError,
  providerTransport,
  readProviderResponseJson,
  readProviderResponseText,
} from '../provider-routing';
import { canAttachProviderRequestIdHeader } from '../provider-routing';
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

const tuziTransportContext = {
  profileId: 'provider-tuzi',
  profileName: 'Tuzi',
  providerType: 'openai-compatible',
  baseUrl: 'https://api.tu-zi.com/v1',
  apiKey: 'secret',
  authType: 'bearer',
} as const;

const tuziRequestIdTransportContext = {
  ...tuziTransportContext,
  baseUrl: 'https://bus.tu-zi.com/v1',
} as const;

function sendTuzi(
  request: Parameters<typeof providerTransport.send>[1]
): Promise<Response> {
  return providerTransport.send(tuziTransportContext, request);
}

function sendRecoverableTuzi(
  request: Parameters<typeof providerTransport.send>[1]
): Promise<Response> {
  return providerTransport.send(tuziRequestIdTransportContext, request);
}

const didNotSettle = Symbol('did not settle');

function settleWithin<T>(promise: Promise<T>, timeoutMs = 100) {
  return new Promise<T | typeof didNotSettle>((resolve, reject) => {
    const timeoutId = setTimeout(() => resolve(didNotSettle), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function spyOnResponseBodyCancel(response: Response) {
  const body = response.body;
  if (!body) {
    throw new Error('Expected response body');
  }
  return vi.spyOn(body, 'cancel');
}

describe('provider routing', () => {
  it('uses the configured Tuzi URL on opentu.ai without generating a proxy path', async () => {
    vi.stubGlobal('location', { hostname: 'opentu.ai' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));

    try {
      await sendTuzi({ path: '/models', method: 'GET', fetcher });

      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        'https://api.tu-zi.com/v1/models'
      );
      expect(String(fetcher.mock.calls[0]?.[0])).not.toContain(
        '/__opentu_tuzi_proxy__/'
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
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

  it('keeps the configured main Tuzi endpoint and omits Request ID', () => {
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
    expect(prepared.url).toBe('https://api.tu-zi.com/v1/images/generations');
    expect(prepared.headers['X-Request-Id']).toBeUndefined();
  });

  it('keeps a failed main Tuzi submission on the configured endpoint', async () => {
    const networkError = new Error('Failed to fetch');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

    await expect(
      sendTuzi({
        path: '/images/generations',
        method: 'POST',
        requestId: 'main-endpoint-task-id',
        fetcher,
      })
    ).rejects.toBe(networkError);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.tu-zi.com/v1/images/generations'
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      'X-Request-Id'
    );
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

  it.each(['/images/generations', '/images/edits'])(
    'never retries the configured compatible endpoint for %s',
    async (path) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('Failed to fetch'));

      await expect(
        sendRecoverableTuzi({
          path,
          method: 'POST',
          requestId: 'single-submit-task-id',
          fetcher,
        })
      ).rejects.toMatchObject({
        code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
        name: 'ImageSubmissionOutcomeUnknownError',
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        `https://bus.tu-zi.com/v1${path}`
      );
    }
  );

  it('preserves a fetch error when image recovery is explicitly disabled', async () => {
    const networkError = new Error('Failed to fetch');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

    await expect(
      sendRecoverableTuzi({
        path: '/images/generations',
        method: 'POST',
        requestId: 'disabled-network-recovery',
        allowImageSubmissionOutcomeRecovery: false,
        fetcher,
      })
    ).rejects.toBe(networkError);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    'fetch failed',
    'connection terminated',
    'read ECONNRESET',
    'ERR_HTTP2_PROTOCOL_ERROR',
    'network connection was lost',
  ])(
    'recognizes %s as an unknown image submission outcome',
    async (message) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error(message));

      await expect(
        sendRecoverableTuzi({
          path: '/images/generations',
          method: 'POST',
          requestId: 'expanded-network-error-task-id',
          fetcher,
        })
      ).rejects.toMatchObject({
        code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['Failed to fetch', 'connection terminated'])(
    'does not retry a non-image POST after %s without a Request ID',
    async (message) => {
      const networkError = new Error(message);
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

      await expect(
        sendTuzi({
          path: '/videos',
          method: 'POST',
          fetcher,
        })
      ).rejects.toBe(networkError);

      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('does not recover an image submission when the prepared request omits Request ID', async () => {
    const networkError = new Error('Failed to fetch');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

    await expect(
      sendTuzi({
        path: 'https://apius.tu-zi.com/v1/images/generations',
        method: 'POST',
        requestId: 'request-id-not-sent',
        fetcher,
      })
    ).rejects.toBe(networkError);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      'X-Request-Id'
    );
  });

  it('marks an interrupted successful image response body as an unknown outcome', async () => {
    let emittedPartialBody = false;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!emittedPartialBody) {
              emittedPartialBody = true;
              controller.enqueue(new TextEncoder().encode('{"data":['));
              return;
            }
            controller.error(new Error('response stream disconnected'));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'body-stream-task-id',
      fetcher,
    });

    await expect(readProviderResponseJson(response)).rejects.toMatchObject({
      code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads a large b64_json response split across many stream chunks', async () => {
    const b64Json = 'A'.repeat(4 * 1024 * 1024);
    const encodedPayload = new TextEncoder().encode(
      JSON.stringify({ data: [{ b64_json: b64Json }] })
    );
    let offset = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset >= encodedPayload.byteLength) {
              controller.close();
              return;
            }

            const nextOffset = Math.min(
              offset + 1024,
              encodedPayload.byteLength
            );
            controller.enqueue(encodedPayload.subarray(offset, nextOffset));
            offset = nextOffset;
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'large-chunked-body-task-id',
      fetcher,
    });
    const result = await readProviderResponseJson<{
      data: Array<{ b64_json: string }>;
    }>(response);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.b64_json).toBe(b64Json);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized successful response from Content-Length before reading it', async () => {
    const oversizedResponse = new Response('{"data":[]}', {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(64 * 1024 * 1024 + 1),
      },
    });
    const cancelBody = spyOnResponseBodyCancel(oversizedResponse);
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'oversized-content-length-task-id',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(oversizedResponse),
    });

    const thrown = await readProviderResponseJson(response).catch(
      (error: unknown) => error
    );

    expect(thrown).toMatchObject({
      name: 'ProviderResponseTooLargeError',
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
    });
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('rejects an error response when streamed bytes exceed the smaller limit', async () => {
    const chunk = new Uint8Array(600 * 1024);
    const cancelBody = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel: cancelBody,
      }),
      { status: 500 }
    );

    const thrown = await readProviderResponseText(response).catch(
      (error: unknown) => error
    );

    expect(thrown).toMatchObject({
      name: 'ProviderResponseTooLargeError',
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
    });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('preserves a response stream error when image recovery is explicitly disabled', async () => {
    const streamError = new Error('response stream disconnected');
    let emittedPartialBody = false;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!emittedPartialBody) {
              emittedPartialBody = true;
              controller.enqueue(new TextEncoder().encode('{"data":['));
              return;
            }
            controller.error(streamError);
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'disabled-stream-recovery',
      allowImageSubmissionOutcomeRecovery: false,
      fetcher,
    });

    await expect(readProviderResponseJson(response)).rejects.toBe(streamError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats normally closed incomplete JSON as a definite protocol error', async () => {
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'truncated-body-task-id',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"data":[', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      ),
    });

    const thrown = await readProviderResponseJson(response).catch(
      (error: unknown) => error
    );

    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
  });

  it('preserves bracket-prefixed plain text from a custom image response', async () => {
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'plain-text-response-task-id',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('[plain text', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      ),
    });

    await expect(readProviderResponseText(response)).resolves.toBe(
      '[plain text'
    );
  });

  it('does not infer a stream interruption from normally closed JSON-like text', async () => {
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'declared-json-response-task-id',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('[plain text', {
          status: 200,
          headers: { 'Content-Type': 'application/problem+json' },
        })
      ),
    });

    await expect(readProviderResponseText(response)).resolves.toBe(
      '[plain text'
    );
  });

  it('preserves a complete malformed JSON response as a protocol error', async () => {
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'malformed-json-task-id',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      ),
    });

    const thrown = await readProviderResponseJson(response).catch(
      (error: unknown) => error
    );

    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
  });

  it('treats normally closed JSON with an unterminated string as a protocol error', async () => {
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'unterminated-string-task-id',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"data":"unterminated}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      ),
    });

    const thrown = await readProviderResponseJson(response).catch(
      (error: unknown) => error
    );

    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
  });

  it('does not classify an already consumed response body as an unknown outcome', async () => {
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'consumed-body-task-id',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"data":[]}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      ),
    });

    await response.text();
    const thrown = await readProviderResponseJson(response).catch(
      (error: unknown) => error
    );

    expect(thrown).toBeInstanceOf(TypeError);
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
  });

  it('preserves cancellation while reading an image response body', async () => {
    const requestController = new AbortController();
    const bodyError = new Error('Failed to fetch');
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":['));
            signal?.addEventListener(
              'abort',
              () => controller.error(bodyError),
              { once: true }
            );
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'cancelled-body-task-id',
      signal: requestController.signal,
      fetcher,
    });

    const readPromise = readProviderResponseJson(response).catch(
      (error: unknown) => error
    );
    requestController.abort();
    const thrown = await readPromise;

    expect(thrown).toBe(bodyError);
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
  });

  it('preserves timeout semantics while reading an image response body', async () => {
    const bodyError = new Error('Failed to fetch');
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener(
              'abort',
              () => controller.error(bodyError),
              { once: true }
            );
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'timed-out-body-task-id',
      timeoutMs: 5,
      fetcher,
    });

    const thrown = await readProviderResponseJson(response).catch(
      (error: unknown) => error
    );

    expect(thrown).toMatchObject({ name: 'TimeoutError' });
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
  });

  it('times out while reading a hanging image error response body', async () => {
    const cancelBody = vi.fn();
    const response = await sendTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'hanging-error-body-task-id',
      timeoutMs: 5,
      controlledResponseBody: true,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
          status: 500,
        })
      ),
    });

    const readPromise = readProviderResponseText(response).catch(
      (error: unknown) => error
    );
    const thrown = await settleWithin(readPromise);

    expect(thrown).not.toBe(didNotSettle);
    expect(thrown).toMatchObject({ name: 'TimeoutError' });
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('times out a hanging non-recoverable success body without image recovery', async () => {
    const cancelBody = vi.fn();
    const response = await sendTuzi({
      path: '/chat/completions',
      method: 'POST',
      timeoutMs: 5,
      controlledResponseBody: true,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
          status: 200,
        })
      ),
    });

    const readPromise = readProviderResponseJson(response).catch(
      (error: unknown) => error
    );
    const thrown = await settleWithin(readPromise);

    expect(thrown).not.toBe(didNotSettle);
    expect(thrown).toMatchObject({ name: 'TimeoutError' });
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('cleans up response timeout state when the caller uses a native body reader', async () => {
    let transportSignal: AbortSignal | undefined;
    const response = await sendTuzi({
      path: '/chat/completions',
      method: 'POST',
      timeoutMs: 5,
      fetcher: vi.fn<typeof fetch>(async (_url, init) => {
        transportSignal = init?.signal || undefined;
        return Response.json({ choices: [] });
      }),
    });

    await expect(response.json()).resolves.toEqual({ choices: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(transportSignal?.aborted).toBe(false);
  });

  it('settles timeout when a response stream ignores abort and never closes', async () => {
    let failBody: ((error: Error) => void) | undefined;
    const cancelBody = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":['));
            failBody = (error) => controller.error(error);
          },
          cancel: cancelBody,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'ignored-timeout-task-id',
      timeoutMs: 5,
      fetcher,
    });

    const readPromise = readProviderResponseJson(response).catch(
      (error: unknown) => error
    );
    const thrown = await settleWithin(readPromise);
    if (thrown === didNotSettle) {
      failBody?.(new Error('test cleanup'));
      await readPromise;
    }

    expect(thrown).not.toBe(didNotSettle);
    expect(thrown).toMatchObject({ name: 'TimeoutError' });
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation when a response stream ignores abort and never closes', async () => {
    const requestController = new AbortController();
    const cancellation = new Error('cancelled by user');
    let failBody: ((error: Error) => void) | undefined;
    const cancelBody = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":['));
            failBody = (error) => controller.error(error);
          },
          cancel: cancelBody,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const response = await sendRecoverableTuzi({
      path: '/images/generations',
      method: 'POST',
      requestId: 'ignored-cancellation-task-id',
      signal: requestController.signal,
      fetcher,
    });

    const readPromise = readProviderResponseJson(response).catch(
      (error: unknown) => error
    );
    requestController.abort(cancellation);
    const thrown = await settleWithin(readPromise);
    if (thrown === didNotSettle) {
      failBody?.(new Error('test cleanup'));
      await readPromise;
    }

    expect(thrown).not.toBe(didNotSettle);
    expect(thrown).toBe(cancellation);
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('does not treat an aborted Request-ID submission as an unknown outcome', async () => {
    const controller = new AbortController();
    controller.abort();
    const networkError = new Error('Failed to fetch');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

    let thrown: unknown;
    try {
      await sendRecoverableTuzi({
        path: '/images/generations',
        method: 'POST',
        requestId: 'cancelled-task-id',
        signal: controller.signal,
        fetcher,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(networkError);
    expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['video submission', '/videos'],
    [
      'generateContent submission',
      '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    ],
  ])(
    'does not mark a trusted Tuzi %s network error as an unknown image outcome',
    async (_label, path) => {
      const networkError = new Error('Failed to fetch');
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

      let thrown: unknown;
      try {
        await sendTuzi({
          path,
          method: 'POST',
          requestId: 'non-image-submission-id',
          fetcher,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBe(networkError);
      expect(isImageSubmissionOutcomeUnknownError(thrown)).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['GET', 'HEAD'])(
    'removes Request ID headers from trusted Tuzi %s requests',
    (method) => {
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
          method,
          headers: { 'X-REQUEST-ID': 'stale-request-id' },
        }
      );

      expect(
        Object.keys(prepared.headers).some(
          (name) => name.toLowerCase() === 'x-request-id'
        )
      ).toBe(false);
    }
  );

  it.each([
    ['GET', 'Failed to fetch'],
    ['GET', 'connection terminated'],
    ['HEAD', 'connection terminated'],
  ])(
    'does not switch the configured endpoint for %s after %s',
    async (method, message) => {
      const networkError = new Error(message);
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

      await expect(
        sendTuzi({
          path: '/images/generations/result',
          method,
          requestId: 'get-request-id-that-must-not-change-routing',
          fetcher,
        })
      ).rejects.toBe(networkError);

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        'https://api.tu-zi.com/v1/images/generations/result'
      );
      expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
        'X-Request-Id'
      );
    }
  );

  it('does not leak Request ID to an absolute third-party path', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
        extraHeaders: {
          'x-request-id': 'stale-profile-request-id',
          'X-Tuzi-Profile': 'must-not-leak',
        },
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
    expect(prepared.headers.Authorization).toBeUndefined();
    expect(prepared.headers['X-Tuzi-Profile']).toBeUndefined();
  });

  it('does not leak Tuzi query credentials to an absolute third-party path', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi-query',
        profileName: 'Tuzi Query',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret-query-key',
        authType: 'query',
      },
      {
        path: 'https://images.example.com/v1/images/generations',
        method: 'POST',
      }
    );

    expect(prepared.url).toBe(
      'https://images.example.com/v1/images/generations'
    );
    expect(prepared.url).not.toContain('secret-query-key');
  });

  it('does not leak Tuzi credentials to a different trusted absolute origin', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
        extraHeaders: { 'X-Tuzi-Profile': 'private-profile-header' },
      },
      {
        path: 'https://apius.tu-zi.com/v1/images/generations',
        method: 'POST',
        requestId: 'cross-origin-request-id',
      }
    );

    expect(prepared.url).toBe('https://apius.tu-zi.com/v1/images/generations');
    expect(prepared.headers.Authorization).toBeUndefined();
    expect(prepared.headers['X-Tuzi-Profile']).toBeUndefined();
    expect(prepared.headers['X-Request-Id']).toBeUndefined();
  });

  it('does not leak Tuzi query credentials to a different trusted absolute origin', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-tuzi-query',
        profileName: 'Tuzi Query',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret-query-key',
        authType: 'query',
      },
      {
        path: 'https://apius.tu-zi.com/v1/images/generations',
        method: 'POST',
      }
    );

    expect(prepared.url).toBe('https://apius.tu-zi.com/v1/images/generations');
    expect(prepared.url).not.toContain('secret-query-key');
  });

  it.each([
    ['bearer', 'Authorization'],
    ['header', 'X-API-Key'],
  ] as const)(
    'does not leak generic provider %s credentials or profile headers across origins',
    (authType, credentialHeader) => {
      const body = JSON.stringify({ prompt: 'keep explicit body' });
      const prepared = providerTransport.prepareRequest(
        {
          profileId: `provider-generic-${authType}`,
          profileName: 'Generic Provider',
          providerType: 'custom',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'secret-profile-key',
          authType,
          extraHeaders: {
            'X-Profile-Secret': 'must-not-leak',
          },
        },
        {
          path: 'https://uploads.example.net/v1/images/generations',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Explicit-Request': 'keep-me',
          },
          body,
        }
      );

      expect(prepared.url).toBe(
        'https://uploads.example.net/v1/images/generations'
      );
      expect(prepared.headers[credentialHeader]).toBeUndefined();
      expect(prepared.headers['X-Profile-Secret']).toBeUndefined();
      expect(prepared.headers['X-Explicit-Request']).toBe('keep-me');
      expect(prepared.init.body).toBe(body);
    }
  );

  it('does not leak generic provider query credentials across origins', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-generic-query',
        profileName: 'Generic Query Provider',
        providerType: 'gemini-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-query-key',
        authType: 'query',
        extraHeaders: {
          'X-Profile-Secret': 'must-not-leak',
        },
      },
      {
        path: 'https://uploads.example.net/v1/images/generations',
        method: 'POST',
        query: {
          trace: 'keep-explicit-query',
          api_key: 'explicit-request-key',
        },
      }
    );

    const preparedUrl = new URL(prepared.url);
    expect(`${preparedUrl.origin}${preparedUrl.pathname}`).toBe(
      'https://uploads.example.net/v1/images/generations'
    );
    expect(preparedUrl.searchParams.get('trace')).toBe('keep-explicit-query');
    expect(preparedUrl.searchParams.get('api_key')).toBe(
      'explicit-request-key'
    );
    expect(prepared.url).not.toContain('secret-query-key');
    expect(prepared.headers['X-Profile-Secret']).toBeUndefined();
  });

  it('keeps generic provider credentials for an absolute same-origin path', () => {
    const prepared = providerTransport.prepareRequest(
      {
        profileId: 'provider-generic-same-origin',
        profileName: 'Generic Same-Origin Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'same-origin-secret',
        authType: 'bearer',
        extraHeaders: {
          'X-Provider-Scope': 'keep-me',
        },
      },
      {
        path: 'https://api.example.com/v2/images/generations',
        method: 'POST',
      }
    );

    expect(prepared.headers.Authorization).toBe('Bearer same-origin-secret');
    expect(prepared.headers['X-Provider-Scope']).toBe('keep-me');
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

  it('does not replay an image POST after a gateway response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('status_code=504, bad response status code 504', {
        status: 504,
      })
    );

    const response = await sendTuzi({
      path: '/images/generations',
      method: 'POST',
      body: '{}',
      fetcher,
    });

    expect(response.status).toBe(504);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not switch endpoints when the configured Tuzi endpoint returns HTML', async () => {
    vi.stubGlobal('location', { hostname: 'opentu.ai' });
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
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      )
      .mockResolvedValueOnce(Response.json({ data: [{ url: 'image.png' }] }));

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
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        'https://api.tu-zi.com/v1/images/generations'
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
      const response = await sendTuzi({
        path: '/images/generations',
        method: 'POST',
        body: '{}',
        fetcher,
      });

      expect(response.status).toBe(503);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not replay an image POST after remote protocol termination', async () => {
    const networkError = new Error(
      'UpstreamRemoteProtocolError: <ConnectionTerminated error_code:ErrorCodes.NO_ERROR, last_stream_id:1, additional_data:None> | cause=RemoteProtocolError: <ConnectionTerminated error_code:ErrorCodes.NO_ERROR, last_stream_id:1, additional_data:None> | channel=CH#18 兔子 | url=https://api.tu-zi.com | body=2198889bytes | send_took=59866ms | active_upstream=2 | elapsed=61101ms'
    );
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);

    await expect(
      sendTuzi({
        path: '/images/generations',
        method: 'POST',
        body: '{}',
        fetcher,
      })
    ).rejects.toBe(networkError);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns an image 404 from the configured endpoint without switching', async () => {
    const notFoundResponse = new Response(
      '<!doctype html><title>Not Found</title>',
      { status: 404 }
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(notFoundResponse);

    const response = await sendTuzi({
      path: '/images/generations',
      baseUrlStrategy: 'ensure-v1',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2', prompt: 'test' }),
      fetcher,
    });

    expect(response).toBe(notFoundResponse);
    expect(response.status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.tu-zi.com/v1/images/generations'
    );
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
    expect(tuziBindings[1]?.protocol).toBe('openai.images.generations');
    expect(tuziBindings[1]?.submitPath).toBe('/images/generations');
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
    expect(bindings[1]?.submitPath).toBe('/images/generations');
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
    expect(bindings[1]?.submitPath).toBe('/images/generations');
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
