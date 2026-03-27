import { describe, expect, it } from 'vitest';
import { parseImageResponse } from './image-api';

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
