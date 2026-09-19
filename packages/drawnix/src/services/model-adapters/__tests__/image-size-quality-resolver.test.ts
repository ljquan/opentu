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
];

describe('GPT Image 2.5 size and quality resolution', () => {
  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
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

  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
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

  it.each(['gpt-image-2', 'gpt-image-2.5', undefined])(
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

  it.each(GPT_IMAGE_25_MODEL_IDS)(
    '%s 仅透传官方支持的像素尺寸并省略 auto',
    (modelId) => {
      expect(resolveOfficialGPTImageSize(modelId, 'auto')).toBeUndefined();
      expect(resolveOfficialGPTImageSize(modelId, '1024x1024')).toBe(
        '1024x1024'
      );
      expect(resolveOfficialGPTImageSize(modelId, '1024x1536')).toBe(
        '1024x1536'
      );
      expect(resolveOfficialGPTImageSize(modelId, '1536x1024')).toBe(
        '1536x1024'
      );
      expect(resolveOfficialGPTImageSize(modelId, '2048x2048')).toBeUndefined();
      expect(resolveOfficialGPTImageSize(modelId, '1360x768')).toBeUndefined();
    }
  );

  it.each(GPT_IMAGE_25_MODEL_IDS)(
    '%s 无显式高分辨率时使用标准尺寸映射',
    (modelId) => {
      expect(resolveOfficialGPTImageSize(modelId, '3x4')).toBe('1024x1536');
      expect(
        resolveOfficialGPTImageSize(modelId, '3x4', { resolution: '1k' })
      ).toBe('1024x1536');
      expect(resolveOfficialGPTImageSize(modelId, '16x9')).toBe('1536x1024');
    }
  );

  it.each(GPT_IMAGE_25_MODEL_IDS)(
    '%s 拒绝不支持的高分辨率，不静默回退到标准尺寸',
    (modelId) => {
      expect(
        () => resolveOfficialGPTImageSize(modelId, '3x4', { resolution: '4k' })
      ).toThrow('不支持所选分辨率');
      expect(
        () => resolveOfficialGPTImageSize(modelId, '16x9', { resolution: '2k' })
      ).toThrow('不支持所选分辨率');
      expect(
        () => resolveOfficialGPTImageEditSize(modelId, '1024x1536', { resolution: '4k' })
      ).toThrow('不支持所选分辨率');
    }
  );

  it.each(GPT_IMAGE_25_MODEL_IDS)(
    '%s 在自动比例下仍拒绝不支持的高分辨率，但不再拒绝 1K',
    (modelId) => {
      expect(resolveOfficialGPTImageSize(modelId, 'auto', { resolution: '1k' })).toBeUndefined();
      expect(() =>
        resolveOfficialGPTImageSize(modelId, 'auto', { resolution: '4k' })
      ).toThrow('不支持所选分辨率');
    }
  );

  it.each(['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    '%s 在自动比例且无参考图时拒绝无法表达的 2K/4K',
    (modelId) => {
      expect(() => resolveOfficialGPTImageSize(modelId, 'auto', { resolution: '2k' }))
        .toThrow('必须明确图片比例或提供参考图');
      expect(() => resolveOfficialGPTImageSize(modelId, 'auto', { resolution: '4k' }))
        .toThrow('必须明确图片比例或提供参考图');
    }
  );

  it('编辑请求同样限制尺寸，且保留官方 quality', () => {
    expect(
      resolveOfficialGPTImageEditSize('gpt-image-2.5', '2048x2048')
    ).toBeUndefined();
    expect(resolveOfficialGPTImageEditSize('gpt-image-2.5', '1024x1536')).toBe(
      '1024x1536'
    );
    expect(resolveOfficialGPTImageQuality({ quality: 'high' })).toBe('high');
  });
});
