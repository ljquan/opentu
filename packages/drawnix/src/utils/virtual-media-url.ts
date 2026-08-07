export const ASSET_LIBRARY_URL_PREFIX = '/asset-library/';
export const CACHE_URL_PREFIX = '/__aitu_cache__/';
export const AI_GENERATED_URL_PREFIX = '/__aitu_generated__/';
export const AI_GENERATED_AUDIO_URL_PREFIX = `${AI_GENERATED_URL_PREFIX}audio/`;

type Ipv4Parts = [number, number, number, number];

function parseIpv4Address(hostname: string): Ipv4Parts | null {
  const rawParts = hostname.split('.');
  const parts = rawParts.map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      (part, index) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255 ||
        String(part) !== rawParts[index]
    )
  ) {
    return null;
  }

  return parts as Ipv4Parts;
}

function isNonPublicIpv4Parts(parts: Ipv4Parts): boolean {
  const [first, second, third] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 &&
      second === 0 &&
      third === 0 &&
      parts[3] !== 9 &&
      parts[3] !== 10) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isNonPublicIpv4Address(hostname: string): boolean {
  const parts = parseIpv4Address(hostname);
  return parts ? isNonPublicIpv4Parts(parts) : false;
}

function parseIpv6Address(hostname: string): number[] | null {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const groups = half.split(':');
    const values = groups.map((group) => Number.parseInt(group, 16));
    return groups.some(
      (group, index) =>
        !/^[0-9a-f]{1,4}$/.test(group) || !Number.isInteger(values[index])
    )
      ? null
      : values;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || '');
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;

  const omittedCount = 8 - left.length - right.length;
  return omittedCount >= 1
    ? [...left, ...Array<number>(omittedCount).fill(0), ...right]
    : null;
}

function isGloballyReachable2001ProtocolAddress(parts: number[]): boolean {
  const [, second, third, fourth, fifth, sixth, seventh, eighth] = parts;
  const isProtocolAnycast =
    second === 1 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0 &&
    seventh === 0 &&
    (eighth === 1 || eighth === 2 || eighth === 3);
  return (
    isProtocolAnycast ||
    second === 3 ||
    (second === 4 && third === 0x0112) ||
    (second & 0xfff0) === 0x0020 ||
    (second & 0xfff0) === 0x0030
  );
}

function isNonPublicIpv6Address(hostname: string): boolean {
  const parts = parseIpv6Address(hostname);
  if (!parts) return false;

  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return true;
  }

  const [first, second, third, fourth] = parts;
  return (
    first === 0 ||
    (first === 0x0064 && second === 0xff9b && third === 1) ||
    (first === 0x0100 && second === 0 && third === 0 && fourth === 0) ||
    (first === 0x0100 && second === 0 && third === 0 && fourth === 1) ||
    (first === 0x2001 &&
      second <= 0x01ff &&
      !isGloballyReachable2001ProtocolAddress(parts)) ||
    (first === 0x2001 && second === 0x0db8) ||
    first === 0x5f00 ||
    (first === 0x3fff && (second & 0xf000) === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

function isNonPublicMediaHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isNonPublicIpv4Address(normalized) ||
    isNonPublicIpv6Address(normalized)
  );
}

export function isPublicHttpMediaUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  try {
    const url = new URL(normalized);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !isNonPublicMediaHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

export function normalizeVirtualMediaUrl(url: string): string {
  if (!url) return url;

  try {
    const parsed = new URL(url, 'http://aitu.local');
    return parsed.pathname;
  } catch {
    return url;
  }
}

export function isAssetLibraryUrl(url: string): boolean {
  return normalizeVirtualMediaUrl(url).startsWith(ASSET_LIBRARY_URL_PREFIX);
}

export function isLegacyCacheUrl(url: string): boolean {
  return normalizeVirtualMediaUrl(url).startsWith(CACHE_URL_PREFIX);
}

export function isAIGeneratedAudioUrl(url: string): boolean {
  return normalizeVirtualMediaUrl(url).startsWith(
    AI_GENERATED_AUDIO_URL_PREFIX
  );
}

export function isAIGeneratedVirtualUrl(url: string): boolean {
  return isAIGeneratedAudioUrl(url);
}

export function isVirtualMediaUrl(url: string): boolean {
  return (
    isAssetLibraryUrl(url) ||
    isLegacyCacheUrl(url) ||
    isAIGeneratedVirtualUrl(url)
  );
}
