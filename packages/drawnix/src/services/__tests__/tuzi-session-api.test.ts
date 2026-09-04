import { describe, expect, it, vi } from 'vitest';
import { readTuziEmbeddedConfig } from '../tuzi-embedded-config';
import { TuziSessionApiClient, TuziSessionApiError } from '../tuzi-session-api';

vi.mock('../tuzi-token-auth', () => ({
  getTuziSystemToken: () => 'system-token',
  getTuziSystemUserId: () => '40832',
}));

const config = {
  enabled: true,
  apiBaseUrl: 'http://localhost:3100',
  parentOrigin: 'http://localhost:5176',
};

describe('tuzi embedded config', () => {
  it('enables with the public Tuzi API by default', () => {
    expect(readTuziEmbeddedConfig({})).toMatchObject({
      enabled: true,
      apiBaseUrl: 'https://api.tu-zi.com',
    });
  });

  it('only disables with an explicit false flag', () => {
    expect(
      readTuziEmbeddedConfig({
        VITE_TUZI_API_BASE_URL: 'http://localhost:3100/',
      })
    ).toMatchObject({ enabled: true, apiBaseUrl: 'http://localhost:3100' });
    expect(
      readTuziEmbeddedConfig({
        VITE_TUZI_EMBEDDED_MODE: 'false',
        VITE_TUZI_API_BASE_URL: 'http://localhost:3100/',
      }).enabled
    ).toBe(false);
    expect(
      readTuziEmbeddedConfig({
        VITE_TUZI_API_BASE_URL: 'javascript:alert(1)',
      }).enabled
    ).toBe(false);
  });

  it('allows a valid API URL to override the public default', () => {
    expect(
      readTuziEmbeddedConfig({
        VITE_TUZI_API_BASE_URL: 'http://192.168.50.218:3100/',
      })
    ).toMatchObject({
      enabled: true,
      apiBaseUrl: 'http://192.168.50.218:3100',
    });
  });

  it('keeps the configured API host for loopback pages and follows LAN hosts', () => {
    const env = {
      VITE_TUZI_EMBEDDED_MODE: 'true',
      VITE_TUZI_API_BASE_URL: 'http://192.168.50.218:3100',
    };

    expect(readTuziEmbeddedConfig(env, 'http://localhost:5173')).toMatchObject({
      apiBaseUrl: 'http://192.168.50.218:3100',
    });
    expect(
      readTuziEmbeddedConfig(env, 'http://192.168.50.99:5173')
    ).toMatchObject({ apiBaseUrl: 'http://192.168.50.99:3100' });
  });

  it('does not rewrite a configured public API hostname', () => {
    expect(
      readTuziEmbeddedConfig(
        {
          VITE_TUZI_EMBEDDED_MODE: 'true',
          VITE_TUZI_API_BASE_URL: 'https://api.tu-zi.com',
        },
        'http://localhost:5173'
      )
    ).toMatchObject({ apiBaseUrl: 'https://api.tu-zi.com' });
  });
});

