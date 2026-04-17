const IMAGE_TITLE_META_PREFIX = 'opentu-image:';

export interface MarkdownImageTitleMeta {
  caption: string;
  width?: number;
  height?: number;
}

export interface ParsedMarkdownImageAlt {
  assetType: string | null;
  label: string;
  rawAlt: string;
  isAssetAlt: boolean;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function buildMarkdownImageTitle(meta: {
  width?: number | null;
  height?: number | null;
  caption?: string | null;
}): string | undefined {
  const width = parsePositiveInteger(meta.width == null ? null : String(meta.width));
  const height = parsePositiveInteger(meta.height == null ? null : String(meta.height));
  const caption = (meta.caption || '').trim();

  if (!width && !height) {
    return caption || undefined;
  }

  const params = new URLSearchParams();
  if (width) {
    params.set('w', String(width));
  }
  if (height) {
    params.set('h', String(height));
  }
  if (caption) {
    params.set('caption', caption);
  }

  return `${IMAGE_TITLE_META_PREFIX}${params.toString()}`;
}

export function parseMarkdownImageTitle(title?: string | null): MarkdownImageTitleMeta {
  const normalized = (title || '').trim();

  if (!normalized) {
    return { caption: '', width: undefined, height: undefined };
  }

  if (!normalized.startsWith(IMAGE_TITLE_META_PREFIX)) {
    return { caption: normalized, width: undefined, height: undefined };
  }

  const params = new URLSearchParams(normalized.slice(IMAGE_TITLE_META_PREFIX.length));
  return {
    caption: params.get('caption') || '',
    width: parsePositiveInteger(params.get('w')),
    height: parsePositiveInteger(params.get('h')),
  };
}

export function parseMarkdownImageAlt(rawAlt?: string | null): ParsedMarkdownImageAlt {
  const normalized = (rawAlt || '').trim();
  const pipeIndex = normalized.indexOf('|');

  if (pipeIndex <= 0) {
    return {
      assetType: null,
      label: normalized,
      rawAlt: normalized,
      isAssetAlt: false,
    };
  }

  const assetType = normalized.slice(0, pipeIndex).trim();
  const label = normalized.slice(pipeIndex + 1).trim();

  if (!assetType || !label) {
    return {
      assetType: null,
      label: normalized,
      rawAlt: normalized,
      isAssetAlt: false,
    };
  }

  return {
    assetType,
    label,
    rawAlt: normalized,
    isAssetAlt: true,
  };
}

export function isNumericImageRatioAlt(rawAlt?: string | null): boolean {
  const normalized = (rawAlt || '').trim();
  return /^-?\d+(?:\.\d+)?$/.test(normalized);
}
