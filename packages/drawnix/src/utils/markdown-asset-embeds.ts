import type { Asset } from '../types/asset.types';
import { AssetType } from '../types/asset.types';

export const ASSET_URI_PREFIX = 'asset://';

function sanitizeAssetLabel(label: string): string {
  return label
    .replace(/[\r\n]+/g, ' ')
    .replace(/[[\]]/g, '')
    .trim();
}

function getTypeHint(assetType: AssetType): string {
  switch (assetType) {
    case AssetType.VIDEO:
      return 'video';
    case AssetType.AUDIO:
      return 'audio';
    case AssetType.IMAGE:
    default:
      return 'image';
  }
}

export function hasAssetEmbed(markdown: string): boolean {
  return /asset:\/\/[A-Za-z0-9-]+/.test(markdown);
}

export function extractAssetIdFromUrl(url: string): string | null {
  if (!url.startsWith(ASSET_URI_PREFIX)) {
    return null;
  }

  const assetId = url.slice(ASSET_URI_PREFIX.length).split(/[?#]/, 1)[0]?.trim();
  return assetId || null;
}

export function buildAssetEmbedMarkdown(asset: Asset): string {
  const safeLabel = sanitizeAssetLabel(asset.name || '未命名素材');
  const alt = `${getTypeHint(asset.type)}|${safeLabel}`;
  return `![${alt}](${ASSET_URI_PREFIX}${asset.id})`;
}

export function buildBlockAssetEmbedMarkdown(asset: Asset): string {
  return `\n\n${buildAssetEmbedMarkdown(asset)}\n\n`;
}
