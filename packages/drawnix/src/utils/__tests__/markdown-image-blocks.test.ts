import { describe, expect, it } from 'vitest';
import {
  buildMarkdownImageTitle,
  parseMarkdownImageTitle,
  parseMarkdownImageAlt,
} from '../markdown-image-blocks';

describe('markdown-image-blocks', () => {
  it('builds and parses width and height metadata', () => {
    const title = buildMarkdownImageTitle({ width: 320, height: 180 });

    expect(title).toBe('opentu-image:w=320&h=180');
    expect(parseMarkdownImageTitle(title)).toEqual({
      caption: '',
      width: 320,
      height: 180,
    });
  });

  it('preserves caption when width and height metadata are encoded in title', () => {
    const title = buildMarkdownImageTitle({
      width: 480,
      height: 240,
      caption: '示例说明',
    });

    expect(parseMarkdownImageTitle(title)).toEqual({
      caption: '示例说明',
      width: 480,
      height: 240,
    });
  });

  it('treats plain title as caption when there is no metadata prefix', () => {
    expect(parseMarkdownImageTitle('普通标题')).toEqual({
      caption: '普通标题',
      width: undefined,
      height: undefined,
    });
  });

  it('parses asset image alt text and keeps normal alt text intact', () => {
    expect(parseMarkdownImageAlt('image|封面图')).toEqual({
      assetType: 'image',
      label: '封面图',
      rawAlt: 'image|封面图',
      isAssetAlt: true,
    });

    expect(parseMarkdownImageAlt('普通图片说明')).toEqual({
      assetType: null,
      label: '普通图片说明',
      rawAlt: '普通图片说明',
      isAssetAlt: false,
    });
  });
});
