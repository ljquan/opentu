import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerTransport } from './provider-routing/provider-transport';
import type { ResolvedProviderContext } from './provider-routing/types';
import {
  buildMiniMaxH3ContextIRRequest,
  buildMiniMaxH3RegenerationRequest,
  enhanceMiniMaxH3Prompt,
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
  afterEach(() => vi.restoreAllMocks());

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
});
