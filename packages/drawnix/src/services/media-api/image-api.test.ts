import { describe, expect, it } from 'vitest';
import { buildImageRequestBody, parseImageResponse } from './image-api';
import { normalizeToClosestImageSize } from './utils';

describe('parseImageResponse', () => {
  it('normalizes raw base64 image payloads into data URLs', () => {
    const result = parseImageResponse({
      data: [
        {
          b64_json:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      ],
    });

    expect(result.url).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
    expect(result.format).toBe('png');
  });

  it('preserves normal remote URLs', () => {
    const result = parseImageResponse({
      data: [
        {
          url: 'https://example.com/test.webp',
        },
      ],
    });

    expect(result.url).toBe('https://example.com/test.webp');
    expect(result.format).toBe('webp');
  });
});

describe('normalizeToClosestImageSize', () => {
  it('preserves concrete pixel sizes for GPT-compatible image APIs', () => {
    expect(normalizeToClosestImageSize('2880x2880', '1x1')).toBe('2880x2880');
    expect(normalizeToClosestImageSize('3840x2160', '1x1')).toBe('3840x2160');
  });

  it('still normalizes aspect-ratio input to supported size tokens', () => {
    expect(normalizeToClosestImageSize('16:9', '1x1')).toBe('16x9');
    expect(normalizeToClosestImageSize('1024', '1x1')).toBe('1x1');
  });
});

describe('buildImageRequestBody', () => {
  it.each(['16x9', '16:9'])('maps aspectRatio %s before legacy conversion', (aspectRatio) => {
    expect(buildImageRequestBody({
      model: 'gemini-3.1-flash-image-preview-4k', prompt: 'draw', aspectRatio,
    })).toMatchObject({ size: '3840x2160', quality: '4k' });
  });

  it('preserves other providers and unspecified Gemini quality', () => {
    for (const model of ['other-image-model', 'gemini-3.1-flash-image-preview']) {
      expect(buildImageRequestBody({ model, prompt: 'draw', size: '16x9' }).size)
        .toBe('1792x1024');
    }
    expect(JSON.parse(JSON.stringify(buildImageRequestBody({
      model: 'gemini-3.1-flash-image-preview-4k', prompt: 'draw', size: 'auto',
    })))).toEqual({ model: 'gemini-3.1-flash-image-preview-4k', prompt: 'draw', quality: '4k' });
  });
  it.each([
    ['gemini-3.1-flash-image-preview-2k', '2k'],
    ['gemini-3.1-flash-image-preview-4k', '4k'],
    ['gemini-3-pro-image-preview-4k-vip', '4k'],
  ])('preserves fixed %s quality when params omit quality', (model, quality) => {
    expect(buildImageRequestBody({
      model,
      prompt: 'draw',
      size: '16x9',
    })).toMatchObject({ model, prompt: 'draw', size: quality === '2k' ? '2048x1152' : '3840x2160', quality });
  });

  it('prefers an explicit quality over the model suffix', () => {
    expect(buildImageRequestBody({
      model: 'gemini-3.1-flash-image-preview-4k',
      prompt: 'draw',
      quality: '2k',
    }).quality).toBe('2k');
  });

  it.each([
    ['2k', '2048x2048'],
    ['4k', '4096x4096'],
  ] as const)('maps a square request to the %s tier', (quality, size) => {
    expect(buildImageRequestBody({
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'draw',
      size: '1x1',
      quality,
    })).toMatchObject({ size, quality });
  });

});
