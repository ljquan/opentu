// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callApiRaw,
  callApiWithRetry,
  callGoogleGenerateContentRaw,
} from './apiCalls';

const { sendMock, analyticsMock, getCachedBlobMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getCachedBlobMock: vi.fn(),
  analyticsMock: {
    trackAPICallStart: vi.fn(),
    trackAPICallSuccess: vi.fn(),
    trackAPICallFailure: vi.fn(),
  },
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: (...args: unknown[]) => getCachedBlobMock(...args),
  },
}));

vi.mock('../../services/provider-routing', () => ({
  providerTransport: {
    send: (...args: unknown[]) => sendMock(...args),
  },
  readProviderResponseJson: <T>(response: Response) =>
    response.json() as Promise<T>,
  readProviderResponseText: (response: Response) => response.text(),
}));

vi.mock('../posthog-analytics', () => ({
  analytics: analyticsMock,
  getProviderEndpointAnalytics: (baseUrl?: string | null) => {
    if (!baseUrl) return null;
    const url = new URL(baseUrl);
    return {
      origin: url.origin,
      host: url.host,
      protocol: url.protocol.replace(':', ''),
    };
  },
}));

describe('callGoogleGenerateContentRaw', () => {
  beforeEach(() => {
    sendMock.mockReset();
    analyticsMock.trackAPICallStart.mockReset();
    analyticsMock.trackAPICallSuccess.mockReset();
    analyticsMock.trackAPICallFailure.mockReset();
    getCachedBlobMock.mockReset();

    sendMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'ok' }],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
  });

  it('forwards AbortSignal through non-stream manual HTTP calls', async () => {
    const controller = new AbortController();
    sendMock.mockResolvedValue(
      new Response(JSON.stringify({ result: { text: 'manual ok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await callApiRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com',
        modelName: 'manual-text',
        binding: {
          id: 'manual-text-binding',
          profileId: 'provider-a',
          modelId: 'manual-text',
          operation: 'text',
          protocol: 'custom-http',
          requestSchema: 'custom-http',
          responseSchema: 'custom-http.text',
          submitPath: '/text',
          priority: 100,
          confidence: 'high',
          source: 'manual',
          metadata: {
            manualHttp: {
              method: 'POST',
              bodyTemplate: '{"prompt":"{{prompt}}"}',
              responsePaths: { text: 'result.text' },
            },
          },
        },
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'build an outline' }],
        },
      ],
      controller.signal
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('forwards an already-aborted signal through non-stream Google calls', async () => {
    const controller = new AbortController();
    controller.abort();

    await callApiRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com',
        modelName: 'gemini-text',
        protocol: 'google.generateContent',
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'build an outline' }],
        },
      ],
      controller.signal
    );

    const [, request] = sendMock.mock.calls[0];
    expect((request as { signal?: AbortSignal }).signal?.aborted).toBe(true);
  });

  it('forwards AbortSignal through the non-stream OpenAI wrapper', async () => {
    const controller = new AbortController();
    sendMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'openai ok' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    await callApiWithRetry(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com',
        modelName: 'openai-text',
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'build an outline' }],
        },
      ],
      controller.signal
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('tracks http failures once', async () => {
    sendMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad request' } }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );

    await expect(
      callGoogleGenerateContentRaw(
        {
          apiKey: 'secret',
          baseUrl: 'https://api.example.com',
          modelName: 'gemini-3.1-flash-image-preview-4k',
          protocol: 'google.generateContent',
          authType: 'query',
        },
        [
          {
            role: 'user',
            content: [{ type: 'text', text: 'draw a cat' }],
          },
        ],
        { stream: false }
      )
    ).rejects.toThrow('HTTP 400: bad request');

    expect(analyticsMock.trackAPICallFailure).toHaveBeenCalledTimes(1);
  });

  it('uses provider baseUrl for analytics host', async () => {
    await callGoogleGenerateContentRaw(
      {
        apiKey: 'secret',
        baseUrl: '',
        modelName: 'gemini-3.1-flash-image-preview-4k',
        protocol: 'google.generateContent',
        authType: 'query',
        provider: {
          profileId: 'provider-a',
          profileName: 'Provider A',
          providerType: 'gemini-compatible',
          baseUrl: 'https://provider.example.com/v1beta',
          apiKey: 'secret',
          authType: 'query',
        },
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'draw a cat' }],
        },
      ],
      { stream: false }
    );

    expect(analyticsMock.trackAPICallStart).toHaveBeenCalledWith(
      expect.objectContaining({
        providerHost: 'provider.example.com',
        providerOrigin: 'https://provider.example.com',
      })
    );
  });

  it('serializes inline data with google contents parts and mime_type', async () => {
    await callGoogleGenerateContentRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com/v1',
        modelName: 'gemini-3.1-pro-preview-thinking',
        protocol: 'google.generateContent',
        authType: 'bearer',
      },
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: '分析视频中的具体应用场景.' },
            { type: 'inline_data', mimeType: 'video/mp4', data: 'VIDEO_B64' },
          ],
        },
      ],
      { stream: false }
    );

    const [, request] = sendMock.mock.calls[0];
    const body = JSON.parse(String((request as { body: string }).body));

    expect(body).toMatchObject({
      contents: [
        {
          parts: [
            { text: '分析视频中的具体应用场景.' },
            {
              inline_data: {
                mime_type: 'video/mp4',
                data: 'VIDEO_B64',
              },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('mimeType');
    expect(body).not.toHaveProperty('messages');
  });

  it('Cache API 不可用时从 unified cache 恢复虚拟图片', async () => {
    const virtualUrl = '/__aitu_cache__/image/cached-reference.png';
    const fetchMock = vi.fn();
    getCachedBlobMock.mockResolvedValue(
      new Blob(['cached-image'], { type: 'image/png' })
    );
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('fetch', fetchMock);

    try {
      await callGoogleGenerateContentRaw(
        {
          apiKey: 'secret',
          baseUrl: 'https://api.example.com/v1',
          modelName: 'gemini-3.1-pro-preview-thinking',
          protocol: 'google.generateContent',
          authType: 'bearer',
        },
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: '分析这张图' },
              { type: 'image_url', image_url: { url: virtualUrl } },
            ],
          },
        ],
        { stream: false }
      );
    } finally {
      vi.unstubAllGlobals();
    }

    const [, request] = sendMock.mock.calls[0];
    const body = JSON.parse(String((request as { body: string }).body));
    expect(getCachedBlobMock).toHaveBeenCalledWith(virtualUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.contents[0].parts[1]).toEqual({
      inline_data: {
        mime_type: 'image/png',
        data: 'Y2FjaGVkLWltYWdl',
      },
    });
  });

  it('normalizes legacy generateContent paths missing the models segment', async () => {
    await callGoogleGenerateContentRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com',
        modelName: 'gemini-3.1-flash-image-preview-4k',
        protocol: 'google.generateContent',
        authType: 'query',
        binding: {
          id: 'binding',
          profileId: 'provider-a',
          modelId: 'gemini-3.1-flash-image-preview-4k',
          operation: 'image',
          protocol: 'google.generateContent',
          requestSchema: 'google.generate-content.image-inline',
          responseSchema: 'google.generate-content.parts',
          submitPath: '/v1beta/{model}:generateContent',
          baseUrlStrategy: 'trim-v1',
          priority: 100,
          confidence: 'high',
          source: 'manual',
        },
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'draw a cat' }],
        },
      ],
      { stream: false }
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.example.com',
      }),
      expect.objectContaining({
        path: '/v1beta/models/gemini-3.1-flash-image-preview-4k:generateContent',
        baseUrlStrategy: 'trim-v1',
        method: 'POST',
      })
    );
  });

  it('adds the stable image request ID to Google submissions', async () => {
    await callGoogleGenerateContentRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com',
        modelName: 'gemini-image',
        protocol: 'google.generateContent',
        authType: 'bearer',
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'draw a cat' }],
        },
      ],
      { stream: false, requestId: 'task-google-image-1' }
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
        },
        requestId: 'task-google-image-1',
      })
    );
  });
});
