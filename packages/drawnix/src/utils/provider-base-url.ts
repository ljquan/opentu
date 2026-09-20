export const DEFAULT_MODEL_API_BASE_URL = 'https://api.tu-zi.com/v1';

function normalizeTuziScheme(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === 'http:' &&
      (hostname === 'tu-zi.com' || hostname.endsWith('.tu-zi.com'))
    ) {
      parsed.protocol = 'https:';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    // Keep the existing string normalization for incomplete custom URLs.
  }
  return baseUrl;
}

export function normalizeModelApiBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim();
  if (!trimmed) return DEFAULT_MODEL_API_BASE_URL;

  let normalized = normalizeTuziScheme(trimmed.replace(/\/+$/, ''));
  normalized = normalized.replace(/\/models$/i, '');
  if (!/\/v1$/i.test(normalized)) {
    normalized = `${normalized}/v1`;
  }
  return normalized;
}
