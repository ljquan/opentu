import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task.types';
import {
  buildBatchVideoReferenceImages,
  getNonRetryableBatchVideoFailureReason,
} from './batch-video-generation';

function buildFailedTask(
  message: string,
  code = 'VIDEO_GENERATION_ERROR'
): Pick<Task, 'error'> {
  return {
    error: {
      code,
      message,
    },
  };
}

describe('batch-video-generation retry classification', () => {
  it('treats parameter HTTP failures as non-retryable', () => {
    const reason = getNonRetryableBatchVideoFailureReason(
      buildFailedTask(
        'Video submission failed: 400 - Invalid parameters: duration must be 5 or 10'
      )
    );

    expect(reason).toBe(
      'Video submission failed: 400 - Invalid parameters: duration must be 5 or 10'
    );
  });

  it('treats provider validation messages as non-retryable', () => {
    const reason = getNonRetryableBatchVideoFailureReason(
      buildFailedTask(
        'Kling image2video requires a reference image',
        'INVALID_ARGUMENT'
      )
    );

    expect(reason).toBe('Kling image2video requires a reference image');
  });

  it('treats Chinese parameter errors as non-retryable', () => {
    const reason = getNonRetryableBatchVideoFailureReason(
      buildFailedTask('参数错误：视频时长必须是 3~15 的整数')
    );

    expect(reason).toBe('参数错误：视频时长必须是 3~15 的整数');
  });

  it('treats IP infringement safety failures as non-retryable', () => {
    const reason = getNonRetryableBatchVideoFailureReason(
      buildFailedTask(
        'Input data is suspected of being involved in IP infringement.'
      )
    );

    expect(reason).toBe(
      'Input data is suspected of being involved in IP infringement.'
    );
  });

  it('keeps transient failures retryable', () => {
    const reason = getNonRetryableBatchVideoFailureReason(
      buildFailedTask('Video generation timeout'),
      'Polling timeout'
    );

    expect(reason).toBeNull();
  });

  it('keeps provider reCAPTCHA blocks retryable', () => {
    const reason = getNonRetryableBatchVideoFailureReason(
      buildFailedTask(
        '供应商风控拦截：当前视频模型触发 reCAPTCHA/异常流量校验，请换用 Seedance/Veo 其他模型或稍后重试。',
        'PROVIDER_RECAPTCHA_BLOCKED'
      )
    );

    expect(reason).toBeNull();
  });
});

describe('buildBatchVideoReferenceImages', () => {
  it('describes frame-mode references as first and last frames', () => {
    const result = buildBatchVideoReferenceImages({
      model: 'seedance-1.5-pro',
      firstFrameUrl: 'first-url',
      lastFrameUrl: 'last-url',
      extraReferenceUrls: ['style-url'],
      characterReferenceUrls: ['char-url'],
    });

    expect(result.referenceImages).toEqual(['first-url', 'last-url']);
    expect(result.referenceImageDescriptions).toEqual([
      '首帧图：只表示视频起始画面状态，视频必须从这张图开始，优先于故事上下文。',
      '尾帧图：只表示视频结束画面状态，视频应自然过渡到这张图，优先于故事上下文。',
    ]);
    expect(result.unusedCharacterReferenceUrls).toEqual(['char-url']);
  });

  it('keeps character references separate from global extras outside frame mode', () => {
    const result = buildBatchVideoReferenceImages({
      model: 'kling_video',
      firstFrameUrl: 'first-url',
      extraReferenceUrls: ['style-url'],
      characterReferenceUrls: ['char-url'],
    });

    expect(result.referenceImages?.[0]).toBe('char-url');
    expect(result.referenceImageDescriptions?.[0]).toContain('角色参考图');
    expect(result.referenceImageDescriptions?.[0]).toContain(
      '不表示时间顺序、动作或剧情'
    );
    expect(result.referenceImageDescriptions?.[1]).toContain(
      '优先于故事上下文'
    );
    expect(result.referenceImageDescriptions?.[2]).toContain('全局/补充参考图');
  });
});
