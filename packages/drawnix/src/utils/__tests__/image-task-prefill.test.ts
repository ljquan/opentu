import { describe, expect, it } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { SEEDREAM_55_MODEL_ID } from '../../constants/model-config';
import {
  buildImageTaskAIInputPrefillData,
  buildImageTaskPrefillInitialData,
  getImageTaskReferenceImages,
  buildSeedream55ContinuePrefillData,
  buildImageRerollPrefillData,
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
  it.each(['1k', '1.5k', '2k', '1K', '1.5K', '2K'])(
    'restores Seedream tier %s from top-level or nested history for every prefill action', (size) => {
      for (const savedSize of [{ size }, { params: { size } }]) {
        const task = imageTask({ params: {
          prompt: 'blue cup', model: SEEDREAM_55_MODEL_ID, ...savedSize,
        } });
        const restored = buildImageTaskAIInputPrefillData(task);
        const continued = buildSeedream55ContinuePrefillData(task, { id: 'result', url: '/result.png' });
        const rerolled = buildImageRerollPrefillData(restored);
        for (const input of [restored, continued, rerolled]) {
          expect(input.params?.size).toBe(size.toUpperCase());
        }
      }
    }
  );

  it.each([
    [SEEDREAM_55_MODEL_ID, '1536X1024', '1536x1024'],
    ['gpt-image-2', '3:4', '3x4'],
    ['gemini-3-pro-image-preview', '1.5K', '1.5k'],
  ])('keeps size normalization for %s / %s as %s', (model, size, expected) => {
    const task = imageTask({ params: { prompt: 'test', model, size } });
    expect(buildImageTaskAIInputPrefillData(task).params?.size).toBe(expected);
  });

  it('continues with the selected result, keeps provider/params, removes stale masks and leaves history unchanged', () => {
    const task = imageTask({ params: {
      prompt: '上一轮提示词', model: 'doubao-seedream-5-5-261028',
      modelRef: { modelId: 'doubao-seedream-5-5-261028', profileId: 'tuzi-custom' },
      referenceImages: ['https://example.com/source.png', 'https://example.com/second.png'],
      params: { size: '1.5K', aspect_ratio: '4:3', watermark: 'false', background: 'transparent', mask_image: '/old-mask.png' },
    } });
    const before = structuredClone(task);
    const result = buildSeedream55ContinuePrefillData(task, { id: 'selected', url: 'https://example.com/second.png' });
    expect(result).toMatchObject({ count: 1, prompt: '', source: 'canvas-toolbar', modelRef: { profileId: 'tuzi-custom' },
      params: { size: '1.5K', aspect_ratio: '4:3', watermark: 'false', background: 'transparent' } });
    expect(result.images).toEqual([
      { url: 'https://example.com/second.png', name: '上一轮结果', sourceElementId: 'selected' },
      { url: 'https://example.com/source.png', name: '参考图 1' },
    ]);
    expect(result.params).not.toHaveProperty('mask_image');
    expect(task).toEqual(before);
    expect(buildImageTaskAIInputPrefillData(task).prompt).toBe('上一轮提示词');
  });

  it('keeps excess references visible for manual removal and refuses other models', () => {
    const task = imageTask({ params: { prompt: 'edit', model: 'doubao-seedream-5-5-261028',
      referenceImages: Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.png`) } });
    expect(buildSeedream55ContinuePrefillData(task, { id: 'result', url: '/result.png' }).images).toHaveLength(11);
    expect(() => buildSeedream55ContinuePrefillData(imageTask(), { id: 'result', url: '/result.png' })).toThrow('Seedream 5.5');
  });

  it('restores only original references and keeps duplicate pixels in their input order', () => {
    const task = imageTask({ params: {
      prompt: '合成', referenceImages: ['/a.png', '/a.png', '/c.png'],
      uploadedImages: [{ url: '/a.png' }, { url: '/c.png' }],
    } });
    const input = buildImageTaskAIInputPrefillData(task);
    expect(input.intent).toBe('restore');
    expect(input.images?.map((image) => image.url)).toEqual(['/a.png', '/a.png', '/c.png']);
    expect(input.images?.some((image) => image.url === task.result?.url)).toBe(false);
  });

  it('rerolls one random sample without altering the editable batch configuration', () => {
    const input = buildImageTaskAIInputPrefillData(imageTask({ params: {
      prompt: '风景', batchTotal: 4, size: '3:4', quality: 'high',
      outputCompression: 0, background: 'transparent',
      params: { seed: 123, custom_seed: 456, n: 4, guidance: 0, transparent: false, apiKey: 'secret' },
    } }));
    const reroll = buildImageRerollPrefillData(input);
    expect(input.count).toBe(4);
    expect(input.params?.seed).toBe('123');
    expect(input.params?.apiKey).toBeUndefined();
    expect(reroll).toMatchObject({ count: 1, images: [], params: {
      size: '3x4', quality: 'high', output_compression: '0', background: 'transparent',
      guidance: '0', transparent: 'false',
    } });
    expect(reroll.params).not.toHaveProperty('seed');
    expect(reroll.params).not.toHaveProperty('custom_seed');
    expect(reroll.params).not.toHaveProperty('n');
  });

  it('does not replace missing edit inputs with the generated result', () => {
    expect(() => buildImageTaskAIInputPrefillData(imageTask({ params: {
      prompt: '编辑', generationMode: 'image_edit',
    } }))).toThrow('参考图已缺失');
  });

  it('preserves a prior generated image when it was genuinely an original input', () => {
    const input = buildImageTaskAIInputPrefillData(imageTask({ params: {
      prompt: '编辑上次结果', referenceImages: ['/previous-result.png'],
    } }));
    expect(input.images?.map((image) => image.url)).toEqual(['/previous-result.png']);
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
