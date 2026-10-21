import { describe, expect, it } from 'vitest';
import {
  getStaticModelConfig,
  ModelVendor,
  type ModelConfig,
} from '../../constants/model-config';
import {
  compareModelsByDisplayPriority,
  createModelDisplayComparator,
  sortModelsByDisplayPriority,
} from '../model-sort';

function createImageModel(
  id: string,
  overrides: Partial<ModelConfig> = {}
): ModelConfig {
  return {
    id,
    label: id,
    type: 'image',
    vendor: ModelVendor.GEMINI,
    ...overrides,
  };
}

describe('model-sort', () => {
  it('在没有显式顺序时按版本号从新到旧排序', () => {
    const models = [
      createImageModel('gemini-2.5-flash-image'),
      createImageModel('gemini-3-pro-image-preview'),
      createImageModel('gemini-3.1-flash-image-preview'),
    ];

    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image',
    ]);
  });

  it('不会让分辨率后缀盖过主版本号', () => {
    const models = [
      createImageModel('gemini-3-pro-image-preview-4k'),
      createImageModel('gemini-3.1-flash-image-preview'),
    ];

    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview-4k',
    ]);
  });

  it('显式顺序优先于版本号', () => {
    const pinnedModel = {
      ...createImageModel('gemini-2.5-flash-image'),
      sortOrder: 0,
    } as ModelConfig & { sortOrder: number };
    const newerModel = createImageModel('gemini-3.1-flash-image-preview');

    expect(
      compareModelsByDisplayPriority(pinnedModel, newerModel)
    ).toBeLessThan(0);
  });

  it('同版本具名变体按名称稳定排序，不猜测能力高低', () => {
    const models = [
      createImageModel('gemini-3-flash-image-preview'),
      createImageModel('gemini-3-pro-image-preview'),
    ];

    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual(['gemini-3-flash-image-preview', 'gemini-3-pro-image-preview']);
  });

  it('同版本先默认规格，再按自然名称展示固定分辨率变体', () => {
    const models = [
      createImageModel('gemini-3-pro-image-preview'),
      createImageModel('gemini-3-pro-image-preview-2k'),
      createImageModel('gemini-3-pro-image-preview-4k'),
    ];

    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'gemini-3-pro-image-preview',
      'gemini-3-pro-image-preview-2k',
      'gemini-3-pro-image-preview-4k',
    ]);
  });

  it('图片忽略旧推荐分，GPT Image 系列排在旧 4o Image 系列前', () => {
    const models = [
      createImageModel('gpt-4o-image', {
        vendor: ModelVendor.GPT,
        recommendedScore: -999,
      }),
      createImageModel('gpt-image-2', {
        vendor: ModelVendor.GPT,
        recommendedScore: 95,
      }),
      createImageModel('gpt-image-1', {
        vendor: ModelVendor.GPT,
        recommendedScore: 87,
      }),
    ];

    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual(['gpt-image-2', 'gpt-image-1', 'gpt-4o-image']);
  });

  it('NEW 同版本变体优先于推荐模型，旧版不继承 NEW 优先级', () => {
    const models = [
      createImageModel('gpt-image-2.5-sunburst'),
      createImageModel('aurora-2-vip'),
      createImageModel('aurora-1', { tags: ['new'] }),
      createImageModel('aurora-2-4k'),
      createImageModel('aurora-1-vip'),
      createImageModel('aurora-0.9'),
    ];
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'aurora-1',
      'aurora-1-vip',
      'gpt-image-2.5-sunburst',
      'aurora-2-4k',
      'aurora-2-vip',
      'aurora-0.9',
    ]);
  });

  it('NEW 变体不会脱离同版本标准版，标准版在其变体前', () => {
    const models = [
      createImageModel('render-1'),
      createImageModel('render-2-4k', { tags: ['new'] }),
      createImageModel('render-2'),
      createImageModel('render-2-vip'),
      createImageModel('render-2-async'),
    ];
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'render-2',
      'render-2-4k',
      'render-2-async',
      'render-2-vip',
      'render-1',
    ]);
  });

  it('没有 NEW 的图片按版本排序，不让旧分数或简称中的数字抢先', () => {
    const models = [
      createImageModel('gpt-image-2', {
        recommendedScore: 95,
        shortCode: 'gpt9999',
      }),
      createImageModel('gpt-4o-image', { recommendedScore: -999 }),
      createImageModel('gpt-image-2.5-vip'),
      createImageModel('gpt-image-2.5'),
    ];
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'gpt-image-2.5',
      'gpt-image-2.5-vip',
      'gpt-image-2',
      'gpt-4o-image',
    ]);
  });

  it('数字版本自然比较，发布日期和分辨率不当作主版本', () => {
    const models = [
      createImageModel('seedream-5-0-260128'),
      createImageModel('seedream-4-5-251128-4k'),
      createImageModel('seedream-4-10'),
      createImageModel('seedream-4-9'),
    ];
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'seedream-5-0-260128',
      'seedream-4-10',
      'seedream-4-9',
      'seedream-4-5-251128-4k',
    ]);
  });

  it('推荐列表和普通排序不随输入顺序、描述、价格等信息变化', () => {
    const models = [
      createImageModel('gpt-image-2.5-flare', {
        description: '8K Pro 9999',
        recommendedScore: 999,
      }),
      createImageModel('gpt-image-2.5-sunburst', { recommendedScore: -999 }),
      createImageModel('gpt-image-2.5'),
    ];
    const expected = [
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
      'gpt-image-2.5',
    ];
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual(expected);
    expect(
      sortModelsByDisplayPriority([...models].reverse()).map(
        (model) => model.id
      )
    ).toEqual(expected);
    expect(models[0].id).toBe('gpt-image-2.5-flare');
  });

  it('NEW 继承限定为同供应商、同厂商和同版本', () => {
    const models = [
      createImageModel('render-2', { sourceProfileId: 'a', tags: ['new'] }),
      createImageModel('render-2-vip', { sourceProfileId: 'b' }),
      createImageModel('render-2-async', {
        sourceProfileId: 'a',
        vendor: ModelVendor.GPT,
      }),
      createImageModel('render-3', { sourceProfileId: 'a' }),
    ];
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual(['render-2', 'render-3', 'render-2-async', 'render-2-vip']);
  });

  it('保留非图片模型的推荐分、NEW、Pro 和高分辨率排序', () => {
    const models = [
      createImageModel('video-2-4k', { type: 'video' }),
      createImageModel('video-2', { type: 'video' }),
      createImageModel('video-1', { type: 'video', recommendedScore: 95 }),
    ];
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual(['video-1', 'video-2-4k', 'video-2']);
  });

  it('搜索过滤掉 NEW 原型后仍保留同版本变体优先级', () => {
    const models = [
      createImageModel('render-2', { tags: ['new'] }),
      createImageModel('render-2.0-vip'),
      createImageModel('render-3-vip'),
    ];
    const compare = createModelDisplayComparator(models);
    expect(
      models
        .filter((model) => model.id.includes('vip'))
        .sort(compare)
        .map((model) => model.id)
    ).toEqual(['render-2.0-vip', 'render-3-vip']);
  });

  it('排序形成稳定全序，重复排序和混合类型比较不会反转或循环', () => {
    const models = [
      createImageModel('render-1', { tags: ['new'] }),
      createImageModel('render-1-vip'),
      createImageModel('render-2'),
      createImageModel('gpt-image-2.5-sunburst'),
      createImageModel('render-2', { type: 'text', recommendedScore: 90 }),
      createImageModel('render-1', { type: 'video', tags: ['new'] }),
      createImageModel('render-1-pro', { type: 'video' }),
    ];
    const compare = createModelDisplayComparator(models);
    for (const a of models) {
      expect(compare(a, a)).toBe(0);
      for (const b of models) {
        expect(compare(a, b) + compare(b, a)).toBe(0);
        for (const c of models) {
          if (compare(a, b) <= 0 && compare(b, c) <= 0)
            expect(compare(a, c)).toBeLessThanOrEqual(0);
        }
      }
    }
    const sorted = sortModelsByDisplayPriority(models);
    expect(sortModelsByDisplayPriority(sorted)).toEqual(sorted);
  });

  it('截图中的真实 GPT 配置先显示 NEW 2.5 及其变体，再显示 2 和旧 4o', () => {
    const models = [
      'gpt-4o-image',
      'gpt-image-2',
      'gpt-image-2-vip',
      'gpt-image-2.5-vip',
      'gpt-image-2.5',
      'gpt-image-2.5-flare',
      'gpt-image-2.5-sunburst',
    ].map((id) => {
      const model = getStaticModelConfig(id);
      if (!model) throw new Error(`Missing model fixture: ${id}`);
      return model;
    });
    expect(
      sortModelsByDisplayPriority(models).map((model) => model.id)
    ).toEqual([
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
      'gpt-image-2.5',
      'gpt-image-2.5-vip',
      'gpt-image-2',
      'gpt-image-2-vip',
      'gpt-4o-image',
    ]);
  });
});
