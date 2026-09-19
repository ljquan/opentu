import { describe, expect, it } from 'vitest';
import { buildImageRequestBody, parseImageResponse } from './image-api';
import { normalizeToClosestImageSize } from './utils';

describe('parseImageResponse', () => {
  it('keeps actual output dimensions for result persistence', () => {
    expect(parseImageResponse({ data: [{ url: 'https://example.com/output.png', width: 2480, height: 3312 }] }))
      .toMatchObject({ width: 2480, height: 3312 });
    expect(parseImageResponse({ data: [{ width: 1, height: 1 }, { url: 'https://example.com/output.png', width: 2480, height: 3312 }] }))
      .toMatchObject({ width: 2480, height: 3312 });
  });

  it('keeps automatic sizing independent of the generic gateway K tier', () => {
    expect(buildImageRequestBody({ prompt: 'test', size: 'auto', quality: '4k' })).toEqual({ prompt: 'test', model: undefined, quality: '4k' });
  });

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
