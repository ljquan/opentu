import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import * as ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';
import { GenerationGatewayError } from './generation/errors';

export const BLOCKED_PROVIDER_HEADER =
  /^(?:authorization|cookie|host|content-length|connection|transfer-encoding|upgrade|proxy-|sec-|x-forwarded-)/i;

function unsafeEndpoint(): never {
  throw new GenerationGatewayError(
    400,
    'UNSAFE_PROVIDER_ENDPOINT',
    '供应商地址未通过安全校验，不允许连接内网或保留地址'
  );
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

export function assertProviderUrl(url: URL): void {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.username || url.password || url.hash) unsafeEndpoint();
  const developmentLoopback =
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (developmentLoopback && url.protocol === 'http:') return;
  if (
    url.protocol !== 'https:' ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    unsafeEndpoint();
}

async function boundedLookup(
  hostname: string,
  signal?: AbortSignal | null
): Promise<LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    return await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new DOMException('DNS lookup timed out', 'TimeoutError')),
          5000
        );
        onAbort = () => reject(signal?.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export async function resolveProviderAddresses(
  url: URL,
  signal?: AbortSignal | null
): Promise<LookupAddress[]> {
  assertProviderUrl(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await boundedLookup(hostname, signal);
  const developmentLoopback =
    process.env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) =>
        !isPublicAddress(address) &&
        !(developmentLoopback && ['127.0.0.1', '::1'].includes(address))
    )
  )
    unsafeEndpoint();
  return addresses;
}

export async function withProviderResponse<T>(
  url: URL,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  fetcher?: typeof fetch
): Promise<T> {
  const addresses = await resolveProviderAddresses(url, init.signal);
  // Keep TLS hostname verification, but never resolve the hostname a second time.
  const dispatcher = new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if ((options as { all?: boolean }).all) {
          (
            callback as unknown as (
              error: null,
              result: LookupAddress[]
            ) => void
          )(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
    },
  });
  try {
    const options = { ...init, redirect: 'error' as const, dispatcher };
    const response = fetcher
      ? await fetcher(url.toString(), options)
      : await undiciFetch(
          url.toString(),
          options as Parameters<typeof undiciFetch>[1]
        );
    return await consume(response as unknown as Response);
  } finally {
    await dispatcher.destroy();
  }
}
