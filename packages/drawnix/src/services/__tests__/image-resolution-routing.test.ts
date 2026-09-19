import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FallbackMediaExecutor } from '../media-executor/fallback-executor';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  plan: vi.fn(),
  adapter: vi.fn(),
  cache: vi.fn(),
}));
vi.mock('../../utils/settings-manager', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../utils/settings-manager')>(),
  resolveInvocationRoute: () => ({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test',
    modelId: 'gemini-3-pro-image-preview',
  }),
}));
vi.mock('../provider-routing', async () => ({
  ...await import('../provider-routing/provider-transport'),
  providerTransport: { send: mocks.send },
  resolveInvocationPlanFromRoute: mocks.plan,
}));
vi.mock('../model-adapters', () => ({
  resolveAdapterForInvocation: mocks.adapter,
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS: [],
}));
vi.mock('../media-executor/fallback-adapter-routes', () => ({
  executeImageViaAdapter: vi.fn(),
  executeVideoViaAdapter: vi.fn(),
}));
vi.mock('../media-executor/task-storage-writer', () => ({
  taskStorageWriter: {
    updateStatus: vi.fn(),
    updateImageRecovery: vi.fn(),
    completeTask: mocks.complete,
    failTask: mocks.fail,
  },
}));
vi.mock('../task-storage-reader', () => ({ taskStorageReader: {} }));
vi.mock('../task-invocation-route', () => ({
  createTaskInvocationRouteSnapshot: vi.fn(),
}));
vi.mock('../media-executor/llm-api-logger', () => ({
  startLLMApiLog: () => 'audit',
  completeLLMApiLog: vi.fn(),
  failLLMApiLog: vi.fn(),
}));
vi.mock('../../utils/api-auth-error-event', () => ({
  classifyApiCredentialError: () => null,
  dispatchApiAuthError: vi.fn(),
}));
vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: { getImageForAI: mocks.cache },
}));
vi.mock('../../utils/gemini-api/apiCalls', () => ({}));
vi.mock('../agent/tool-parser', () => ({}));
vi.mock('../media-api', () => ({}));
vi.mock('../media-executor/fallback-utils', async (importOriginal) => {
  const api = await import('../media-api/image-api');
  return {
    ...await importOriginal<typeof import('../media-executor/fallback-utils')>(),
    buildImageRequestBody: api.buildImageRequestBody,
    parseImageResponse: api.parseImageResponse,
    ensureBase64ForAI: async (image: { value: string }) => image.value,
    cacheRemoteUrls: async (urls: string[]) => urls,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plan.mockReturnValue(null);
  mocks.adapter.mockReturnValue({ id: 'gemini-image-adapter', kind: 'image' });
  mocks.send.mockImplementation(async () => new Response(JSON.stringify({
      data: [
        {
          url: 'https://example.invalid/output.png',
          width: 2480,
          height: 3312,
        },
      ],
    }), { headers: { 'Content-Type': 'application/json' } }));
  mocks.cache.mockResolvedValue({ value: 'data:image/png;base64,eA==' });
});

describe('queued image resolution routing', () => {
  it('sends a top-level 4K selection through the basic branch without forcing a square', async () => {
    await new FallbackMediaExecutor().generateImage({
      taskId: 'task',
      prompt: 'test',
      size: 'auto',
      resolution: '4k',
      params: { resolution: '1k' },
    });
    const body = JSON.parse(mocks.send.mock.calls[0][1].body);
    expect(body.quality).toBe('4k');
    expect(body.size).toBeUndefined();
    expect(mocks.complete).toHaveBeenCalledWith(
      'task',
      expect.objectContaining({ width: 2480, height: 3312 }),
      'task',
      expect.objectContaining({ shouldUpdate: expect.any(Function) })
    );
  });

  it('combines uploaded reference metadata with the nested tier before materializing URLs', async () => {
    await new FallbackMediaExecutor().generateImage({
      taskId: 'task',
      prompt: 'test',
      size: 'auto',
      uploadedImages: [{ url: 'reference', width: 1086, height: 1448 }],
      params: { resolution: '4k' },
    });
    const body = JSON.parse(mocks.send.mock.calls[0][1].body);
    expect(body).toMatchObject({
      size: '1152x1536',
      quality: '4k',
      image: ['data:image/png;base64,eA=='],
    });
  });

  it('fails the async task before submission when its tier cannot be transmitted', async () => {
    mocks.plan.mockReturnValue({
      provider: { authType: 'bearer' },
      binding: { protocol: 'openai.async.media' },
    });
    await expect(
      new FallbackMediaExecutor().generateImage({
        taskId: 'task',
        prompt: 'test',
        size: 'auto',
        resolution: '4k',
      })
    ).rejects.toThrow('异步图片渠道');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledWith(
      'task',
      expect.objectContaining({ code: 'ASYNC_IMAGE_GENERATION_ERROR' }),
      'task',
      expect.objectContaining({ shouldUpdate: expect.any(Function) })
    );
  });
});
