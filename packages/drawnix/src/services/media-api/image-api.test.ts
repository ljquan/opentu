import { describe, expect, it } from 'vitest';
import { parseImageResponse } from './image-api';
import { normalizeToClosestImageSize, sizeToAspectRatio } from './utils';

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

describe('sizeToAspectRatio', () => {
  it('保留业界约定的 21:9 比例名称', () => {
    expect(sizeToAspectRatio('21x9')).toBe('21:9');
  });
});
