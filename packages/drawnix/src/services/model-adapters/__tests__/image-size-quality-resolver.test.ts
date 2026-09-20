import { describe, expect, it } from 'vitest';
import {
  normalizeGPTImage25ResolutionParams,
  resolveOfficialGPTImageEditSize,
  resolveOfficialGPTImageQuality,
  resolveOfficialGPTImageSize,
} from '../image-size-quality-resolver';

const GPT_IMAGE_25_MODEL_IDS = [
  'gpt-image-2.5-1k',
];

describe('GPT Image 2.5 size and quality resolution', () => {
  it.each(['gpt-image-2', 'gpt-image-2-vip', 'gpt-image2', 'gpt-image2-vip'])(
    '%s keeps every 2K ratio within the billing pixel limits',
    (modelId) => {
      for (const [ratio, expected] of Object.entries({
        '1x1': '1920x1920',
        '2x3': '1536x2304',
        '3x2': '2304x1536',
        '3x4': '1632x2176',
        '4x3': '2176x1632',
        '4x5': '1664x2080',
        '5x4': '2080x1664',
        '9x16': '1440x2560',
        '16x9': '2560x1440',
        '21x9': '2912x1248',
      })) {
        const size = resolveOfficialGPTImageSize(modelId, ratio, { resolution: '2k' });
        expect(size).toBe(expected);
        expect(resolveOfficialGPTImageEditSize(modelId, ratio, { resolution: '2k' })).toBe(expected);
        const [width, height] = size!.split('x').map(Number);
        const [ratioWidth, ratioHeight] = ratio.split('x').map(Number);
        expect(width * ratioHeight).toBe(height * ratioWidth);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(width * height).toBeGreaterThan(1_048_576);
        expect(width * height).toBeLessThanOrEqual(3_686_400);
      }
      expect(resolveOfficialGPTImageSize(modelId, '4x5', { resolution: '1k' })).toBe('912x1152');
      expect(resolveOfficialGPTImageSize(modelId, '4x5', { resolution: '4k' })).toBe('2576x3216');
    }
  );

  it('does not apply the 2K billing override to gpt-image-2-1k', () => {
    expect(resolveOfficialGPTImageSize('gpt-image-2-1k', '4x5', { resolution: '2k' })).toBe('1824x2288');
  });

  it.each(['gpt-image-2.5', 'gpt-image-2.5-vip', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    '%s 将档位转换为有效尺寸并保留自动模式',
    (modelId) => {
      for (const [resolution, size] of [
        ['1k', '1024x1024'],
        ['2k', '1920x1920'],
        ['4k', '2880x2880'],
      ]) {
        expect(resolveOfficialGPTImageSize(modelId, undefined, { resolution })).toBe(size);
        expect(resolveOfficialGPTImageEditSize(modelId, 'auto', { resolution })).toBeUndefined();
        expect(resolveOfficialGPTImageSize(modelId, 'auto', { resolution })).toBeUndefined();
        expect(resolveOfficialGPTImageSize(modelId, '1x1', { resolution })).toBe(size);
        expect(normalizeGPTImage25ResolutionParams(modelId, {
          size: 'auto', resolution,
        })).toEqual({ size: 'auto', resolution });
      }
      expect(resolveOfficialGPTImageSize(modelId, 'auto', { resolution: 'auto' })).toBeUndefined();
      expect(resolveOfficialGPTImageSize(modelId, 'auto', {
        resolution: 'billing-1k', quality: '2k',
      })).toBeUndefined();
      expect(resolveOfficialGPTImageSize(modelId, '2x3', {
        resolution: 'billing-1k',
      })).toBe('832x1248');
      expect(resolveOfficialGPTImageSize(modelId, '2048x1152', { resolution: 'auto' })).toBe('2048x1152');
      expect(normalizeGPTImage25ResolutionParams(modelId, {
        size: '1536x1024', resolution: '4k', quality: 'high',
      })).toEqual({ size: '3x2', resolution: '4k', quality: 'high' });
    }
  );

  it('保持 image-2 的自动和显式像素尺寸行为', () => {
    expect(resolveOfficialGPTImageSize('gpt-image-2', 'auto', { resolution: '4k' })).toBeUndefined();
    expect(resolveOfficialGPTImageSize('gpt-image-2', '1024x1024', { resolution: '4k' })).toBe('1024x1024');
    expect(normalizeGPTImage25ResolutionParams('gpt-image-2', {
      size: 'auto', resolution: '4k',
    })).toEqual({ size: 'auto', resolution: '4k' });
  });
  it.each(['gpt-image-2.5', 'gpt-image-2.5-vip', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    '%s 使用扩展尺寸矩阵与 1K / 2K / 4K 档位',
    (modelId) => {
      expect(
        resolveOfficialGPTImageSize(modelId, '16x9', { resolution: '4k' })
      ).toBe('3840x2160');
      expect(
        resolveOfficialGPTImageSize(modelId, '1x1', { resolution: '2k' })
      ).toBe('1920x1920');
      expect(resolveOfficialGPTImageSize(modelId, '3840x2160')).toBe(
        '3840x2160'
      );
    }
  );

  it.each(['gpt-image-2.5', 'gpt-image-2.5-vip', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    '%s 选择 K 档位时保留自动比例并覆盖旧像素尺寸',
    (modelId) => {
      expect(resolveOfficialGPTImageSize(modelId, 'auto', { resolution: '4k' })).toBeUndefined();
      expect(
        resolveOfficialGPTImageSize(modelId, '1024x1024', { resolution: '4k' })
      ).toBe('2880x2880');
      expect(
        resolveOfficialGPTImageSize(modelId, '16x9', { resolution: '4k' })
      ).toBe('3840x2160');
    }
  );

  it.each(['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
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

  it.each(['gpt-image-2', 'gpt-image-2.5-1k', undefined])(
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
    '%s 不使用 GPT Image 2 分辨率矩阵',
    (modelId) => {
      expect(
        resolveOfficialGPTImageSize(modelId, '3x4', { resolution: '4k' })
      ).toBe('1024x1536');
      expect(
        resolveOfficialGPTImageSize(modelId, '16x9', { resolution: '2k' })
      ).toBe('1536x1024');
    }
  );

  it('编辑请求支持扩展尺寸，且保留官方 quality', () => {
    expect(
      resolveOfficialGPTImageEditSize('gpt-image-2.5', '2048x2048')
    ).toBe('2048x2048');
    expect(resolveOfficialGPTImageEditSize('gpt-image-2.5', '1024x1536')).toBe(
      '1024x1536'
    );
    expect(resolveOfficialGPTImageQuality({ quality: 'high' })).toBe('high');
  });
});
