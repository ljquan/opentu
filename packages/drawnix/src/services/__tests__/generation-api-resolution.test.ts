import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generationAPIService } from '../generation-api-service';
import { TaskType } from '../../types/task.types';

const mocks = vi.hoisted(() => ({ cache: vi.fn(), send: vi.fn(), naturalSize: vi.fn() }));
vi.mock('../audio-api-service', () => ({ audioAPIService: {}, extractAudioGenerationResult: vi.fn() }));
vi.mock('../video-api-service', () => ({ videoAPIService: {} }));
vi.mock('../async-image-api-service', () => ({ asyncImageAPIService: {} }));
vi.mock('../../utils/umami-analytics', () => ({ analytics: {
  trackModelCall: vi.fn(), trackModelSuccess: vi.fn(), trackModelFailure: vi.fn(),
} }));
vi.mock('../task-queue', () => ({ legacyTaskQueueService: {
  markImageSubmissionAttempted: vi.fn(), getTask: vi.fn(),
} }));
vi.mock('../unified-cache-service', () => ({ unifiedCacheService: { getImageForAI: mocks.cache } }));
vi.mock('../task-invocation-route', () => ({
  createTaskInvocationRouteSnapshot: vi.fn(), assertTaskInvocationRouteAvailable: vi.fn(),
  shouldUseStrictTaskInvocationRoute: () => false,
}));
vi.mock('../media-executor/fallback-utils', () => ({
  cacheRemoteUrls: async (urls: string[]) => urls, cacheRemoteUrl: vi.fn(),
}));
vi.mock('../model-adapters', async () => {
  const { tuziGPTImageAdapter } = await import('../model-adapters/tuzi-gpt-image-adapter');
  return {
    resolveAdapterForInvocation: () => tuziGPTImageAdapter,
    getAdapterContextFromSettings: () => ({ baseUrl: 'https://example.invalid/v1' }),
    GPT_IMAGE_EDIT_REQUEST_SCHEMAS: [],
  };
});
vi.mock('../model-adapters/context', () => ({ sendAdapterRequest: mocks.send }));
vi.mock('../../utils/image-natural-size', () => ({ getImageNaturalSize: mocks.naturalSize }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.mockResolvedValue({ value: 'data:image/png;base64,eA==' });
  mocks.naturalSize.mockResolvedValue({ width: 0, height: 0 });
  mocks.send.mockImplementation(async () => new Response(JSON.stringify({
    data: [{ url: 'https://example.invalid/output.png', width: 2480, height: 3312 }],
  }), { headers: { 'Content-Type': 'application/json' } }));
});

describe('direct generation reference metadata', () => {
  it.each(['auto', undefined])('rejects %s + 4K before submitting without a reference', async (size) => {
    await expect(generationAPIService.generate('test', {
      prompt: 'test', model: 'gpt-image-2', size, resolution: '4k',
    }, TaskType.IMAGE)).rejects.toThrow('必须明确图片比例或提供参考图');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('still submits a selected 4K tier when an explicit ratio is available', async () => {
    await generationAPIService.generate('test', {
      prompt: 'test', model: 'gpt-image-2', size: '16x9', resolution: '4k', quality: 'high',
    }, TaskType.IMAGE);
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toMatchObject({
      size: '3840x2160', quality: 'high',
    });
    expect(mocks.naturalSize).not.toHaveBeenCalled();
  });

  it('sends 4K using existing dimensions after URL conversion and deduplication', async () => {
    const result = await generationAPIService.generate('test', {
      prompt: 'test', model: 'gpt-image-2', size: 'auto', resolution: '4k', quality: 'high',
      uploadedImages: [{ type: 'url', url: 'original', width: 1086, height: 1448 }],
      referenceImages: ['original', 'second'],
      params: { resolution: '1k', referenceImageMetadata: [{ url: 'second', width: 1600, height: 900 }] },
    }, TaskType.IMAGE);
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toEqual({
      model: 'gpt-image-2', prompt: 'test', size: '2480x3312', quality: 'high',
      image: ['data:image/png;base64,eA==', 'second'],
    });
    expect(result).toMatchObject({ width: 2480, height: 3312 });
    expect(mocks.naturalSize).not.toHaveBeenCalled();
    expect(mocks.cache).toHaveBeenCalledTimes(1);
  });

  it('fails without submission when the first legacy reference cannot be measured', async () => {
    await expect(generationAPIService.generate('test', {
      prompt: 'test', model: 'gpt-image-2', size: 'auto', resolution: '4k',
      uploadedImages: [{ type: 'url', url: 'original' }],
      referenceImages: ['second'],
      params: { referenceImageMetadata: [{ url: 'second', width: 1600, height: 900 }] },
    }, TaskType.IMAGE)).rejects.toThrow('第一张参考图');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
