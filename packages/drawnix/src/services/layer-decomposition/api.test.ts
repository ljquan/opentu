import { describe, expect, it, vi } from 'vitest';
import {
  createLayerDecompositionApiClient,
  DEFAULT_LAYER_DECOMPOSITION_API_URL,
  LayerDecompositionCorrectionRequiredError,
  isPublicHttpImageSource,
  parseLayerDecompositionJobResponse,
  resolveLayerDecompositionApiUrl,
} from './api';
import type { LayerArtifactPayload } from './types';

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedImageBlobWithThumbnailFallback: vi.fn().mockResolvedValue(null),
  },
}));

function layer(zIndex: number): LayerArtifactPayload {
  return {
    url: `https://cdn.example.com/layer-${zIndex}.png`,
    z_index: zIndex,
    bounding_box: {
      absolute: zIndex === 0 ? [0, 0, 100, 50] : [10, 5, 40, 25],
      normalized: zIndex === 0 ? [0, 0, 1000, 1000] : [100, 100, 400, 500],
    },
    name: zIndex === 0 ? '背景' : '人物',
    description: '',
  };
}

function completedPayload(taskId = 'task-1') {
  return {
    task_id: taskId,
    status: 'completed',
    progress: 1,
    result: { group_id: 'group-1', data: [layer(0), layer(1)] },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('layer-decomposition API', () => {
  it.each(['pending', 'running'] as const)(
    '%s 状态允许服务端返回 data: null',
    (status) => {
      const job = parseLayerDecompositionJobResponse({
        task_id: 'task-null-data',
        status,
        phase: status === 'pending' ? 'queued' : 'extracting',
        progress: status === 'pending' ? 0 : 0.1,
        data: null,
        error: null,
      });
      expect(job).toMatchObject({
        taskId: 'task-null-data',
        status,
      });
      expect(job.result).toBeUndefined();
    }
  );

  it('resolves same-origin and configured absolute endpoints', () => {
    expect(resolveLayerDecompositionApiUrl()).toBe(
      DEFAULT_LAYER_DECOMPOSITION_API_URL
    );
    expect(resolveLayerDecompositionApiUrl('/custom/api/')).toBe('/custom/api');
    expect(resolveLayerDecompositionApiUrl('https://api.example.com/')).toBe(
      'https://api.example.com'
    );
    expect(() =>
      resolveLayerDecompositionApiUrl('ftp://api.example.com')
    ).toThrow('HTTP(S)');
    expect(() =>
      resolveLayerDecompositionApiUrl('//evil.example.com/api')
    ).toThrow('同源绝对路径');
  });

  it('only classifies public HTTP(S) image sources as JSON-safe', () => {
    expect(isPublicHttpImageSource('https://cdn.example.com/a.png')).toBe(true);
    expect(isPublicHttpImageSource('http://localhost:3000/a.png')).toBe(false);
    expect(isPublicHttpImageSource('http://192.168.1.2/a.png')).toBe(false);
    expect(isPublicHttpImageSource('http://[::1]/a.png')).toBe(false);
    expect(isPublicHttpImageSource('http://[ff02::1]/a.png')).toBe(false);
    expect(isPublicHttpImageSource('data:image/png;base64,cG5n')).toBe(false);
  });

  it('submits public images as JSON without putting base64 in persistent data', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push({ input, init });
      return jsonResponse({
        task_id: 'task-public',
        status: 'queued',
        progress: 0,
      });
    });
    const client = createLayerDecompositionApiClient({
      baseUrl: '/api/layer-decompositions',
      fetcher,
    });

    const job = await client.submit({
      image: 'https://cdn.example.com/source.png',
      prompt: '自动拆分',
      mode: 'prompt',
      maxLayers: 8,
    });

    expect(job).toMatchObject({ taskId: 'task-public', status: 'queued' });
    expect(requests).toHaveLength(1);
    expect(requests[0].init?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      image: 'https://cdn.example.com/source.png',
      prompt: '自动拆分',
      mode: 'prompt',
      max_layers: 8,
    });
  });

  it('converts data URLs to a multipart Blob only for the request', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push({ input, init });
      if (String(input).startsWith('data:')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return jsonResponse({
        task_id: 'task-local',
        status: 'queued',
        progress: 0,
      });
    });
    const client = createLayerDecompositionApiClient({ fetcher });

    await client.submit({ image: 'data:image/png;base64,cG5n', maxLayers: 16 });

    expect(requests).toHaveLength(2);
    const multipartRequest = requests[1];
    expect(multipartRequest.init?.body).toBeInstanceOf(FormData);
    const form = multipartRequest.init?.body as FormData;
    const image = form.get('image');
    expect(image).toBeInstanceOf(File);
    expect((image as File).type).toBe('image/png');
    expect((image as File).size).toBe(3);
    expect(form.get('max_layers')).toBe('16');
  });

  it('accepts a cached PNG when the local proxy omits the image MIME type', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push({ input, init });
      if (String(input).includes('/__aitu_cache__/image/')) {
        return new Response(pngHeader, {
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }
      return jsonResponse({
        task_id: 'task-cached-png',
        status: 'queued',
        progress: 0,
      });
    });
    const client = createLayerDecompositionApiClient({ fetcher });

    await client.submit({
      image: '/__aitu_cache__/image/rabbit.png',
      maxLayers: 8,
    });

    const form = requests[1].init?.body as FormData;
    const image = form.get('image');
    expect(image).toBeInstanceOf(File);
    expect((image as File).type).toBe('image/png');
    expect((image as File).name).toBe('source.png');
  });

  it('preserves common non-PNG image formats for multipart submission', async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push({ input, init });
      if (String(input).endsWith('/source.webp')) {
        return new Response(
          new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
            0x50,
          ]),
          { headers: { 'Content-Type': 'application/octet-stream' } }
        );
      }
      return jsonResponse({
        task_id: 'task-webp',
        status: 'queued',
        progress: 0,
      });
    });
    const client = createLayerDecompositionApiClient({ fetcher });

    await client.submit({ image: '/source.webp', maxLayers: 8 });

    const form = requests[1].init?.body as FormData;
    const image = form.get('image');
    expect(image).toBeInstanceOf(File);
    expect((image as File).type).toBe('image/webp');
    expect((image as File).name).toBe('source.webp');
  });

  it('accepts a directly completed response and strictly parses its layers', async () => {
    const client = createLayerDecompositionApiClient({
      fetcher: vi.fn(async () =>
        jsonResponse({
          data: { group_id: 'group-1', data: [layer(0), layer(1)] },
        })
      ),
    });

    const result = await client.decompose({
      image: 'https://cdn.example.com/source.png',
      maxLayers: 2,
    });

    expect(result.groupId).toBe('group-1');
    expect(result.layers[0].zIndex).toBe(1);
  });

  it('preserves backend decisions so synthetic fallbacks can be rejected', () => {
    const job = parseLayerDecompositionJobResponse({
      task_id: 'task-decisions',
      status: 'completed',
      progress: 1,
      result: {
        group_id: 'group-decisions',
        data: [layer(0), layer(1)],
        decisions: ['omitted 2 lower-priority candidates'],
      },
    });

    expect(job.result?.decisions).toEqual([
      'omitted 2 lower-priority candidates',
    ]);
  });

  it('accepts background/layers responses and operation_id jobs', () => {
    expect(
      parseLayerDecompositionJobResponse({
        request_id: 'group-direct',
        background: layer(0),
        layers: [layer(1)],
        width: 100,
        height: 50,
        quality: { ssim: 0.999 },
      })
    ).toMatchObject({
      status: 'completed',
      result: { groupId: 'group-direct', width: 100, height: 50 },
    });
    expect(
      parseLayerDecompositionJobResponse({
        operation_id: 'operation-1',
        status: 'pending',
      })
    ).toMatchObject({ taskId: 'operation-1', status: 'pending' });
  });

  it('keeps the job envelope when a completed status carries its result in data', () => {
    const job = parseLayerDecompositionJobResponse({
      task_id: 'task-data-result',
      status: 'completed',
      phase: 'validating',
      progress: 1,
      data: { group_id: 'group-data-result', data: [layer(0), layer(1)] },
    });

    expect(job).toMatchObject({
      taskId: 'task-data-result',
      status: 'completed',
      phase: 'validating',
      progress: 100,
      result: { groupId: 'group-data-result' },
    });
  });

  it('unwraps a status-only data envelope using the polled task id', () => {
    expect(
      parseLayerDecompositionJobResponse(
        { success: true, data: { status: 'running', progress: 0.1 } },
        'task-envelope'
      )
    ).toMatchObject({
      taskId: 'task-envelope',
      status: 'running',
      progress: 10,
    });
  });

  it('rejects progress outside the service 0..1 ratio contract', () => {
    expect(() =>
      parseLayerDecompositionJobResponse({
        task_id: 'task-invalid-progress',
        status: 'running',
        progress: 35,
      })
    ).toThrow('progress');
  });

  it('polls queued jobs with progress callbacks and returns the strict result', async () => {
    const progress: number[] = [];
    let statusCalls = 0;
    const fetcher: typeof fetch = vi.fn(async (input) => {
      if (String(input).endsWith('/task-poll')) {
        statusCalls += 1;
        return statusCalls === 1
          ? jsonResponse({
              task_id: 'task-poll',
              status: 'in_progress',
              progress: 0.35,
              phase: 'extracting',
              data: null,
              error: null,
            })
          : jsonResponse(completedPayload('task-poll'));
      }
      return jsonResponse({
        task_id: 'task-poll',
        status: 'queued',
        progress: 0,
      });
    });
    const client = createLayerDecompositionApiClient({ fetcher });

    const result = await client.poll('task-poll', {
      intervalMs: 0,
      maxIntervalMs: 0,
      timeoutMs: 1000,
      onProgress: (item) => progress.push(item.progress),
    });

    expect(result.groupId).toBe('group-1');
    expect(statusCalls).toBe(2);
    expect(progress).toEqual([35, 100]);
  });

  it('aborts an in-flight poll with an AbortError', async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = vi.fn(async () => {
      controller.abort();
      return jsonResponse({
        task_id: 'task-abort',
        status: 'in_progress',
        progress: 1,
      });
    });
    const client = createLayerDecompositionApiClient({ fetcher });

    await expect(
      client.poll('task-abort', {
        signal: controller.signal,
        intervalMs: 0,
        maxIntervalMs: 0,
        timeoutMs: 1000,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('submits corrections and polls the returned task', async () => {
    const paths: string[] = [];
    let correctionCalls = 0;
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      paths.push(String(input));
      if (String(input).endsWith('/task-correct/correct')) {
        correctionCalls += 1;
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          prompt: '补回帽子',
          action: 'replace',
          layer_z_index: 1,
          bbox: [100, 100, 500, 500],
        });
        return jsonResponse({
          task_id: 'task-correct',
          status: 'queued',
          progress: 0,
        });
      }
      return jsonResponse(completedPayload('task-correct'));
    });
    const client = createLayerDecompositionApiClient({ fetcher });

    const result = await client.correct(
      'task-correct',
      {
        prompt: '补回帽子',
        action: 'replace',
        layerZIndex: 1,
        boundingBox: [100, 100, 500, 500],
      },
      { intervalMs: 0, maxIntervalMs: 0 }
    );

    expect(result.groupId).toBe('group-1');
    expect(correctionCalls).toBe(1);
    expect(paths).toEqual([
      '/api/layer-decompositions/task-correct/correct',
      '/api/layer-decompositions/task-correct',
    ]);
  });

  it.each([200, 202, 204])(
    'cancels through POST /:taskId/cancel (%s)',
    async (status) => {
      let method = '';
      let path = '';
      const client = createLayerDecompositionApiClient({
        fetcher: vi.fn(async (input, init) => {
          method = init?.method || '';
          path = String(input);
          return new Response(null, { status });
        }),
      });

      await client.cancel('task-cancel');

      expect(method).toBe('POST');
      expect(path).toBe('/api/layer-decompositions/task-cancel/cancel');
    }
  );

  it('surfaces nested service error messages', async () => {
    const client = createLayerDecompositionApiClient({
      fetcher: vi.fn(async () =>
        jsonResponse(
          { error: { code: 'backend_unavailable', message: '模型服务未配置' } },
          503
        )
      ),
    });

    await expect(
      client.submit({
        image: 'https://cdn.example.com/source.png',
        maxLayers: 2,
      })
    ).rejects.toThrow('模型服务未配置');
  });

  it('normalizes task responses and rejects completed jobs without strict results', () => {
    expect(
      parseLayerDecompositionJobResponse(completedPayload())
    ).toMatchObject({
      taskId: 'task-1',
      status: 'completed',
      progress: 100,
    });
    expect(() =>
      parseLayerDecompositionJobResponse({
        task_id: 'task-2',
        status: 'completed',
      })
    ).toThrow('missing result');
    expect(
      parseLayerDecompositionJobResponse({
        task_id: 'task-3',
        status: 'correcting',
        progress: 0.6,
        phase: 'custom_provider_phase',
      })
    ).toMatchObject({
      status: 'correcting',
      phase: 'custom_provider_phase',
    });
  });

  it('surfaces correcting jobs so the UI can submit a manual correction', async () => {
    const client = createLayerDecompositionApiClient({
      fetcher: vi.fn(async () =>
        jsonResponse({
          task_id: 'task-needs-correction',
          status: 'correcting',
          phase: 'needs_correction',
          progress: 0.6,
        })
      ),
    });

    await expect(
      client.poll('task-needs-correction', {
        intervalMs: 0,
        maxIntervalMs: 0,
        timeoutMs: 1000,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'LayerDecompositionCorrectionRequiredError',
        taskId: 'task-needs-correction',
      } satisfies Partial<LayerDecompositionCorrectionRequiredError>)
    );
  });

  it('does not treat a requeued correction as a terminal correcting state', async () => {
    let calls = 0;
    const client = createLayerDecompositionApiClient({
      fetcher: vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({
              task_id: 'task-requeued',
              status: 'correcting',
              phase: 'requeued',
              progress: 0,
            })
          : jsonResponse(completedPayload('task-requeued'));
      }),
    });

    await expect(
      client.poll('task-requeued', {
        intervalMs: 0,
        maxIntervalMs: 0,
        timeoutMs: 1_000,
      })
    ).resolves.toMatchObject({ groupId: 'group-1' });
  });

  it('rejects non-finite polling configuration values', async () => {
    const client = createLayerDecompositionApiClient({
      fetcher: vi.fn(),
    });
    await expect(
      client.poll('task-invalid-config', { intervalMs: Number.NaN })
    ).rejects.toThrow('轮询配置无效');
  });
});
