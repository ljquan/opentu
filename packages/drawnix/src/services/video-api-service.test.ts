import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendVideoOutputParams,
  buildMiniMaxH3VideoRequest,
  normalizeMiniMaxH3VideoResponse,
  resolveMiniMaxH3ApiVersion,
  resolveMiniMaxH3VideoSubmitPath,
  resolveVideoPollPathForModel,
} from './video-binding-utils';
import { providerTransport } from './provider-routing/provider-transport';
import { unifiedCacheService } from './unified-cache-service';
import { videoAPIService } from './video-api-service';

const serviceMocks = vi.hoisted(() => ({
  resolveInvocationPlanFromRoute: vi.fn(),
  startLLMApiLog: vi.fn(() => 'video-log-1'),
  completeLLMApiLog: vi.fn(),
  failLLMApiLog: vi.fn(),
  updateLLMApiLogMetadata: vi.fn(),
}));

vi.mock('./provider-routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./provider-routing')>();
  return {
    ...actual,
    resolveInvocationPlanFromRoute:
      serviceMocks.resolveInvocationPlanFromRoute,
  };
});

vi.mock('./media-executor/llm-api-logger', () => ({
  startLLMApiLog: serviceMocks.startLLMApiLog,
  completeLLMApiLog: serviceMocks.completeLLMApiLog,
  failLLMApiLog: serviceMocks.failLLMApiLog,
  updateLLMApiLogMetadata: serviceMocks.updateLLMApiLogMetadata,
}));

const testProvider = {
  profileId: 'profile-minimax',
  profileName: 'MiniMax 测试供应商',
  providerType: 'openai-compatible',
  baseUrl: 'https://video.example.com/v1',
  apiKey: 'test-key',
  authType: 'bearer' as const,
};

