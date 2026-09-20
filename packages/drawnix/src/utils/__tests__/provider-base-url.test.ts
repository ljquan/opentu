import { describe, expect, it } from 'vitest';
import { normalizeModelApiBaseUrl } from '../provider-base-url';

describe('normalizeModelApiBaseUrl', () => {
  it('将 Tuzi 的 HTTP 地址升级为 HTTPS，避免模型发现预检被重定向', () => {
    expect(normalizeModelApiBaseUrl('http://api.tu-zi.com')).toBe(
      'https://api.tu-zi.com/v1'
    );
    expect(normalizeModelApiBaseUrl('http://apius.tu-zi.com/v1/')).toBe(
      'https://apius.tu-zi.com/v1'
    );
  });

  it('保留本地及非 Tuzi 供应商的 HTTP 地址', () => {
    expect(normalizeModelApiBaseUrl('http://localhost:3100')).toBe(
      'http://localhost:3100/v1'
    );
    expect(normalizeModelApiBaseUrl('http://provider.example/v1')).toBe(
      'http://provider.example/v1'
    );
  });
});
