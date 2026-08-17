import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenTuApiClient,
  OpenTuApiResponseError,
  isAllowedOpenTuRelayPath,
  normalizeTuziDpopOrigin,
  toOpenTuRelayPath,
} from '../opentu-api-client';
import {
  OpenTuCredentialSession,
  OpenTuCredentialVault,
  generateCredentialKeyMaterial,
} from '../opentu-credential';
import { ProviderTransport } from '../provider-routing/provider-transport';

const cryptoProvider = webcrypto as unknown as Crypto;

function decodeJwtPayload(proof: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(proof.split('.')[1], 'base64url').toString('utf8')
  ) as Record<string, unknown>;
}

async function createCredentialClient(fetcher: typeof fetch) {
  const vault = new OpenTuCredentialVault(new IDBFactory(), cryptoProvider);
  const material = await generateCredentialKeyMaterial(cryptoProvider);
  await vault.save({
    credentialId: 'credential-1',
    deviceId: 'device-1',
    refreshToken: 'refresh-1',
    publicJwk: material.publicJwk,
    privateKey: material.privateKey,
  });
  const session = new OpenTuCredentialSession(vault);
  const client = new OpenTuApiClient({
    origin: 'http://127.0.0.1:5173',
    vault,
    session,
    fetcher,
    now: () => 1_700_000_000_000,
  });
  return { client, session, vault };
}

function tokenResponse(accessToken = 'access-1', refreshToken = 'refresh-2') {
  return Response.json({
    token_type: 'DPoP',
    access_token: accessToken,
    expires_in: 900,
    refresh_token: refreshToken,
    credential_id: 'credential-1',
  });
}

describe('OpenTu API origin and relay contract', () => {
  it.each([
    'https://api.example.com/path',
    'https://api.example.com?query=1',
    'https://user@api.example.com',
    '//api.example.com',
    'ftp://api.example.com',
  ])('rejects a DPoP target that is not an origin: %s', (value) => {
    expect(() => normalizeTuziDpopOrigin(value)).toThrow('HTTP(S) origin');
  });

  it('normalizes an exact configured origin', () => {
    expect(normalizeTuziDpopOrigin('http://127.0.0.1:5173/')).toBe(
      'http://127.0.0.1:5173'
    );
  });

  it.each([
    ['GET', '/v1/models'],
    ['POST', '/v1/chat/completions'],
    ['POST', '/images/generations'],
    ['POST', '/videos/video-1/remix'],
    ['GET', '/videos/task-1'],
  ])('allows the explicit %s %s relay route', (method, path) => {
    expect(isAllowedOpenTuRelayPath(path, method)).toBe(true);
  });

  it.each([
    ['DELETE', '/v1/models'],
    ['POST', '/v1/files'],
    ['POST', '/v1/realtime'],
    ['GET', '/v1/images/generations'],
    ['POST', '/v1/../api/token'],
    ['POST', '/v1/%2e%2e/api/token'],
  ])('rejects the unlisted %s %s relay route', (method, path) => {
    expect(isAllowedOpenTuRelayPath(path, method)).toBe(false);
  });

  it('maps an upstream v1 path without exposing its origin', () => {
    expect(toOpenTuRelayPath('/v1/images/generations?model=gpt', 'POST')).toBe(
      '/opentu/v1/images/generations?model=gpt'
    );
  });
});

