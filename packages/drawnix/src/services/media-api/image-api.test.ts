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
  it('sends transparent requests as PNG when using the generic image route', () => {
    expect(
      buildImageRequestBody({
        prompt: 'transparent icon',
        model: 'gpt-image-2',
        background: 'transparent',
      })
    ).toMatchObject({
      prompt: 'transparent icon',
      model: 'gpt-image-2',
      background: 'transparent',
      output_format: 'png',
    });
  });

  it('keeps WebP and valid compression when explicitly requested', () => {
    expect(
      buildImageRequestBody({
        prompt: 'transparent icon',
        model: 'gpt-image-2',
        background: 'transparent',
        outputFormat: 'webp',
        outputCompression: 80,
      })
    ).toMatchObject({
      background: 'transparent',
      output_format: 'webp',
      output_compression: 80,
    });
  });

  it('omits compression outside the supported range or for PNG output', () => {
    expect(
      buildImageRequestBody({
        prompt: 'transparent icon',
        background: 'transparent',
        outputCompression: 120,
      })
    ).not.toHaveProperty('output_compression');
  });
});