describe('VideoAPIService MiniMax-H3 submission', () => {
  beforeEach(() => {
    serviceMocks.resolveInvocationPlanFromRoute.mockReturnValue({
      provider: testProvider,
      binding: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('materializes a local video into the final provider request body', async () => {
    vi.stubGlobal(
      'FileReader',
      class {
        result: string | null = null;
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;

        readAsDataURL(blob: Blob): void {
          this.result = `data:${blob.type};base64,c2VydmljZS12aWRlbw==`;
          queueMicrotask(() => this.onloadend?.());
        }
      }
    );
    vi.spyOn(unifiedCacheService, 'getCachedBlob').mockResolvedValue(
      new Blob(['service-video'], { type: 'video/mp4' })
    );
    const send = vi.spyOn(providerTransport, 'send').mockResolvedValue(
      new Response(JSON.stringify({ task_id: 'h3-task-1', status: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await videoAPIService.submitVideoGeneration({
      model: 'MiniMax-H3',
      prompt: '参考本地视频生成',
      params: {
        input_videos: ['/asset-library/local-reference.mp4'],
      },
    });

    expect(result).toMatchObject({
      id: 'h3-task-1',
      model: 'MiniMax-H3',
      status: 'queued',
    });
    expect(send).toHaveBeenCalledWith(
      testProvider,
      expect.objectContaining({
        path: '/v2/video_generation',
        baseUrlStrategy: 'trim-v1',
        method: 'POST',
      })
    );
    expect(JSON.parse(String(send.mock.calls[0][1].body))).toMatchObject({
      model: 'MiniMax-H3',
      content: [
        { type: 'text', text: '参考本地视频生成' },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: {
            url: 'data:video/mp4;base64,c2VydmljZS12aWRlbw==',
          },
        },
      ],
    });
  });
});

describe('appendVideoOutputParams', () => {
  it('将 MiniMax-H3 的分辨率和比例写入 multipart 请求', () => {
    const formData = new FormData();

    appendVideoOutputParams(formData, 'MiniMax-H3', '2k', {
      ratio: '9:16',
    });

    expect(formData.get('resolution')).toBe('2K');
    expect(formData.get('ratio')).toBe('9:16');
    expect(formData.has('size')).toBe(false);
  });

  it('保持其他视频模型的 size 请求字段不变', () => {
    const formData = new FormData();

    appendVideoOutputParams(formData, 'veo3', '1280x720', {
      ratio: '16:9',
    });

    expect(formData.get('size')).toBe('1280x720');
    expect(formData.has('resolution')).toBe(false);
    expect(formData.has('ratio')).toBe(false);
  });

  it('构建 MiniMax-H3 官方请求并为缺失参数提供合法默认值', () => {
    expect(
      buildMiniMaxH3VideoRequest({
        prompt: '测试视频',
        duration: '8',
        size: '1280x720',
        ratio: 'adaptive',
      })
    ).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '测试视频' }],
      duration: 8,
      resolution: '768P',
      ratio: '16:9',
    });
  });

  it('将 MiniMax-H3 单图输入作为首帧', () => {
    expect(
      buildMiniMaxH3VideoRequest({
        prompt: '让画面动起来',
        referenceImages: [
          '  ',
          ' https://cdn.example.com/first.png ',
        ],
        ratio: 'adaptive',
      })
    ).toMatchObject({
      content: [
        { type: 'text', text: '让画面动起来' },
        {
          type: 'image_url',
          role: 'first_frame',
          image_url: { url: 'https://cdn.example.com/first.png' },
        },
      ],
      ratio: 'adaptive',
    });
  });

  it('将 MiniMax-H3 双图输入按官方首帧/尾帧结构写入请求', () => {
    expect(
      buildMiniMaxH3VideoRequest({
        prompt: '从首帧过渡到尾帧',
        referenceImages: [
          'https://cdn.example.com/first.png',
          'https://cdn.example.com/last.png',
        ],
      })
    ).toMatchObject({
      content: [
        { type: 'text', text: '从首帧过渡到尾帧' },
        {
          type: 'image_url',
          role: 'first_frame',
          image_url: { url: 'https://cdn.example.com/first.png' },
        },
        {
          type: 'image_url',
          role: 'last_frame',
          image_url: { url: 'https://cdn.example.com/last.png' },
        },
      ],
    });
  });

  it('将 MiniMax-H3 输入视频按官方 reference_video 结构写入请求', () => {
    expect(
      buildMiniMaxH3VideoRequest({
        prompt: '参考视频生成新视频',
        referenceVideos: [
          ' https://cdn.example.com/ref-1.mp4 ',
          'https://cdn.example.com/ref-2.mov',
        ],
        referenceImages: ['https://cdn.example.com/reference.png'],
      })
    ).toMatchObject({
      content: [
        { type: 'text', text: '参考视频生成新视频' },
        {
          type: 'image_url',
          role: 'reference_image',
          image_url: { url: 'https://cdn.example.com/reference.png' },
        },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: { url: 'https://cdn.example.com/ref-1.mp4' },
        },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: { url: 'https://cdn.example.com/ref-2.mov' },
        },
      ],
      ratio: 'adaptive',
    });
  });

  it('限制首尾帧和全能参考模式的官方图片数量', () => {
    expect(() =>
      buildMiniMaxH3VideoRequest({
        prompt: '超过首尾帧限制',
        referenceImages: ['1', '2', '3'],
      })
    ).toThrow('首帧/尾帧图片最多支持 2 张');

    expect(() =>
      buildMiniMaxH3VideoRequest({
        prompt: '超过全能参考限制',
        referenceImages: Array.from({ length: 10 }, (_, index) => `image-${index}`),
        referenceVideos: ['video-1'],
      })
    ).toThrow('参考图片最多支持 9 张');
  });

  it('保留 MiniMax-H3 参考视频的 2K 与显式比例', () => {
    const request = buildMiniMaxH3VideoRequest({
      prompt: '帮我重新升级成2k，其他不变',
      size: '2k',
      ratio: '9:16',
      duration: '4',
      referenceVideos: ['data:video/mp4;base64,dmlkZW8='],
    });

    expect(request).toMatchObject({
      model: 'MiniMax-H3',
      resolution: '2K',
      duration: 4,
      ratio: '9:16',
      content: [
        { type: 'text', text: '帮我重新升级成2k，其他不变' },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: { url: 'data:video/mp4;base64,dmlkZW8=' },
        },
      ],
    });
  });

  it('转换 MiniMax-H3 官方任务响应和轮询地址', () => {
    // Keep the legacy resolver for stored V1 metadata, but all new H3
    // submissions and polls are fixed to the official V2 routes.
    expect(resolveMiniMaxH3ApiVersion()).toBe('v1');
    expect(resolveMiniMaxH3ApiVersion({ api_version: 'V1' })).toBe('v1');
    expect(resolveMiniMaxH3ApiVersion({ api_version: 'invalid' })).toBe('v1');
    expect(resolveMiniMaxH3ApiVersion({ api_version: 'V2' })).toBe('v2');
    expect(resolveMiniMaxH3VideoSubmitPath()).toBe('/v2/video_generation');
    expect(resolveMiniMaxH3VideoSubmitPath({ api_version: 'v1' })).toBe(
      '/v2/video_generation'
    );
    expect(resolveVideoPollPathForModel('task/1', 'MiniMax-H3')).toBe(
      '/v2/query/video_generation/task%2F1'
    );
    expect(
      resolveVideoPollPathForModel('task/1', 'MiniMax-H3', null, {
        api_version: 'v2',
      })
    ).toBe('/v2/query/video_generation/task%2F1');
    expect(
      resolveVideoPollPathForModel('task/1', 'MiniMax-H3', null, {
        api_version: 'v1',
      })
    ).toBe('/v2/query/video_generation/task%2F1');
    expect(
      normalizeMiniMaxH3VideoResponse({
        task: {
          id: 'task/1',
          model: 'MiniMax-H3',
          status: 'succeeded',
          duration: 5,
          content: { url: 'https://cdn.example.com/video.mp4' },
        },
      })
    ).toMatchObject({
      id: 'task/1',
      status: 'completed',
      seconds: '5',
      video_url: 'https://cdn.example.com/video.mp4',
    });
    expect(
      normalizeMiniMaxH3VideoResponse({
        task: {
          id: 'task-failed',
          status: 'failed',
          error: { code: 'blocked', message: '内容不合规' },
        },
      })
    ).toMatchObject({
      id: 'task-failed',
      status: 'failed',
      error: { code: 'blocked', message: '内容不合规' },
    });
    expect(
      normalizeMiniMaxH3VideoResponse({
        task_id: 'task-cancelled',
        status: 'cancelled',
      })
    ).toMatchObject({ id: 'task-cancelled', status: 'failed' });
    expect(
      normalizeMiniMaxH3VideoResponse({
        task_id: 'task-canceled',
        status: 'canceled',
      })
    ).toMatchObject({ id: 'task-canceled', status: 'failed' });
  });
});
