import { describe, expect, it } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import {
  compareModelsByDisplayPriority,
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

    expect(sortModelsByDisplayPriority(models).map((model) => model.id)).toEqual([
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

    expect(sortModelsByDisplayPriority(models).map((model) => model.id)).toEqual([
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

    expect(compareModelsByDisplayPriority(pinnedModel, newerModel)).toBeLessThan(0);
  });

  it('同版本时 Pro 优先于非 Pro', () => {
    const models = [
      createImageModel('gemini-3-flash-image-preview'),
      createImageModel('gemini-3-pro-image-preview'),
    ];

    expect(sortModelsByDisplayPriority(models).map((model) => model.id)).toEqual([
      'gemini-3-pro-image-preview',
      'gemini-3-flash-image-preview',
    ]);
  });

  it('同版本同档位时 4K 优先于 2K 和默认', () => {
    const models = [
      createImageModel('gemini-3-pro-image-preview'),
      createImageModel('gemini-3-pro-image-preview-2k'),
      createImageModel('gemini-3-pro-image-preview-4k'),
    ];

    expect(sortModelsByDisplayPriority(models).map((model) => model.id)).toEqual([
      'gemini-3-pro-image-preview-4k',
      'gemini-3-pro-image-preview-2k',
      'gemini-3-pro-image-preview',
    ]);
  });
});
