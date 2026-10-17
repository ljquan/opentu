import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from './provider';

describe('provider endpoint validation', () => {
  it('normalizes an OpenAI-compatible v1 base URL', () => {
    expect(normalizeBaseUrl('https://example.com/v1/')).toBe('https://example.com');
  });

  it('rejects insecure or credential-bearing production endpoints', () => {
    expect(() => normalizeBaseUrl('http://example.com/v1')).toThrow(/安全校验/);
    expect(() => normalizeBaseUrl('https://user:pass@example.com')).toThrow(/不能包含/);
    expect(() => normalizeBaseUrl('https://192.168.1.2/v1')).toThrow(/内网/);
  });
});
