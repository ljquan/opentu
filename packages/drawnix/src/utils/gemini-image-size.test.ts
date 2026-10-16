import { describe, expect, it } from 'vitest';
import {
  inferGeminiImageQuality,
  resolveGeminiImageRequestSize,
} from './gemini-image-size';

describe('Gemini image quality size mapping', () => {
  it.each([
    ['gemini-3.1-flash-image-preview-2k', '2k'],
    ['gemini-3.1-flash-image-preview-4k', '4k'],
  ])('infers fixed quality from %s', (model, quality) => {
    expect(inferGeminiImageQuality(model)).toBe(quality);
  });

  it.each([
    ['1k', '1536x864'],
    ['2k', '2048x1152'],
    ['4k', '3840x2160'],
  ] as const)('maps 16:9 to the %s tier', (quality, expected) => {
    expect(
      resolveGeminiImageRequestSize(
        '16x9',
        quality,
        'gemini-3.1-flash-image-preview'
      )
    ).toBe(expected);
  });

  it('maps a 4K square request to 4096 pixels', () => {
    expect(
      resolveGeminiImageRequestSize(
        '2880x2880',
        '4k',
        'gemini-3.1-flash-image-preview'
      )
    ).toBe('4096x4096');
  });

  it('keeps auto and non-Gemini sizes unchanged', () => {
    expect(resolveGeminiImageRequestSize('auto', '4k', 'gemini-3.1-flash-image-preview')).toBeUndefined();
    expect(resolveGeminiImageRequestSize('16x9', '4k', 'gpt-image-2')).toBe('16x9');
  });
});
