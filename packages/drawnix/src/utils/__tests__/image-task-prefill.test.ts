import { describe, expect, it } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  buildImageTaskAIInputPrefillData,
  buildImageTaskPrefillInitialData,
  getImageTaskReferenceImages,
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
