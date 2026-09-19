import { describe, expect, it } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  buildImageTaskAIInputPrefillData,
  buildImageTaskPrefillInitialData,
  getImageTaskReferenceImages,
} from '../image-task-prefill';

function imageTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: {
      prompt: '只修改涂抹区域',
      model: 'gpt-image-2',
      generationMode: 'image_edit',
      referenceImages: ['https://example.com/source.png'],
      maskImage: '/__aitu_cache__/image/mask.png',
    },
    createdAt: 1,
    updatedAt: 2,
    result: {
      url: 'https://example.com/result.png',
      format: 'png',
      size: 1,
    },
    ...overrides,
  };
}

describe('image-task-prefill', () => {
  it('preserves top-level resolution and quality in both regeneration entry points', () => {
    const task = imageTask({ params: { prompt: 'test', model: 'gpt-image-2', size: 'auto',
      resolution: '4k', quality: 'high', params: { resolution: '1k', quality: 'low' } } });
    expect(buildImageTaskAIInputPrefillData(task).params).toEqual({ size: 'auto', resolution: '4k', quality: 'high' });
    expect(buildImageTaskPrefillInitialData(task)).toMatchObject({ initialModel: 'gpt-image-2', initialAspectRatio: 'auto',
      initialParams: { size: 'auto', resolution: '4k', quality: 'high' } });
  });

  it('keeps reference dimensions attached to their URLs when prefilled', () => {
    const task = imageTask({ params: { prompt: 'test', referenceImages: ['first', 'second'],
      params: { referenceImageMetadata: [{ url: 'second', width: 1600, height: 900 }] } } });
    const refs = getImageTaskReferenceImages(task);
    expect(refs[0].width).toBeUndefined();
    expect(refs[1]).toMatchObject({ url: 'second', width: 1600, height: 900 });
  });

  it('maps canonical tiers back to model-specific controls', () => {
    expect(buildImageTaskAIInputPrefillData(imageTask({ params: { prompt: 'test', model: 'doubao-seedream-5-0-260128', resolution: '3k' } })).params)
      .toMatchObject({ resolution: '3k', seedream_quality: '3k' });
    expect(buildImageTaskAIInputPrefillData(imageTask({ params: { prompt: 'test', model: 'gemini-3-pro-image-preview', resolution: '4k' } })).params)
      .toMatchObject({ resolution: '4k', quality: '4k' });
  });

  it.each(['modelRef', 'invocationRoute'] as const)(
    'migrates legacy GPT quality using the effective %s model', (source) => {
      const task = imageTask({
        params: { prompt: 'test', model: 'old-alias', quality: '4k',
          ...(source === 'modelRef' ? { modelRef: { profileId: 'custom', modelId: 'gpt-image-2' } } : {}),
        },
        ...(source === 'invocationRoute' ? { invocationRoute: {
          operation: 'image' as const, providerProfileId: 'custom', modelId: 'gpt-image-2',
        } } : {}),
      });
      expect(buildImageTaskAIInputPrefillData(task)).toMatchObject({
        model: 'gpt-image-2', params: { resolution: '4k' },
      });
      expect(buildImageTaskPrefillInitialData(task).initialParams).toEqual({ resolution: '4k' });
    }
  );

  it('uses the route model instead of stale GPT parameters for model-specific controls', () => {
    const task = imageTask({ params: {
      prompt: 'test', model: 'gpt-image-2', resolution: '3k',
      modelRef: { profileId: 'custom', modelId: 'doubao-seedream-5-0-260128' },
    } });
    expect(buildImageTaskPrefillInitialData(task).initialParams).toMatchObject({ seedream_quality: '3k' });
  });

  it('keeps metadata when raw base64 is normalized during prefill', () => {
    const raw = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
    const task = imageTask({ params: { prompt: 'test', referenceImages: [raw],
      params: { referenceImageMetadata: [{ url: raw, width: 1086, height: 1448 }] },
    } });
    expect(getImageTaskReferenceImages(task)[0]).toMatchObject({
      url: `data:image/png;base64,${raw}`, width: 1086, height: 1448,
    });
  });

  it('does not lose dimensions when deduplicating a later reference', () => {
    const task = imageTask({ params: { prompt: 'test', uploadedImages: [
      { url: 'same', type: 'url' }, { url: 'same', type: 'url', width: 1086, height: 1448 },
    ] } });
    expect(getImageTaskReferenceImages(task)).toEqual([
      { url: 'same', name: '参考图 1', width: 1086, height: 1448 },
    ]);
  });

  it('重新生成带蒙层的图片任务时应该把原 mask 绑定到参考图', () => {
    const prefill = buildImageTaskAIInputPrefillData(imageTask());

    expect(prefill.generationType).toBe('image');
    expect(prefill.prompt).toBe('只修改涂抹区域');
    expect(prefill.model).toBe('gpt-image-2');
    expect(prefill.images).toEqual([
      {
        url: 'https://example.com/source.png',
        name: '参考图 1',
        maskImage: '/__aitu_cache__/image/mask.png',
      },
    ]);
  });

  it('弹窗回填初始数据时也应该保留单参考图 mask', () => {
    const initialData = buildImageTaskPrefillInitialData(imageTask());

    expect(initialData.initialImages).toEqual([
      {
        url: 'https://example.com/source.png',
        name: '参考图 1',
        maskImage: '/__aitu_cache__/image/mask.png',
      },
    ]);
  });

  it('回填时优先保留任务路由里的自定义模型身份', () => {
    const task = imageTask({
      params: {
        prompt: '兔子',
        model: 'image2',
      },
      invocationRoute: {
        operation: 'image',
        providerProfileId: 'provider-custom',
        modelId: 'gemini',
        modelRef: {
          profileId: 'provider-custom',
          modelId: 'gemini',
        },
        binding: {
          id: 'provider-custom:gemini:image:manual:custom-http',
          protocol: 'custom-http',
          requestSchema: 'custom-http',
          responseSchema: 'custom-http.image',
          submitPath: '/render',
        },
      },
    });

    expect(buildImageTaskPrefillInitialData(task)).toMatchObject({
      initialModel: 'gemini',
      initialModelRef: {
        profileId: 'provider-custom',
        modelId: 'gemini',
      },
    });
    expect(buildImageTaskAIInputPrefillData(task)).toMatchObject({
      model: 'gemini',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gemini',
      },
    });
  });

  it('多参考图任务不自动绑定单张 mask，避免错配', () => {
    const task = imageTask({
      params: {
        prompt: '合成',
        referenceImages: [
          'https://example.com/source-a.png',
          'https://example.com/source-b.png',
        ],
        maskImage: '/__aitu_cache__/image/mask.png',
      },
    });

    expect(getImageTaskReferenceImages(task)).toEqual([
      {
        url: 'https://example.com/source-a.png',
        name: '参考图 1',
      },
      {
        url: 'https://example.com/source-b.png',
        name: '参考图 2',
      },
    ]);
  });
});
