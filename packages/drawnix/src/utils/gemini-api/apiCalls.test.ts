// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callApiRaw,
  callApiWithRetry,
  callApiStreamRaw,
  callGoogleGenerateContentRaw,
  normalizeGoogleImageResponse,
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

vi.mock('../umami-analytics', () => ({
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

  it.each(['2K', '4K'])('serializes %s without dropping the image resolution tier', async (imageSize) => {
    const modelName = `gemini-3.1-flash-image-preview-${imageSize.toLowerCase()}`;
    await callGoogleGenerateContentRaw({
      apiKey: 'test-key', baseUrl: 'https://api.tu-zi.com/v1',
      modelName, protocol: 'google.generateContent', authType: 'bearer',
    }, [{ role: 'user', content: [{ type: 'text', text: 'draw' }] }], {
      stream: false,
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize } },
    });

    const [, request] = sendMock.mock.calls[0];
    expect(request.path).toContain(`/models/${modelName}:generateContent`);
    expect(JSON.parse(request.body).generationConfig).toEqual({
      responseModalities: ['IMAGE'], imageConfig: { imageSize },
    });
  });

  it('maps Nano Banana 2.1 references and excludes thought images from final output', async () => {
    sendMock.mockResolvedValue(Response.json({ candidates: [{ content: { parts: [
      { thought: true, inlineData: { mimeType: 'image/png', data: 'THOUGHT' } },
      { fileData: { mimeType: 'image/jpeg', fileUri: 'https://result.example/final.jpg' } },
      { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } },
    ] } }] }));
    const result = await callGoogleGenerateContentRaw({
      apiKey: 'test-key', baseUrl: 'https://api.tu-zi.com/v1',
      modelName: 'gemini-nano-banana-2.1', protocol: 'google.generateContent', authType: 'bearer',
      binding: {
        id: 'nb21', profileId: 'tuzi', modelId: 'gemini-nano-banana-2.1', operation: 'image',
        protocol: 'google.generateContent', requestSchema: 'google.generate-content.image-inline',
        responseSchema: 'google.generate-content.parts', submitPath: '/v1beta/models/{model}:generateContent',
        baseUrlStrategy: 'trim-v1', priority: 480, confidence: 'high', source: 'template',
      },
    }, [{ role: 'user', content: [
      { type: 'text', text: 'edit' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ] }], { stream: false, generationConfig: {
      responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K' }, thinkingConfig: { thinkingLevel: 'medium' },
    } });
    const [provider, request] = sendMock.mock.calls[0];
    expect(provider.authType).toBe('bearer');
    expect(request.path).toBe('/v1beta/models/gemini-nano-banana-2.1:generateContent');
    expect(request.baseUrlStrategy).toBe('trim-v1');
    expect(JSON.parse(request.body)).toMatchObject({
      contents: [{ parts: [{ text: 'edit' }, { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'medium' } },
    });
    expect(result.choices[0].message.content).toBe('https://result.example/final.jpg\ndata:image/jpeg;base64,AAAA');
    expect(normalizeGoogleImageResponse({ candidates: [{ content: { parts: [
      { thought: true, inlineData: { data: 'THOUGHT' } }, { inlineData: { data: 'AAAA' } },
    ] } }] }).data).toEqual([{ b64_json: 'AAAA', mime_type: 'image/png' }]);
  });

  describe('image reference MIME normalization', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=';
    const config = {
      apiKey: 'test-key',
      baseUrl: 'https://api.tu-zi.com/v1',
      modelName: 'gemini-nano-banana-2.1',
      protocol: 'google.generateContent' as const,
      authType: 'bearer' as const,
    };
    const submit = (urls: string[]) => callGoogleGenerateContentRaw(config, [{
      role: 'user',
      content: [
        { type: 'text', text: 'Combine these references' },
        ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    }], { stream: false, generationConfig: { responseModalities: ['IMAGE'] } });
    const requestParts = () => JSON.parse(sendMock.mock.calls[0][1].body).contents[0].parts;
    const pngBytes = () => Uint8Array.from(atob(png), (byte) => byte.charCodeAt(0));

    afterEach(() => vi.unstubAllGlobals());

    it('repairs a binary MIME second reference without changing bytes or order', async () => {
      const jpeg = '/9j/4A==';
      await submit([
        `data:image/jpeg;base64,${jpeg}`,
        `data:application/octet-stream;base64,${png}`,
      ]);
      expect(requestParts()).toEqual([
        { text: 'Combine these references' },
        { inline_data: { mime_type: 'image/jpeg', data: jpeg } },
        { inline_data: { mime_type: 'image/png', data: png } },
      ]);
    });

    it.each([
      ['JPEG', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
      ['GIF', Array.from('GIF89a', (c) => c.charCodeAt(0)), 'image/gif'],
      ['WebP', Array.from('RIFF0000WEBP', (c) => c.charCodeAt(0)), 'image/webp'],
      ['AVIF', [0, 0, 0, 24, ...Array.from('ftypavif', (c) => c.charCodeAt(0))], 'image/avif'],
    ])('recognizes %s bytes in generic binary data URLs', async (_format, bytes, mimeType) => {
      const data = btoa(String.fromCharCode(...bytes));
      await submit([`data:application/octet-stream;base64,${data}`]);
      expect(requestParts()[1]).toEqual({ inline_data: { mime_type: mimeType, data } });
    });

    it.each(['', 'application/octet-stream', 'binary/octet-stream'])(
      'recognizes cached image bytes with MIME %j', async (type) => {
        getCachedBlobMock.mockResolvedValue(new Blob([pngBytes()], { type }));
        await submit(['https://example.com/__aitu_cache__/image/reference']);
        expect(requestParts()[1]).toEqual({ inline_data: { mime_type: 'image/png', data: png } });
      }
    );

    it('recognizes a downloaded image with a generic Content-Type', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob([pngBytes()], { type: 'application/octet-stream' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      await submit(['https://images.example.com/reference']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestParts()[1]).toEqual({ inline_data: { mime_type: 'image/png', data: png } });
    });

    it('recognizes an image in a data URL without a MIME', async () => {
      await submit([`data:;base64,${png}`]);
      expect(requestParts()[1]).toEqual({ inline_data: { mime_type: 'image/png', data: png } });
    });

    it.each([
      ['application/octet-stream', btoa('<html>error</html>')],
      ['application/octet-stream', btoa('RIFF0000WAVE')],
      ['application/octet-stream', '%%%invalid-base64%%%'],
      ['text/html', btoa('<html>error</html>')],
    ])('rejects invalid second image %s before submitting', async (mimeType, data) => {
      await expect(submit([
        `data:image/png;base64,${png}`,
        `data:${mimeType};base64,${data}`,
      ])).rejects.toThrow(/第 2 张参考图/);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('rejects an empty cached image before submitting', async () => {
      getCachedBlobMock.mockResolvedValue(new Blob([], { type: 'application/octet-stream' }));
      await expect(submit(['https://example.com/__aitu_cache__/image/reference']))
        .rejects.toThrow(/第 1 张参考图/);
      expect(sendMock).not.toHaveBeenCalled();
    });
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

  it('uses manual chat binding submit path for non-stream calls', async () => {
    sendMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );

    await callApiRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com/v1',
        modelName: 'custom-chat',
        authType: 'bearer',
        binding: {
          id: 'binding',
          profileId: 'provider-a',
          modelId: 'custom-chat',
          operation: 'text',
          protocol: 'openai.chat.completions',
          requestSchema: 'openai.chat.messages',
          responseSchema: 'openai.chat.choices',
          submitPath: '/custom/chat',
          baseUrlStrategy: 'trim-v1',
          priority: 900,
          confidence: 'high',
          source: 'manual',
        },
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ]
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.example.com/v1',
      }),
      expect.objectContaining({
        path: '/custom/chat',
        baseUrlStrategy: 'trim-v1',
        method: 'POST',
      })
    );
  });

  it('uses manual chat binding submit path for stream calls', async () => {
    const encoder = new TextEncoder();
    sendMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
              )
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
          },
        }
      )
    );

    await callApiStreamRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com/v1',
        modelName: 'custom-chat',
        authType: 'bearer',
        binding: {
          id: 'binding',
          profileId: 'provider-a',
          modelId: 'custom-chat',
          operation: 'text',
          protocol: 'openai.chat.completions',
          requestSchema: 'openai.chat.messages',
          responseSchema: 'openai.chat.choices',
          submitPath: '/custom/stream-chat',
          baseUrlStrategy: 'trim-v1',
          priority: 900,
          confidence: 'high',
          source: 'manual',
        },
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ]
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.example.com/v1',
      }),
      expect.objectContaining({
        path: '/custom/stream-chat',
        baseUrlStrategy: 'trim-v1',
        method: 'POST',
      })
    );
  });
});
