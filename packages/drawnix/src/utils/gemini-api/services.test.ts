import { describe, expect, it } from 'vitest';
import { normalizeAspectRatio, normalizeGoogleImageResult } from './services';

describe('normalizeAspectRatio', () => {
  it('preserves canonical Gemini aspect ratio enums', () => {
    expect(normalizeAspectRatio('21x9')).toBe('21:9');
    expect(normalizeAspectRatio('16x9')).toBe('16:9');
    expect(normalizeAspectRatio('9x16')).toBe('9:16');
  });

  it('normalizes pixel sizes to reduced aspect ratios', () => {
    expect(normalizeAspectRatio('1280x720')).toBe('16:9');
    expect(normalizeAspectRatio('1024x1792')).toBe('4:7');
  });

  it('returns ratio strings as-is', () => {
    expect(normalizeAspectRatio('21:9')).toBe('21:9');
    expect(normalizeAspectRatio('auto')).toBeUndefined();
  });
});

describe('normalizeGoogleImageResult', () => {
  it('extracts inline image data from normal responses', () => {
    const result = normalizeGoogleImageResult(
      'ok data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );

    expect(result.data).toEqual([
      {
        b64_json:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    ]);
  });

  it('rejects blocked prompt placeholder responses before extracting image data', () => {
    expect(() =>
      normalizeGoogleImageResult(
        'prompt_blocked code: prompt_blocked reason: PROHIBITED_CONTENT data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      )
    ).toThrow('内容被拒绝');
  });
});
