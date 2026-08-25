import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedanceVideoAdapter } from '../model-adapters/seedance-adapter';
import type { AdapterContext } from '../model-adapters/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createContext(fetcher: typeof fetch): AdapterContext {
  return {
    baseUrl: 'https://video.example.com/v1',
    apiKey: 'sk-test',
    authType: 'bearer',
    operation: 'video',
    fetcher,
  };
}

class CapturingFormData {
  private readonly values = new Map<string, unknown[]>();

  append(name: string, value: unknown): void {
    const values = this.values.get(name) || [];
    values.push(value);
    this.values.set(name, values);
  }

  get(name: string): FormDataEntryValue | null {
    return (this.values.get(name)?.[0] as FormDataEntryValue) || null;
  }

  getAll(name: string): FormDataEntryValue[] {
    return (this.values.get(name) || []) as FormDataEntryValue[];
  }
}

describe('legacy Seedance video adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a discovered physical model ID unchanged', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init: init || {} });
        return (init?.method || 'GET') === 'POST'
          ? jsonResponse({ id: 'seedance-task', status: 'queued' })
          : jsonResponse({
              id: 'seedance-task',
              status: 'completed',
              video_url: 'https://cdn.example.com/result.mp4',
            });
      }
    ) as unknown as typeof fetch;

    const resultPromise = seedanceVideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-1-5-pro_1080p',
        prompt: 'PPT narration',
        size: '1920x1080',
        duration: 5,
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;
    const submitBody = requests[0]?.init.body as FormData;

    expect(result.url).toBe('https://cdn.example.com/result.mp4');
    expect(submitBody.get('model')).toBe('doubao-seedance-1-5-pro_1080p');
    expect(submitBody.get('size')).toBe('16:9');
  });

  it('still converts a legacy logical model ID with the selected resolution', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'captured' } }, 400)
    ) as unknown as typeof fetch;

    await expect(
      seedanceVideoAdapter.generateVideo(createContext(fetcher), {
        model: 'seedance-1.5-pro',
        prompt: 'logical model',
        size: '1080p@16:9',
      })
    ).rejects.toThrow('captured');

    const submitBody = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(submitBody.get('model')).toBe('doubao-seedance-1-5-pro_1080p');
  });

  it('recognizes a discovered physical lite model as reference-input mode', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'captured' } }, 400)
    ) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    const originalFormData = globalThis.FormData;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(new Blob(['image'], { type: 'image/png' }))
      )
    );
    vi.stubGlobal(
      'FormData',
      CapturingFormData as unknown as typeof globalThis.FormData
    );

    try {
      await expect(
        seedanceVideoAdapter.generateVideo(createContext(fetcher), {
          model: 'doubao-seedance-1-0-lite_720p',
          prompt: 'lite reference',
          referenceImages: ['https://assets.example.com/reference.png'],
        })
      ).rejects.toThrow('captured');
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      vi.stubGlobal('FormData', originalFormData);
    }

    const submitBody = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(submitBody.get('model')).toBe('doubao-seedance-1-0-lite_720p');
    expect(submitBody.getAll('input_reference')).toHaveLength(1);
    expect(submitBody.get('first_frame_image')).toBeNull();
  });

  it('preserves non-JSON upstream diagnostics and request IDs', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('upstream unavailable: model channel exhausted', {
          status: 503,
          headers: { 'x-request-id': 'req-123' },
        })
    ) as unknown as typeof fetch;

    await expect(
      seedanceVideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-1-5-pro_1080p',
        prompt: 'diagnostics',
      })
    ).rejects.toThrow(
      'upstream unavailable: model channel exhausted (request id: req-123)'
    );
  });

  it('rejects a similar but unsupported physical model before network access', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      seedanceVideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-1-5-pro-custom_1080p',
        prompt: 'invalid physical model',
      })
    ).rejects.toThrow('不支持的 Seedance 物理模型');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
