import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerTransport } from './provider-routing/provider-transport';
import type { ResolvedProviderContext } from './provider-routing/types';
import { unifiedCacheService } from './unified-cache-service';
import {
  buildMiniMaxH3ContextIRRequest,
  buildMiniMaxH3RegenerationRequest,
  enhanceMiniMaxH3Prompt,
  MINIMAX_H3_MAX_LOCAL_VIDEO_BYTES,
  prepareMiniMaxH3Submission,
  resolveMiniMaxH3InitialSubmitPath,
} from './minimax-h3-video-workflow';

const provider: ResolvedProviderContext = {
  profileId: 'tuzi-managed-default',
  profileName: 'default 分组',
  providerType: 'openai-compatible',
  baseUrl: 'https://video.example.com/v1',
  apiKey: 'test-key',
  authType: 'bearer',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MiniMax-H3 video workflow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFileReader(): void {
    vi.stubGlobal(
      'FileReader',
      class {
        result: string | null = null;
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;

        readAsDataURL(blob: Blob): void {
          this.result = `data:${blob.type};base64,dmlkZW8=`;
          queueMicrotask(() => this.onloadend?.());
        }
      }
    );
  }

  it('does not call Context IR when prompt enhancement is disabled', async () => {
    const send = vi.spyOn(providerTransport, 'send');
    const submission = await prepareMiniMaxH3Submission(
      {
        prompt: '原始提示词',
        duration: '5',
        size: '768P',
        ratio: '16:9',
        params: { prompt_enhancement: 'false' },
      },
      { provider }
    );
    expect(send).not.toHaveBeenCalled();
    expect(submission).toMatchObject({
      path: '/v2/video_generation',
      prompt: '原始提示词',
      body: {
        model: 'MiniMax-H3',
        content: [{ type: 'text', text: '原始提示词' }],
        duration: 5,
        resolution: '768P',
        ratio: '16:9',
      },
    });
  });

  it('materializes a local cached video for ordinary generation', async () => {
    stubFileReader();
    const getCachedBlob = vi
      .spyOn(unifiedCacheService, 'getCachedBlob')
      .mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));

    const submission = await prepareMiniMaxH3Submission(
      {
        prompt: '参考本地视频',
        referenceVideos: ['/asset-library/content-local.mp4'],
      },
      { provider }
    );

    expect(getCachedBlob).toHaveBeenCalledWith(
      '/asset-library/content-local.mp4',
      { allowNetwork: false }
    );
    expect(submission.body).toMatchObject({
      content: [
        { type: 'text', text: '参考本地视频' },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: { url: 'data:video/mp4;base64,dmlkZW8=' },
        },
      ],
    });
  });

  it('preserves a public video URL without reading the local cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const getCachedBlob = vi.spyOn(unifiedCacheService, 'getCachedBlob');
    const submission = await prepareMiniMaxH3Submission(
      {
        prompt: '参考公网视频',
        referenceVideos: [' https://cdn.example.com/reference.mp4 '],
      },
      { provider }
    );

    expect(getCachedBlob).not.toHaveBeenCalled();
    expect(submission.body).toMatchObject({
      content: [
        { type: 'text', text: '参考公网视频' },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: { url: 'https://cdn.example.com/reference.mp4' },
        },
      ],
    });
  });

  it('normalizes a readable canvas video URL to an inline MP4 reference', async () => {
    stubFileReader();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      )
    );

    const submission = await prepareMiniMaxH3Submission(
      {
        prompt: '重新生成画布视频',
        size: '2K',
        referenceVideos: ['https://cdn.example.com/canvas-output.mp4'],
      },
      { provider }
    );

    expect(submission.body).toMatchObject({
      content: [
        { type: 'text', text: '重新生成画布视频' },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: { url: 'data:video/mp4;base64,dmlkZW8=' },
        },
      ],
      resolution: '2K',
      ratio: 'adaptive',
    });
  });

  it('uses the provider credential for a result URL on the provider origin', async () => {
    stubFileReader();
    const send = vi.spyOn(providerTransport, 'send').mockResolvedValue(
      new Response('video', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      })
    );

    await prepareMiniMaxH3Submission(
      {
        prompt: '重新生成刚完成的视频',
        referenceVideos: ['https://video.example.com/result/task-1.mp4'],
      },
      { provider }
    );

    expect(send).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        path: 'https://video.example.com/result/task-1.mp4',
        method: 'GET',
      })
    );
  });

  it('materializes a local cached video before Context IR submission', async () => {
    stubFileReader();
    vi.spyOn(unifiedCacheService, 'getCachedBlob').mockResolvedValue(
      new Blob(['video'], { type: 'video/quicktime' })
    );
    const send = vi
      .spyOn(providerTransport, 'send')
      .mockResolvedValueOnce(jsonResponse({ task_id: 'ir-local-video' }))
      .mockResolvedValueOnce(
        jsonResponse({
          task: {
            id: 'ir-local-video',
            status: 'succeeded',
            content: { prompt: '增强后的提示词' },
          },
        })
      );

    await enhanceMiniMaxH3Prompt(
      {
        prompt: '分析本地视频',
        referenceVideos: ['/asset-library/content-local.mov'],
      },
      { provider, pollInterval: 0, maxPollAttempts: 1 }
    );

    expect(JSON.parse(String(send.mock.calls[0][1].body))).toMatchObject({
      content: [
        { type: 'text', text: '分析本地视频' },
        {
          type: 'video_url',
          role: 'reference_video',
          video_url: { url: 'data:video/quicktime;base64,dmlkZW8=' },
        },
      ],
    });
  });

  it('rejects a missing local video before provider traffic', async () => {
    vi.spyOn(unifiedCacheService, 'getCachedBlob').mockResolvedValue(null);
    const send = vi.spyOn(providerTransport, 'send');

    await expect(
      prepareMiniMaxH3Submission(
        {
          prompt: '参考本地视频',
          referenceVideos: ['/asset-library/missing.mp4'],
        },
        { provider }
      )
    ).rejects.toThrow('本地参考视频缓存已失效');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a cached video whose MIME type is not MP4 or MOV', async () => {
    vi.spyOn(unifiedCacheService, 'getCachedBlob').mockResolvedValue(
      new Blob(['not-video'], { type: 'video/webm' })
    );
    const send = vi.spyOn(providerTransport, 'send');

    await expect(
      prepareMiniMaxH3Submission(
        {
          prompt: '参考不支持格式',
          referenceVideos: ['/asset-library/reference.webm'],
        },
        { provider }
      )
    ).rejects.toThrow('本地参考视频仅支持 MP4 或 MOV 格式');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a local video that cannot fit after Base64 expansion', async () => {
    vi.spyOn(unifiedCacheService, 'getCachedBlob').mockResolvedValue({
      size: MINIMAX_H3_MAX_LOCAL_VIDEO_BYTES + 1,
      type: 'video/mp4',
    } as Blob);
    const send = vi.spyOn(providerTransport, 'send');

    await expect(
      prepareMiniMaxH3Submission(
        {
          prompt: '参考超大本地视频',
          referenceVideos: ['/asset-library/oversized.mp4'],
        },
        { provider }
      )
    ).rejects.toThrow(
      'MiniMax-H3 本地参考视频总大小不能超过 47MB；更大视频请使用公网 URL'
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects multiple local videos whose combined inline size exceeds 47MB', async () => {
    const getCachedBlob = vi
      .spyOn(unifiedCacheService, 'getCachedBlob')
      .mockResolvedValue({
        size: 24 * 1024 * 1024,
        type: 'video/mp4',
      } as Blob);

    await expect(
      prepareMiniMaxH3Submission(
        {
          prompt: '参考多个本地视频',
          referenceVideos: [
            '/asset-library/reference-1.mp4',
            '/asset-library/reference-2.mp4',
          ],
        },
        { provider }
      )
    ).rejects.toThrow('本地参考视频总大小不能超过 47MB');
    expect(getCachedBlob).toHaveBeenCalledTimes(2);
  });

  it('rejects an encoded request body over the 64MB provider limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    vi.stubGlobal(
      'TextEncoder',
      class {
        encode(): Uint8Array {
          return { byteLength: 64 * 1024 * 1024 + 1 } as Uint8Array;
        }
      }
    );

    await expect(
      prepareMiniMaxH3Submission(
        {
          prompt: '参考公网视频',
          referenceVideos: ['https://cdn.example.com/reference.mp4'],
        },
        { provider }
      )
    ).rejects.toThrow(
      'MiniMax-H3 请求体不能超过 64MB，请减少本地参考视频数量或改用公网 URL'
    );
  });

  it('submits V2 Context IR, polls it, and uses the enhanced prompt', async () => {
    const send = vi
      .spyOn(providerTransport, 'send')
      .mockResolvedValueOnce(jsonResponse({ task_id: 'ir-task-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          task: {
            id: 'ir-task-1',
            model: 'MiniMax-H3',
            status: 'succeeded',
            task_type: 'h3_context_ir',
            content: { prompt: '增强后的结构化提示词' },
          },
        })
      );
    const input = {
      prompt: '原始提示词',
      duration: '8',
      size: '2K',
      ratio: '9:16',
      params: { prompt_enhancement: true },
    };
    const submission = await prepareMiniMaxH3Submission(input, {
      provider,
      pollInterval: 0,
      maxPollAttempts: 2,
    });
    expect(buildMiniMaxH3ContextIRRequest(input)).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '原始提示词' }],
      duration: 8,
      ratio: '9:16',
    });
    expect(send).toHaveBeenNthCalledWith(
      1,
      provider,
      expect.objectContaining({
        path: '/v2/h3_context_ir',
        method: 'POST',
        baseUrlStrategy: 'trim-v1',
      })
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      provider,
      expect.objectContaining({
        path: '/v2/query/video_generation/ir-task-1',
        method: 'GET',
      })
    );
    expect(submission).toMatchObject({
      path: '/v2/video_generation',
      prompt: '增强后的结构化提示词',
      body: {
        content: [{ type: 'text', text: '增强后的结构化提示词' }],
        resolution: '2K',
      },
    });
  });

  it.each([
    ['zh', '请用中文输出'],
    ['en', 'Please output the final enhanced video prompt in English.'],
  ] as const)(
    'requests %s output without using an unsupported field',
    (promptLanguage, instruction) => {
      expect(
        buildMiniMaxH3ContextIRRequest({
          prompt: 'A cinematic scene',
          duration: 5,
          ratio: '16:9',
          promptLanguage,
        })
      ).toEqual({
        model: 'MiniMax-H3',
        content: [
          {
            type: 'text',
            text: `A cinematic scene\n\n${instruction}`,
          },
        ],
        duration: 5,
        ratio: '16:9',
      });
    }
  );

  it('surfaces HTTP, business, failed-task, empty-result and timeout errors', async () => {
    const send = vi.spyOn(providerTransport, 'send');
    send.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'upstream unavailable' } }, 500)
    );
    await expect(
      enhanceMiniMaxH3Prompt(
        { prompt: '测试' },
        { provider, pollInterval: 0, maxPollAttempts: 1 }
      )
    ).rejects.toThrow('upstream unavailable');

    send.mockResolvedValueOnce(
      jsonResponse({
        base_resp: { status_code: 2013, status_msg: 'invalid params' },
      })
    );
    await expect(
      enhanceMiniMaxH3Prompt({ prompt: '测试' }, { provider })
    ).rejects.toThrow('invalid params');

    send
      .mockResolvedValueOnce(jsonResponse({ task_id: 'failed-task' }))
      .mockResolvedValueOnce(
        jsonResponse({
          task: {
            id: 'failed-task',
            status: 'failed',
            error: { message: '提示词包含敏感内容' },
          },
        })
      );
    await expect(
      enhanceMiniMaxH3Prompt(
        { prompt: '测试' },
        { provider, pollInterval: 0, maxPollAttempts: 1 }
      )
    ).rejects.toThrow('提示词包含敏感内容');

    send
      .mockResolvedValueOnce(jsonResponse({ task_id: 'empty-task' }))
      .mockResolvedValueOnce(
        jsonResponse({ task: { id: 'empty-task', status: 'succeeded' } })
      );
    await expect(
      enhanceMiniMaxH3Prompt(
        { prompt: '测试' },
        { provider, pollInterval: 0, maxPollAttempts: 1 }
      )
    ).rejects.toThrow('未返回增强后的提示词');

    send
      .mockResolvedValueOnce(jsonResponse({ task_id: 'running-task' }))
      .mockResolvedValueOnce(
        jsonResponse({ task: { id: 'running-task', status: 'running' } })
      );
    await expect(
      enhanceMiniMaxH3Prompt(
        { prompt: '测试' },
        { provider, pollInterval: 0, maxPollAttempts: 1 }
      )
    ).rejects.toThrow('提示词增强超时');
  });

  it('cancels before submitting and never polls after cancellation', async () => {
    const send = vi.spyOn(providerTransport, 'send');
    const controller = new AbortController();
    controller.abort();
    await expect(
      enhanceMiniMaxH3Prompt(
        { prompt: '测试' },
        { provider, signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(send).not.toHaveBeenCalled();
  });

  it('builds only the official source-task regeneration fields', async () => {
    const params = {
      minimax_h3_task_type: 'regeneration',
      source_task_id: ' source-task-1 ',
      source_resolution: '768p',
      prompt_enhancement: true,
    };
    expect(buildMiniMaxH3RegenerationRequest(params)).toEqual({
      model: 'MiniMax-H3',
      source_task_id: 'source-task-1',
      resolution: '2K',
    });
    const submission = await prepareMiniMaxH3Submission(
      { prompt: '源视频提示词', size: '2K', params },
      { provider }
    );
    expect(submission).toMatchObject({
      path: '/v2/video_regeneration',
      taskType: 'regeneration',
    });
    expect(resolveMiniMaxH3InitialSubmitPath(params)).toBe(
      '/v2/video_regeneration'
    );
  });

  it('rejects regeneration without a valid 768P source task', () => {
    expect(() =>
      buildMiniMaxH3RegenerationRequest({ source_resolution: '768P' })
    ).toThrow('缺少有效的 MiniMax-H3 源任务 ID');
    expect(() =>
      buildMiniMaxH3RegenerationRequest({
        source_task_id: 'task-2k',
        source_resolution: '2K',
      })
    ).toThrow('源视频已经是 2K');
    expect(() =>
      buildMiniMaxH3RegenerationRequest({
        source_task_id: 'task-unknown',
        source_resolution: '720P',
      })
    ).toThrow('仅支持将 768P');
  });
  it('identifies Context IR query errors without retrying or hiding provider detail', async () => {
    const send = vi.spyOn(providerTransport, 'send')
      .mockResolvedValueOnce(jsonResponse({ task_id: 'ir-existing' }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'unmarshal response body failed' } }, 500));
    await expect(enhanceMiniMaxH3Prompt({ prompt: 'original' }, { provider, pollInterval: 0 }))
      .rejects.toThrow('MiniMax-H3 提示词增强查询失败：unmarshal response body failed');
    expect(send).toHaveBeenCalledTimes(2);
  });

});