describe('TuziSessionApiClient', () => {
  it('preserves the global receiver required by browser fetch', async () => {
    const fetcher = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.getModels()).resolves.toEqual([]);
  });

  it('uses system-token GET requests and parses account data', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 7,
              role: 1,
              username: 'tuzi-user',
              display_name: 'Tuzi User',
              quota: 1200,
              used_quota: 300,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.getAccount()).resolves.toMatchObject({
      id: 7,
      role: 1,
      username: 'tuzi-user',
      displayName: 'Tuzi User',
      quota: 1200,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3100/api/user/self',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        headers: expect.objectContaining({
          Authorization: 'Bearer system-token',
          'New-Api-User': '40832',
        }),
      })
    );
  });

  it('parses the existing Tuzi quota display configuration', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              quota_per_unit: 500000,
              quota_display_type: 'CNY',
              usd_exchange_rate: 7.3,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.getDisplayConfig()).resolves.toMatchObject({
      quotaPerUnit: 500000,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7.3,
    });
  });

  it('maps an invalid system token to a stable client error', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'SESSION_EXPIRED', message: '登录已过期' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.getModels()).rejects.toMatchObject<
      Partial<TuziSessionApiError>
    >({ code: 'TOKEN_INVALID', status: 401 });
  });

  it('ensures managed group providers with a system-token POST', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              providers: [
                {
                  id: 'tuzi-managed-abc',
                  group: 'image',
                  display_name: '图片分组',
                  api_key: 'sk-managed',
                  status: 1,
                  rotated_at: 1700000000,
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.ensureManagedProviders()).resolves.toEqual([
      expect.objectContaining({ group: 'image', apiKey: 'sk-managed' }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3100/api/opentu/providers/ensure',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        headers: expect.objectContaining({
          Authorization: 'Bearer system-token',
          'New-Api-User': '40832',
        }),
      })
    );
  });

  it('rotates managed providers with an explicit old-token delete action', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'tuzi-managed-default',
              group: 'default',
              display_name: 'default',
              api_key: 'sk-next',
              status: 1,
              rotated_at: 1700000100,
              previous_token_deleted: true,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.rotateManagedProvider('default')).resolves.toEqual(
      expect.objectContaining({ group: 'default', apiKey: 'sk-next' })
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3100/api/opentu/providers/default/rotate?previous_token_action=delete',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer system-token',
          'New-Api-User': '40832',
        }),
      })
    );
  });

  it('rejects managed provider rotation when the old token is not deleted', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'tuzi-managed-default',
              group: 'default',
              display_name: 'default',
              api_key: 'sk-next',
              status: 1,
              rotated_at: 1700000100,
              previous_token_deleted: false,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.rotateManagedProvider('default')).rejects.toMatchObject<
      Partial<TuziSessionApiError>
    >({
      code: 'REQUEST_FAILED',
      message: '新 Key 已生成，但旧 Key 删除失败，请重试',
    });
  });

  it('parses existing paged log responses', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  id: 12,
                  created_at: 1700000000,
                  channel_id: 730,
                  channel_name: 'OpenTu',
                  username: 'tuzi-user',
                  model_name: 'gpt-test',
                  status_text: '成功扣费',
                  quota: 42,
                  content: '按Token计费，分组倍率: 0.8',
                  prompt_tokens: 11,
                  completion_tokens: 22,
                  ip: '127.0.0.1',
                  retry_count: 1,
                  request_id: 'req-1',
                  response_id: 'resp-1',
                  upstream_request_id: 'upstream-1',
                  other: JSON.stringify({
                    request_host: 'api.example.com',
                    request_path: '/v1/images/generations',
                    generated_image_urls: ['https://example.com/image.png'],
                    billing_detail: { mode: 'token', total: 42 },
                  }),
                },
              ],
              total: 1,
              page: 1,
              page_size: 20,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await expect(client.getLogs()).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: 12,
          channelId: '730',
          channelName: 'OpenTu',
          username: 'tuzi-user',
          modelName: 'gpt-test',
          callStatus: '成功扣费',
          content: '按Token计费，分组倍率: 0.8',
          completionTokens: 22,
          ip: '127.0.0.1',
          retryCount: 1,
          requestId: 'req-1',
          responseId: 'resp-1',
          upstreamRequestId: 'upstream-1',
          other: {
            request_host: 'api.example.com',
            request_path: '/v1/images/generations',
            generated_image_urls: ['https://example.com/image.png'],
            billing_detail: { mode: 'token', total: 42 },
          },
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('type=2'),
      expect.anything()
    );
  });

  it('keeps privileged callers scoped to the selected user logs', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { items: [], total: 0, page: 1, page_size: 20 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new TuziSessionApiClient(config, fetcher as typeof fetch);

    await client.getLogs(1, 20, true);

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/log/self?'),
      expect.anything()
    );
  });
});
