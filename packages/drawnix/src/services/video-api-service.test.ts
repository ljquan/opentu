import { describe, expect, it } from 'vitest';
import {
  appendVideoOutputParams,
  buildMiniMaxH3VideoRequest,
  normalizeMiniMaxH3VideoResponse,
  resolveMiniMaxH3ApiVersion,
  resolveMiniMaxH3VideoSubmitPath,
  resolveVideoPollPathForModel,
} from './video-binding-utils';

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

  it('将 MiniMax-H3 单图输入作为首帧且只使用第一个有效地址', () => {
    expect(
      buildMiniMaxH3VideoRequest({
        prompt: '让画面动起来',
        referenceImages: [
          '  ',
          ' https://cdn.example.com/first.png ',
          'https://cdn.example.com/ignored.png',
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
