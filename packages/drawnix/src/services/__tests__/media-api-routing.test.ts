import { describe, expect, it, vi } from 'vitest';
import {
  generateImageSync,
  resumeAsyncImagePolling,
  submitVideoGeneration,
} from '../media-api';

describe('media-api provider routing', () => {
  it('uses header auth and extra headers for sync image generation', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.com/v1/images/generations');
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-API-Key']).toBe('secret');
      expect(headers['X-Trace-Id']).toBe('trace-1');

      return new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn.example.com/image.png' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const result = await generateImageSync(
      {
        prompt: 'test prompt',
        model: 'gemini-3-pro-image-preview',
      },
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com/v1',
        authType: 'header',
        extraHeaders: {
          'X-Trace-Id': 'trace-1',
        },
        fetchImpl,
      }
    );

    expect(result.url).toBe('https://cdn.example.com/image.png');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses query auth for async image polling endpoints', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://gateway.example.com/v1/videos/task-1?key=secret');

      return new Response(
        JSON.stringify({
          id: 'task-1',
          status: 'completed',
          url: 'https://cdn.example.com/final.png',
          progress: 100,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const result = await resumeAsyncImagePolling('task-1', {
      apiKey: 'secret',
      baseUrl: 'https://gateway.example.com/v1',
      providerType: 'gemini-compatible',
      authType: 'query',
      fetchImpl,
    });

    expect(result.url).toBe('https://cdn.example.com/final.png');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses bearer auth for shared video submission', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://video.example.com/v1/videos');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer video-secret');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);

      return new Response(
        JSON.stringify({
          id: 'video-task-1',
          status: 'queued',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const remoteId = await submitVideoGeneration(
      {
        prompt: 'make a video',
        model: 'veo3',
      },
      {
        apiKey: 'video-secret',
        baseUrl: 'https://video.example.com/v1',
        authType: 'bearer',
        fetchImpl,
      }
    );

    expect(remoteId).toBe('video-task-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
