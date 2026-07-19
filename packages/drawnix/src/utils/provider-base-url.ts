export const DEFAULT_MODEL_API_BASE_URL = 'https://api.tu-zi.com/v1';

export function normalizeModelApiBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim();
  if (!trimmed) return DEFAULT_MODEL_API_BASE_URL;

  let normalized = trimmed.replace(/\/+$/, '');
  normalized = normalized.replace(/\/models$/i, '');
  if (!/\/v1$/i.test(normalized)) {
    normalized = `${normalized}/v1`;
  }
  return normalized;
}
