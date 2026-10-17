import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import {
  isPublicAddress,
  resolveProviderAddresses,
  withProviderResponse,
} from './provider-transport';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('provider network boundary', () => {
  it('bounds a stalled DNS lookup without sending a request', async () => {
    vi.useFakeTimers();
    vi.mocked(lookup).mockReturnValue(new Promise(() => undefined));
    const fetcher = vi.fn();
    const result = withProviderResponse(
      new URL('https://provider.example'),
      {},
      async (r) => r.text(),
      fetcher
    );
    const rejected = expect(result).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('honors cancellation during DNS resolution', async () => {
    vi.mocked(lookup).mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const result = resolveProviderAddresses(
      new URL('https://provider.example'),
      controller.signal
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.168.1.1',
    '198.18.0.1',
    '192.0.2.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:7f00:1',
    '2001:db8::1',
    'ff02::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('accepts ordinary public IPv4 and IPv6 addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects a hostname when any DNS result is private', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(lookup).mockImplementation(
      async () =>
        [
          { address: '8.8.8.8', family: 4 },
          { address: '169.254.169.254', family: 4 },
        ] as never
    );
    const fetcher = vi.fn();
    await expect(
      withProviderResponse(
        new URL('https://provider.example'),
        {},
        async (r) => r.text(),
        fetcher
      )
    ).rejects.toMatchObject({ code: 'UNSAFE_PROVIDER_ENDPOINT' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects loopback in production, including encoded IPv4', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const url of [
      'http://localhost',
      'https://2130706433',
      'https://[::ffff:7f00:1]',
    ]) {
      await expect(
        resolveProviderAddresses(new URL(url))
      ).rejects.toMatchObject({ code: 'UNSAFE_PROVIDER_ENDPOINT' });
    }
  });

  it('uses only the validated address for the actual connection', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.mocked(lookup).mockImplementation(
      async () => [{ address: '127.0.0.1', family: 4 }] as never
    );
    const server = createServer((_req, res) => res.end('pinned'));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    try {
      const port = (server.address() as { port: number }).port;
      expect(
        await withProviderResponse(
          new URL(`http://localhost:${port}`),
          { signal: AbortSignal.timeout(2000) },
          async (r) => r.text()
        )
      ).toBe('pinned');
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
