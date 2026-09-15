import { describe, expect, it, vi } from 'vitest';

describe('tuzi-api-endpoints', () => {
  it('只把内置 tuzi-api 上游 origin 视为可信', async () => {
    vi.resetModules();

    const { isTrustedTuziApiBaseUrl, isTuziCompatibleBaseUrl } = await import(
      '../provider-routing/tuzi-api-endpoints'
    );

    expect(isTrustedTuziApiBaseUrl('https://api.tu-zi.com/v1')).toBe(true);
    expect(isTrustedTuziApiBaseUrl('https://apisz.ourzhishi.top/v1')).toBe(
      true
    );
    expect(isTrustedTuziApiBaseUrl('https://api.openai.com/v1')).toBe(false);
    expect(isTrustedTuziApiBaseUrl('https://evil.tu-zi.com/v1')).toBe(false);
    expect(isTuziCompatibleBaseUrl('https://api.sydney-ai.com/v1')).toBe(true);
    expect(isTuziCompatibleBaseUrl('https://api.ourzhishi.top/v1')).toBe(true);
    expect(isTuziCompatibleBaseUrl('https://apisz.ourzhishi.top/v1')).toBe(
      true
    );
    expect(isTuziCompatibleBaseUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('解析 tuzi-api 状态接口中的站点列表，并过滤非上游站点', async () => {
    vi.resetModules();

    const { parseTuziApiAddressList, TUZI_API_FALLBACK_ENDPOINTS } =
      await import('../provider-routing/tuzi-api-endpoints');

    const endpoints = parseTuziApiAddressList([
      {
        name: '主站点',
        url: 'https://api.tu-zi.com/v1',
        description: '主站点',
      },
      {
        name: '不可信站点',
        url: 'https://example.com',
        description: '应被过滤',
      },
      {
        url: 'https://apisz.ourzhishi.top/',
      },
    ]);

    expect(endpoints).toEqual([
      {
        name: '主站点',
        url: 'https://api.tu-zi.com',
        description: '主站点',
      },
      {
        name: '深圳地址（无前端）',
        url: 'https://apisz.ourzhishi.top',
        description: '深圳地址',
      },
    ]);
    expect(endpoints.length).toBeLessThan(TUZI_API_FALLBACK_ENDPOINTS.length);
  });

  it('获取站点来源失败时，baseUrl 列表回退到内置 tuzi-api 站点', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    const { loadTuziApiEndpointBaseUrls, TUZI_API_FALLBACK_ENDPOINTS } =
      await import('../provider-routing/tuzi-api-endpoints');

    await expect(loadTuziApiEndpointBaseUrls()).resolves.toEqual(
      TUZI_API_FALLBACK_ENDPOINTS.map((endpoint) =>
        endpoint.url.replace(/\/+$/, '')
      )
    );
  });

  it('只把显式配置的本地 API 作为直连恢复节点', async () => {
    vi.resetModules();
    vi.doMock('../tuzi-embedded-config', () => ({
      tuziEmbeddedConfig: {
        enabled: true,
        apiBaseUrl: 'http://192.168.50.225:18180',
        parentOrigin: null,
      },
    }));

    try {
      const {
        isConfiguredTuziApiBaseUrl,
        isTrustedTuziApiBaseUrl,
        isTuziRequestRecoveryBaseUrl,
      } = await import('../provider-routing/tuzi-api-endpoints');

      expect(isConfiguredTuziApiBaseUrl('http://192.168.50.225:18180/v1')).toBe(
        true
      );
      expect(
        isTuziRequestRecoveryBaseUrl('http://192.168.50.225:18180/v1')
      ).toBe(true);
      expect(isTrustedTuziApiBaseUrl('http://192.168.50.225:18180/v1')).toBe(
        false
      );
      expect(
        isTuziRequestRecoveryBaseUrl('http://192.168.50.226:18180/v1')
      ).toBe(false);
    } finally {
      vi.doUnmock('../tuzi-embedded-config');
    }
  });
});
