import { describe, expect, it, vi } from 'vitest';
import { assertSameOrigin } from './auth';
import type { ApiRequest } from './http';

function request(headers: ApiRequest['headers']): ApiRequest {
  return { headers };
}

describe('same-origin write protection', () => {
  it('accepts an exact origin and host match', () => {
    expect(() =>
      assertSameOrigin(
        request({ origin: 'https://app.example.com', host: 'app.example.com' })
      )
    ).not.toThrow();
  });

  it('rejects a mismatched origin', () => {
    expect(() =>
      assertSameOrigin(
        request({ origin: 'https://evil.example', host: 'app.example.com' })
      )
    ).toThrow(/跨站/);
  });

  it('rejects an HTTP origin for the same public host in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() =>
        assertSameOrigin(
          request({ origin: 'http://app.example.com', host: 'app.example.com' })
        )
      ).toThrow(/跨站/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects browser-reported cross-site writes without an origin', () => {
    expect(() =>
      assertSameOrigin(
        request({ host: 'app.example.com', 'sec-fetch-site': 'cross-site' })
      )
    ).toThrow(/跨站/);
  });
});
