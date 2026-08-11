import { describe, expect, it } from 'vitest';
import { formatMediaItemDimensions } from './MediaViewport';

describe('formatMediaItemDimensions', () => {
  it('显示图片上游返回的实际尺寸', () => {
    expect(
      formatMediaItemDimensions({
        type: 'image',
        url: 'https://example.com/image.png',
        width: 1023,
        height: 1537,
      })
    ).toBe('1023×1537');
  });

  it.each([
    { width: undefined, height: undefined },
    { width: 0, height: 1537 },
    { width: 1023.5, height: 1537 },
  ])('图片尺寸为空或非法时不显示：%o', ({ width, height }) => {
    expect(
      formatMediaItemDimensions({
        type: 'image',
        url: 'https://example.com/image.png',
        width,
        height,
      })
    ).toBeNull();
  });

  it('非图片媒体不显示尺寸', () => {
    expect(
      formatMediaItemDimensions({
        type: 'video',
        url: 'https://example.com/video.mp4',
        width: 1920,
        height: 1080,
      })
    ).toBeNull();
  });
});