describe('OpenTu API DPoP request lifecycle', () => {
  beforeEach(() => vi.stubGlobal('crypto', cryptoProvider));
  afterEach(() => vi.unstubAllGlobals());

  it('exchanges a parent grant with the generated key before persisting it', async () => {
    const idb = new IDBFactory();
    const vault = new OpenTuCredentialVault(idb, cryptoProvider);
    const session = new OpenTuCredentialSession(vault);
    const material = await generateCredentialKeyMaterial(cryptoProvider);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: 'use_dpop_nonce' },
          { status: 401, headers: { 'DPoP-Nonce': 'binding-nonce' } }
        )
      )
      .mockResolvedValueOnce(tokenResponse('bound-access', 'bound-refresh'));
    const client = new OpenTuApiClient({
      origin: 'http://127.0.0.1:5173',
      vault,
      session,
      fetcher,
      now: () => 1_700_000_000_000,
    });

    await expect(
      client.bindDeviceGrant({
        grantId: 'grant-1',
        deviceCode: 'device-code-1',
        publicJwk: material.publicJwk,
        privateKey: material.privateKey,
      })
    ).resolves.toMatchObject({
      credentialId: 'credential-1',
      accessToken: 'bound-access',
    });

    const retryHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(retryHeaders.get('Authorization')).toBeNull();
    expect(decodeJwtPayload(retryHeaders.get('DPoP') || '')).toMatchObject({
      nonce: 'binding-nonce',
      htm: 'POST',
      htu: 'http://127.0.0.1:5173/api/opentu/device-token',
    });
    expect(await vault.load()).toMatchObject({
      credentialId: 'credential-1',
      refreshToken: 'bound-refresh',
    });
    expect(session.getAccessToken(1_700_000_000_000)).toBe('bound-access');
  });

  it('retries each nonce challenge once and keeps access tokens proof-bound', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: 'use_dpop_nonce' },
          { status: 401, headers: { 'DPoP-Nonce': 'refresh-nonce' } }
        )
      )
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        Response.json(
          { error: 'use_dpop_nonce' },
          { status: 401, headers: { 'DPoP-Nonce': 'account-nonce' } }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 1,
          username: 'alice',
          display_name: 'Alice',
          email: 'alice@example.com',
          quota: 100,
          group: 'default',
          credential_id: 'credential-1',
        })
      );
    const { client } = await createCredentialClient(fetcher);

    await expect(client.getAccount()).resolves.toMatchObject({
      username: 'alice',
    });
    expect(fetcher).toHaveBeenCalledTimes(4);

    const refreshRetryHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    const accountRetryHeaders = new Headers(fetcher.mock.calls[3][1]?.headers);
    expect(refreshRetryHeaders.get('Authorization')).toBeNull();
    expect(decodeJwtPayload(refreshRetryHeaders.get('DPoP') || '').nonce).toBe(
      'refresh-nonce'
    );
    expect(accountRetryHeaders.get('Authorization')).toBe('DPoP access-1');
    expect(
      decodeJwtPayload(accountRetryHeaders.get('DPoP') || '')
    ).toMatchObject({
      nonce: 'account-nonce',
      htm: 'GET',
      htu: 'http://127.0.0.1:5173/api/opentu/account',
    });
    expect(decodeJwtPayload(accountRetryHeaders.get('DPoP') || '').ath).toEqual(
      expect.any(String)
    );
  });

  it('coalesces concurrent refreshes before sending both relay requests', async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/api/opentu/token')) {
        await refreshGate;
        return tokenResponse();
      }
      return Response.json({ ok: true });
    });
    const { client } = await createCredentialClient(fetcher);

    const first = client.relay('/v1/models');
    const second = client.relay('/v1/models');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    releaseRefresh();
    await Promise.all([first, second]);

    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/opentu/token')
      )
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('refreshes and retries the original request only once on invalid_token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: 'invalid_token' }, { status: 401 })
      )
      .mockResolvedValueOnce(tokenResponse('access-2', 'refresh-2'))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const { client } = await createCredentialClient(fetcher);
    client.setAccessToken('expired-access', 1_700_000_100_000);

    const response = await client.relay('/v1/models');
    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')
    ).toBe('DPoP expired-access');
    expect(
      new Headers(fetcher.mock.calls[2][1]?.headers).get('Authorization')
    ).toBe('DPoP access-2');
  });

  it('replaces client-supplied proof, authorization, cookie, and credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const { client } = await createCredentialClient(fetcher);

    await client.relay('/v1/models', {
      headers: {
        Authorization: 'Bearer must-not-survive',
        DPoP: 'must-not-survive',
        Cookie: 'secret=1',
      },
      credentials: 'include',
    });

    const relayInit = fetcher.mock.calls[1][1];
    const headers = new Headers(relayInit?.headers);
    expect(headers.get('Authorization')).toBe('DPoP access-1');
    expect(headers.get('DPoP')).not.toBe('must-not-survive');
    expect(headers.get('Cookie')).toBeNull();
    expect(relayInit?.credentials).toBe('omit');
  });

  it('uses the shared DPoP lifecycle for account workspace endpoints', async () => {
    const responses = [
      {
        success: true,
        data: {
          id: 1,
          username: 'alice',
          display_name: 'Alice',
          email: 'alice@example.com',
          quota: '100.50',
          group: 'default',
          credential_id: 'credential-1',
        },
      },
      {
        success: true,
        data: [{ model_name: 'model-1', future_model_field: true }],
        pricing_version: 7,
        future_pricing_field: { enabled: true },
      },
      {
        success: true,
        data: {
          page: 2,
          page_size: 10,
          total: 1,
          items: [{ id: 9, created_at: 123, request_id: 'request-9' }],
        },
      },
      { success: true, data: { quota: 99, rpm: 2, tpm: 3 } },
      {
        success: true,
        data: { page: 1, page_size: 20, total: 0, items: [] },
      },
      { success: true, data: { enabled: true, entry_url: '/console/topup' } },
      {
        success: true,
        data: [
          {
            id: 4,
            credential_id: 'credential-1',
            name: 'Safari',
            status: 'active',
          },
        ],
      },
      { success: true, data: { id: 4, status: 'revoked' } },
    ];
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(responses.shift())
    );
    const { client } = await createCredentialClient(fetcher);
    client.setAccessToken('active-access', 1_700_000_100_000);

    await expect(client.getAccount()).resolves.toMatchObject({
      quota: '100.50',
    });
    await expect(client.getPricing()).resolves.toMatchObject({
      pricing_version: 7,
      future_pricing_field: { enabled: true },
      models: [{ model_name: 'model-1', future_model_field: true }],
    });
    await expect(
      client.getUsage({ page: 2, pageSize: 10, modelName: 'model-1' })
    ).resolves.toMatchObject({ total: 1 });
    await expect(client.getUsageSummary()).resolves.toMatchObject({ rpm: 2 });
    await expect(client.getTopups()).resolves.toMatchObject({ items: [] });
    await expect(client.getTopupInfo()).resolves.toMatchObject({
      enabled: true,
    });
    await expect(client.getDevices()).resolves.toHaveLength(1);
    await expect(client.revokeDevice(4)).resolves.toEqual({
      id: 4,
      status: 'revoked',
    });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:5173/api/opentu/account',
      'http://127.0.0.1:5173/api/opentu/pricing',
      'http://127.0.0.1:5173/api/opentu/usage?page=2&page_size=10&model_name=model-1',
      'http://127.0.0.1:5173/api/opentu/usage/summary',
      'http://127.0.0.1:5173/api/opentu/topups',
      'http://127.0.0.1:5173/api/opentu/topup/info',
      'http://127.0.0.1:5173/api/opentu/account/devices',
      'http://127.0.0.1:5173/api/opentu/account/devices/4/revoke',
    ]);
    expect(fetcher.mock.calls[7][1]?.method).toBe('POST');
    fetcher.mock.calls.forEach(([, init]) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'DPoP active-access'
      );
      expect(new Headers(init?.headers).get('DPoP')).toBeTruthy();
    });
  });

  it('ensures and rotates managed provider groups without leaking keys into URLs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: {
            groups: [
              {
                group: 'gemini/mix',
                display_name: 'Gemini Mix',
                api_key: 'secret-1',
                base_url: 'https://api.tu-zi.com/v1',
                status: 'active',
                token_id: 11,
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: {
            group: 'gemini/mix',
            display_name: 'Gemini Mix',
            api_key: 'secret-2',
            base_url: 'https://api.tu-zi.com/v1',
            status: 'active',
            token_id: 12,
          },
        })
      );
    const { client } = await createCredentialClient(fetcher);
    client.setAccessToken('active-access', 1_700_000_100_000);

    await expect(
      client.ensureManagedProviderGroups('ensure-1')
    ).resolves.toEqual([expect.objectContaining({ api_key: 'secret-1' })]);
    await expect(
      client.rotateManagedProviderGroup('gemini/mix', 'rotate-1')
    ).resolves.toMatchObject({ api_key: 'secret-2', token_id: 12 });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:5173/api/opentu/managed-keys/ensure',
      'http://127.0.0.1:5173/api/opentu/managed-keys/gemini%2Fmix/rotate',
    ]);
    expect(
      fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    ).toEqual([
      { idempotency_key: 'ensure-1' },
      { idempotency_key: 'rotate-1' },
    ]);
  });

  it('uses DPoP JSON requests for the topup order lifecycle', async () => {
    const responses = [
      {
        message: 'success',
        data: {
          amount: 100,
          base_amount: 98,
          fee: 2,
          total_amount: 100,
          currency: 'CNY',
          fixed_fee: 1,
          percent_fee: 0.01,
          discount: 1,
          topup_group_ratio: 1,
        },
      },
      {
        success: true,
        message: '',
        data: 'https://payment.example/order-1',
        payment_url: 'https://payment.example/order-1',
        trade_no: 'trade-1',
        display_mode: 'redirect',
      },
      {
        success: true,
        message: '',
        data: { status: 'pending', message: 'Waiting for payment' },
      },
    ];
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(responses.shift())
    );
    const { client } = await createCredentialClient(fetcher);
    client.setAccessToken('active-access', 1_700_000_100_000);

    await expect(
      client.estimateTopup({ gateway_id: 3, amount: 100 })
    ).resolves.toMatchObject({ fee: 2, currency: 'CNY' });
    await expect(
      client.createTopup({ gateway_id: 3, amount: 100 }, 'topup-idempotency-1')
    ).resolves.toMatchObject({
      trade_no: 'trade-1',
      payment_url: 'https://payment.example/order-1',
      display_mode: 'redirect',
    });
    await expect(client.queryTopup({ trade_no: 'trade-1' })).resolves.toEqual({
      status: 'pending',
      message: 'Waiting for payment',
    });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:5173/api/opentu/topup/quote',
      'http://127.0.0.1:5173/api/opentu/topup/orders',
      'http://127.0.0.1:5173/api/opentu/topup/orders/query',
    ]);
    fetcher.mock.calls.forEach(([, init]) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe('POST');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Authorization')).toBe('DPoP active-access');
      expect(headers.get('DPoP')).toBeTruthy();
      expect(headers.get('Idempotency-Key')).toBeNull();
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      gateway_id: 3,
      amount: 100,
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      gateway_id: 3,
      amount: 100,
      idempotency_key: 'topup-idempotency-1',
    });
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
      trade_no: 'trade-1',
    });
  });

  it('accepts a completed topup that does not require a payment URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        data: { trade_no: 'trade-complete', completed: true },
      })
    );
    const { client } = await createCredentialClient(fetcher);
    client.setAccessToken('active-access', 1_700_000_100_000);

    await expect(
      client.createTopup(
        { gateway_id: 3, amount: 100 },
        'topup-idempotency-complete'
      )
    ).resolves.toMatchObject({
      trade_no: 'trade-complete',
      payment_url: '',
      completed: true,
    });
  });

  it('accepts a QR-only topup order without a payment URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        trade_no: 'trade-qr-only',
        qrcode_content: 'https://pay.example/qr-only',
        display_mode: 'qrcode',
      })
    );
    const { client } = await createCredentialClient(fetcher);
    client.setAccessToken('active-access', 1_700_000_100_000);

    await expect(
      client.createTopup(
        { gateway_id: 7, amount: 50 },
        'topup-idempotency-qr-only'
      )
    ).resolves.toMatchObject({
      trade_no: 'trade-qr-only',
      qrcode_content: 'https://pay.example/qr-only',
      display_mode: 'qrcode',
    });
  });

  it('rejects HTTP 200 business failures with their server message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: false,
        message: 'insufficient_quota',
      })
    );
    const { client } = await createCredentialClient(fetcher);
    client.setAccessToken('active-access', 1_700_000_100_000);

    await expect(client.getUsageSummary()).rejects.toMatchObject({
      name: 'OpenTuApiResponseError',
      status: 200,
      errorDescription: 'insufficient_quota',
    } satisfies Partial<OpenTuApiResponseError>);
  });
});

