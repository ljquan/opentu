import { describe, expect, it } from 'vitest';
import { normalizeAspectRatio } from './services';

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

