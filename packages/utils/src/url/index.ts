/**
 * URL Utilities
 *
 * Pure functions for URL parsing, domain checking, and file extension detection.
 * All functions are framework-agnostic with zero external dependencies.
 */

const BASE64_IMAGE_SIGNATURES: Array<{ prefix: string; mimeType: string }> = [
  { prefix: 'iVBORw0KGgo', mimeType: 'image/png' },
  { prefix: '/9j/', mimeType: 'image/jpeg' },
  { prefix: 'R0lGOD', mimeType: 'image/gif' },
  { prefix: 'UklGR', mimeType: 'image/webp' },
  { prefix: 'Qk', mimeType: 'image/bmp' },
  { prefix: 'PHN2Zy', mimeType: 'image/svg+xml' },
  { prefix: 'PD94bWwg', mimeType: 'image/svg+xml' },
  { prefix: 'AAAAIGZ0eXBhdmlm', mimeType: 'image/avif' },
  { prefix: 'AAAAGGZ0eXBhdmlm', mimeType: 'image/avif' },
  { prefix: 'AAABAA', mimeType: 'image/x-icon' },
];

const BASE64_IMAGE_BODY_REGEX = /^[A-Za-z0-9+/=\r\n]+$/;

function sanitizeBase64Payload(base64: string): string {
  return base64.trim().replace(/\s+/g, '');
}

/**
 * Infer image MIME type from a raw base64 payload using common file signatures.
 *
 * @param base64 - Raw base64 payload without a data URL prefix
 * @returns MIME type when the payload looks like a known image format
 */
export function inferImageMimeTypeFromBase64(base64: string): string | undefined {
  const normalized = sanitizeBase64Payload(base64);
  if (!normalized) {
    return undefined;
  }

  const match = BASE64_IMAGE_SIGNATURES.find(({ prefix }) =>
    normalized.startsWith(prefix)
  );

  return match?.mimeType;
}

/**
 * Normalize a possible raw base64 image payload into a data URL.
 *
 * Existing URLs/data URLs are returned unchanged. This is intended for
 * call sites that already expect an image source.
 *
 * @param value - Image URL, data URL, or raw base64 payload
 * @param fallbackMimeType - MIME type used when signature sniffing is inconclusive
 * @returns A stable image source string that browsers can render
 */
export function normalizeImageDataUrl(
  value: string,
  fallbackMimeType = 'image/png'
): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed;
  }

  const normalized = sanitizeBase64Payload(trimmed);
  if (!BASE64_IMAGE_BODY_REGEX.test(normalized) || normalized.length < 32) {
    return trimmed;
  }

  const mimeType = inferImageMimeTypeFromBase64(normalized) || fallbackMimeType;
  return `data:${mimeType};base64,${normalized}`;
}

/**
 * Check if a URL belongs to a specific domain or domain pattern
 *
 * Generic utility that can check if a URL's hostname ends with specified suffixes.
 * Useful for identifying URLs from specific CDNs, cloud providers, or services.
 *
 * @param url - URL string to check
 * @param domainSuffixes - Array of domain suffixes to match (e.g., ['.example.com', '.cdn.example.com'])
 * @returns True if the URL's hostname ends with any of the specified suffixes
 *
 * @example
 * ```typescript
 * // Check if URL is from Cloudflare CDN
 * isDomainMatch('https://example.cloudflare.com/image.jpg', ['.cloudflare.com']);
 * // true
 *
 * // Check if URL is from Volces (火山引擎)
 * isDomainMatch('https://cdn.volces.com/file.mp4', ['.volces.com', '.volccdn.com']);
 * // true
 *
 * // Invalid URLs return false
 * isDomainMatch('not-a-url', ['.example.com']);
 * // false
 * ```
 */