describe('provider DPoP routing', () => {
  const context = {
    profileId: 'tuzi-origin',
    profileName: 'Tuzi',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.tu-zi.com/v1',
    apiKey: 'legacy-secret',
    authType: 'bearer',
  } as const;

  it('uses the direct DPoP relay when a bound session exists', async () => {
    const relay = vi.fn(async () => Response.json({ ok: true }));
    const transport = new ProviderTransport(() => ({
      hasCredential: async () => true,
      relay,
    }));
    const legacyFetcher = vi.fn<typeof fetch>();

    await transport.send(context, {
      path: '/images/generations',
      method: 'POST',
      query: { response_format: 'url' },
      body: '{}',
      requestId: 'image-request-1',
      fetcher: legacyFetcher,
    });

    expect(relay).toHaveBeenCalledWith(
      '/v1/images/generations?response_format=url',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        headers: expect.objectContaining({ 'X-Request-Id': 'image-request-1' }),
      })
    );
    expect(legacyFetcher).not.toHaveBeenCalled();
  });

  it('keeps a managed Tuzi profile on the prepared direct transport', async () => {
    const hasCredential = vi.fn(async () => true);
    const relay = vi.fn(async () => Response.json({ ok: true }));
    const transport = new ProviderTransport(() => ({ hasCredential, relay }));
    const directFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));

    await transport.send(
      { ...context, managedBy: 'tuzi' },
      {
        path: '/images/generations',
        method: 'POST',
        body: '{}',
        fetcher: directFetcher,
      }
    );

    expect(hasCredential).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
    expect(directFetcher).toHaveBeenCalledWith(
      expect.stringContaining('/v1/images/generations'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer legacy-secret',
        }),
      })
    );
  });

  it('keeps an unlisted provider route on the legacy transport', async () => {
    const hasCredential = vi.fn(async () => true);
    const transport = new ProviderTransport(() => ({
      hasCredential,
      relay: vi.fn(),
    }));
    const legacyFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));

    await transport.send(context, {
      path: '/files',
      method: 'POST',
      fetcher: legacyFetcher,
    });

    expect(hasCredential).not.toHaveBeenCalled();
    expect(legacyFetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps URL-token mode isolated from a bound DPoP session', async () => {
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:7200/?tuzi_api_key=sk-url-only' },
    });
    const hasCredential = vi.fn(async () => true);
    const transport = new ProviderTransport(() => ({
      hasCredential,
      relay: vi.fn(),
    }));
    const legacyFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    await transport.send(context, {
      path: '/models',
      method: 'GET',
      fetcher: legacyFetcher,
    });
    vi.unstubAllGlobals();

    expect(hasCredential).not.toHaveBeenCalled();
    expect(legacyFetcher).toHaveBeenCalledTimes(1);
  });
});
