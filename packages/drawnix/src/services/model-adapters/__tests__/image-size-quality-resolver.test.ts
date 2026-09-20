import { describe, expect, it } from 'vitest';
import {
  resolveOfficialGPTImageEditSize,
  resolveOfficialGPTImageQuality,
  resolveOfficialGPTImageSize,
} from '../image-size-quality-resolver';

const GPT_IMAGE_25_MODEL_IDS = [
  'gpt-image-2.5-1k',
  'gpt-image-2.5',
  'gpt-image-2.5-vip',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
];

describe('GPT Image 2.5 size and quality resolution', () => {
  it.each([
    'gpt-image-2.5',
    'gpt-image-2.5-vip',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-flare',
  ])(
    '%s 使用扩展尺寸矩阵与 1K / 2K / 4K 档位',
    (modelId) => {
      expect(
        resolveOfficialGPTImageSize(modelId, '16x9', { resolution: '4k' })
      ).toBe('3840x2160');
      expect(
        resolveOfficialGPTImageSize(modelId, '1x1', { resolution: '2k' })
      ).toBe('2048x2048');
      expect(resolveOfficialGPTImageSize(modelId, '3840x2160')).toBe(
        '3840x2160'
      );
    }
  );

  it.each(GPT_IMAGE_25_MODEL_IDS)(
    '%s 支持 GPT Image 2.5 官方最高画质档位',
    (modelId) => {
      expect(
        resolveOfficialGPTImageQuality({ quality: 'xhigh' }, modelId)
      ).toBe('xhigh');
      expect(resolveOfficialGPTImageQuality({ quality: 'max' }, modelId)).toBe(
        'max'
      );
    }
  );

  it.each(['gpt-image-2', undefined])(
    '%s 不透传新型号专用的画质档位',
    (modelId) => {
      expect(
        resolveOfficialGPTImageQuality({ quality: 'xhigh' }, modelId)
      ).toBeUndefined();
      expect(
        resolveOfficialGPTImageQuality({ quality: 'max' }, modelId)
      ).toBeUndefined();
    }
  );

  it('gpt-image-2.5-1k 始终使用 1K 尺寸矩阵', () => {
    expect(
      resolveOfficialGPTImageSize('gpt-image-2.5-1k', '16x9', {
        resolution: '4k',
      })
    ).toBe('1360x768');
    expect(
      resolveOfficialGPTImageSize('gpt-image-2.5-1k', '3x4', {
        resolution: '2k',
      })
    ).toBe('880x1184');
  });

  it('selected GPT Image 2 resolution overrides concrete source pixels', () => {
    expect(
      resolveOfficialGPTImageSize('gpt-image-2', '1086x1448', {
        resolution: '4k',
      })
    ).toBe('2480x3312');
  });

  it('does not derive a resolution tier from quality', () => {
    expect(
      resolveOfficialGPTImageSize('gpt-image-2', '4x3', { quality: '2k' })
    ).toBe('1184x880');
  });

  it('编辑请求同样使用扩展尺寸矩阵，且保留官方 quality', () => {
    expect(
      resolveOfficialGPTImageEditSize('gpt-image-2.5', '16x9', {
        resolution: '4k',
      })
    ).toBe('3840x2160');
    expect(
      resolveOfficialGPTImageEditSize('gpt-image-2.5-1k', '2x3', {
        resolution: '4k',
      })
    ).toBe('832x1248');
    expect(resolveOfficialGPTImageQuality({ quality: 'high' })).toBe('high');
  });
});