export function isDomainMatch(url: string, domainSuffixes: string[]): boolean {
  try {
    const hostname = new URL(url).hostname;
    return domainSuffixes.some(suffix => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

/**
 * Check if a URL is from Volces (火山引擎) domains
 *
 * Convenience wrapper around isDomainMatch for Volces-specific domains.
 * These domains don't support CORS, so they require special handling.
 *
 * @param url - URL string to check
 * @returns True if the URL is from Volces domains (.volces.com or .volccdn.com)
 *
 * @example
 * ```typescript
 * isVolcesDomain('https://cdn.volces.com/video.mp4');
 * // true
 *
 * isVolcesDomain('https://example.volccdn.com/image.jpg');
 * // true
 *
 * isVolcesDomain('https://other-cdn.com/file.pdf');
 * // false
 * ```
 */
export function isVolcesDomain(url: string): boolean {
  return isDomainMatch(url, ['.volces.com', '.volccdn.com']);
}

/**
 * Extract file extension from URL or MIME type
 *
 * Attempts to determine the file extension using multiple strategies:
 * 1. Extract from URL path (e.g., "/path/file.jpg" → "jpg")
 * 2. Parse data URLs for embedded MIME type
 * 3. Fallback to provided MIME type mapping
 *
 * @param url - URL string or data URL
 * @param mimeType - Optional MIME type for fallback (e.g., "image/jpeg")
 * @returns File extension (lowercase, without dot) or "bin" if undetermined
 *
 * @example
 * ```typescript
 * // From URL path
 * getFileExtension('https://example.com/image.jpg');
 * // "jpg"
 *
 * // From data URL
 * getFileExtension('data:image/svg+xml;base64,PHN2Zy...');
 * // "svg"
 *
 * // From MIME type fallback
 * getFileExtension('https://api.example.com/download/123', 'video/mp4');
 * // "mp4"
 *
 * // Unknown format
 * getFileExtension('https://example.com/file');
 * // "bin"
 * ```
 */
export function getFileExtension(url: string, mimeType?: string): string {
  // Only attempt base64 sniffing on strings long enough to be real payloads,
  // avoiding false positives on short relative paths (e.g. "/9j/file.txt")
  if (url.length >= 20) {
    const inferredBase64MimeType = inferImageMimeTypeFromBase64(url);
    if (inferredBase64MimeType) {
      mimeType = mimeType || inferredBase64MimeType;
    }
  }

  // Try to get extension from URL path
  // Support both absolute URLs and relative paths (e.g., /__aitu_cache__/image/xxx.png)
  try {
    let urlPath: string;
    
    // For relative paths, use the URL directly
    if (url.startsWith('/') || !url.includes('://')) {
      urlPath = url;
    } else {
      urlPath = new URL(url).pathname;
    }
    
    const lastDotIndex = urlPath.lastIndexOf('.');

    // Check if there's a dot and it's not at the start or end
    if (lastDotIndex > 0 && lastDotIndex < urlPath.length - 1) {
      const urlExtension = urlPath.substring(lastDotIndex + 1).toLowerCase();

      // Only accept valid extensions (max 5 chars, no slashes)
      if (urlExtension && urlExtension.length <= 5 && !urlExtension.includes('/')) {
        return urlExtension;
      }
    }
  } catch {
    // URL parsing failed
  }

  // Handle base64 data URLs
  if (url.startsWith('data:')) {
    // Special handling for SVG (data:image/svg+xml)
    if (url.startsWith('data:image/svg+xml')) {
      return 'svg';
    }
    const match = url.match(/data:(\w+)\/(\w+)/);
    if (match) {
      return match[2] === 'jpeg' ? 'jpg' : match[2];
    }
  }

  // Fallback to MIME type
  if (mimeType) {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
    };
    return mimeToExt[mimeType] || 'bin';
  }

  return 'bin';
}

/**
 * Extract hostname from URL
 *
 * Safely extracts the hostname from a URL string.
 *
 * @param url - URL string to parse
 * @returns Hostname or empty string if invalid URL
 *
 * @example
 * ```typescript
 * getHostname('https://www.example.com/path');
 * // "www.example.com"
 *
 * getHostname('invalid-url');
 * // ""
 * ```
 */
export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Check if URL is a data URL
 *
 * @param url - URL string to check
 * @returns True if URL starts with "data:"
 *
 * @example
 * ```typescript
 * isDataURL('data:image/png;base64,iVBORw...');
 * // true
 *
 * isDataURL('https://example.com/image.jpg');
 * // false
 * ```
 */
export function isDataURL(url: string): boolean {
  return url.startsWith('data:');
}

/**
 * Check if URL is absolute (has protocol)
 *
 * @param url - URL string to check
 * @returns True if URL has a protocol (http://, https://, etc.)
 *
 * @example
 * ```typescript
 * isAbsoluteURL('https://example.com/path');
 * // true
 *
 * isAbsoluteURL('/relative/path');
 * // false
 *
 * isAbsoluteURL('//example.com/path');
 * // false
 * ```
 */
export function isAbsoluteURL(url: string): boolean {
  try {
    const parsedURL = new URL(url);
    return !!parsedURL.protocol;
  } catch {
    return false;
  }
}
