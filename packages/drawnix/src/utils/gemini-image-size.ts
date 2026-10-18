export type GeminiImageQuality = '1k' | '2k' | '4k';

const GEMINI_IMAGE_SIZE_PRESETS: Record<
  GeminiImageQuality,
  Record<string, string>
> = {
  '1k': {
    '1:1': '1024x1024',
    '2:3': '1024x1536',
    '3:2': '1536x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '16:9': '1536x864',
    '9:16': '864x1536',
    '21:9': '2016x864',
    '9:21': '864x2016',
  },
  '2k': {
    '1:1': '2048x2048',
    '2:3': '1360x2048',
    '3:2': '2048x1360',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '21:9': '2688x1152',
    '9:21': '1152x2688',
  },
  '4k': {
    // Tuzi classifies the upstream tier from size; use the full 4K square.
    '1:1': '4096x4096',
    '2:3': '2336x3520',
    '3:2': '3520x2336',
    '4:3': '3312x2480',
    '3:4': '2480x3312',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '21:9': '3840x1648',
    '9:21': '1648x3840',
  },
};

export function isGeminiImageModel(model?: string): boolean {
  return /gemini|nano[-_]?banana/i.test(model || '');
}

export function inferGeminiImageQuality(
  model?: string
): GeminiImageQuality | undefined {
  if (!isGeminiImageModel(model)) return undefined;
  const tier = model?.trim().match(/(?:-|_)(1k|2k|4k)(?:-|_|$)/i)?.[1];
  return tier?.toLowerCase() as GeminiImageQuality | undefined;
}

function normalizeAspectRatio(size: string): string | undefined {
  const normalized = size.trim().toLowerCase().replace('x', ':');
  if (normalized === 'auto' || !normalized.includes(':')) return undefined;
  const [width, height] = normalized.split(':').map(Number);
  if (!width || !height) return undefined;
  const gcd = (a: number, b: number): number =>
    b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/**
 * Convert a Gemini/Nano Banana ratio or 1K pixel size to the selected tier's
 * pixel dimensions for OpenAI-compatible image generation endpoints.
 */
export function resolveGeminiImageRequestSize(
  size: string | undefined,
  quality: GeminiImageQuality | undefined,
  model?: string
): string | undefined {
  if (!size || size.trim().toLowerCase() === 'auto') return undefined;
  if (!quality || !isGeminiImageModel(model)) return size;

  const ratio = normalizeAspectRatio(size);
  if (!ratio) return size;
  return GEMINI_IMAGE_SIZE_PRESETS[quality][ratio] || size;
}
