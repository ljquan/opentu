import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRecord } from '../provider';
import { encryptSecret } from '../crypto';
import { requestProviderJson } from './outbound';

function provider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: 'provider-1',
    name: 'Provider',
    base_url: 'http://localhost',
    auth_type: 'bearer',
    auth_header: null,
    auth_query: null,
    extra_headers: {},
    encrypted_api_key: encryptSecret('server-only-secret'),
    enabled: true,
    health_status: 'healthy',
    health_message: null,
    last_checked_at: null,
    ...overrides,
  };
}

describe('generation outbound transport', () => {
  afterEach(() => {
    delete process.env.OPENTU_PROVIDER_ENCRYPTION_KEY;
  });

  it.each([
    new DOMException('Timed out', 'TimeoutError'),
    new TypeError('connection reset'),
  ])(
    'does not authorize resubmission after an ambiguous transport failure: %s',
    async (error) => {
      process.env.OPENTU_PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
        'base64'
      );
      await expect(
        requestProviderJson(provider(), {
          path: '/v1/images/generations',
          body: '{}',
          timeoutMs: 1000,
          maxResponseBytes: 1024,
          fetcher: vi.fn().mockRejectedValue(error),
        })
      ).rejects.toMatchObject({ retryable: false });
    }
  );

  it('uses a fixed provider path, server credential, and no redirects', async () => {
    process.env.OPENTU_PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString(
      'base64'
    );
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await requestProviderJson(provider(), {
      path: '/v1/chat/completions',
      body: '{}',
      contentType: 'application/json',
      timeoutMs: 1000,
      maxResponseBytes: 1024,
      idempotencyKey: 'task-1',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls.at(0) as unknown as [
      string,
      RequestInit
    ];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('http://localhost/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect(headers.Authorization).toBe('Bearer server-only-secret');
    expect(headers['Idempotency-Key']).toBe('task-1');
  });

  it('rejects oversized JSON responses before parsing them', async () => {
    process.env.OPENTU_PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString(
      'base64'
    );
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ value: 'too large' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '9999',
          },
        })
    );

    await expect(
      requestProviderJson(provider(), {
        path: '/v1/chat/completions',
        body: '{}',
        timeoutMs: 1000,
        maxResponseBytes: 128,
        fetcher,
      })
    ).rejects.toMatchObject({ code: 'UPSTREAM_RESPONSE_TOO_LARGE' });
  });

  it('does not permit configured extra headers to override authorization', async () => {
    process.env.OPENTU_PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString(
      'base64'
    );
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer server-only-secret'
      );
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await requestProviderJson(
      provider({ extra_headers: { Authorization: 'Bearer attacker-value' } }),
      {
        path: '/v1/chat/completions',
        body: '{}',
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        fetcher,
      }
    );
  });

  it('maps a non-JSON rate-limit response without exposing its body', async () => {
    process.env.OPENTU_PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString(
      'base64'
    );
    const fetcher = vi.fn(
      async () =>
        new Response('Bearer leaked-upstream-secret', {
          status: 429,
          headers: { 'Content-Type': 'text/plain' },
        })
    );

    await expect(
      requestProviderJson(provider(), {
        path: '/v1/chat/completions',
        body: '{}',
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        fetcher,
      })
    ).rejects.toMatchObject({
      code: 'UPSTREAM_BUSY',
      retryable: true,
      upstreamStatus: 429,
    });
  });
});
