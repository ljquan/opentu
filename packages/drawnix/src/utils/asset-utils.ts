/**
 * Asset Utility Functions
 * 素材工具函数
 */

import { ASSET_CONSTANTS } from '../constants/ASSET_CONSTANTS';
import type {
  Asset,
  AssetType,
  FilterState,
  FilteredAssetsResult,
} from '../types/asset.types';
import { AssetCategory } from '../types/asset.types';

type SearchableAsset = Asset & {
  title?: string;
};

const INTERNAL_LIBRARY_EXCLUDED_CACHE_SOURCES = new Set([
  'video-frame',
  'ai-mask-brush',
  'ai-mask-reference-resize',
]);

export function isInternalLibraryExcludedCache(item: {
  metadata?: Record<string, unknown> | null;
}): boolean {
  const source = item.metadata?.source;
  return (
    typeof source === 'string' &&
    INTERNAL_LIBRARY_EXCLUDED_CACHE_SOURCES.has(source)
  );
}

/**
 * Validate Asset Name
 * 验证素材名称
 */
export function validateAssetName(
  name: string,
): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: '素材名称不能为空' };
  }
  if (name.length > ASSET_CONSTANTS.MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: `素材名称不能超过${ASSET_CONSTANTS.MAX_NAME_LENGTH}个字符`,
    };
  }
  return { valid: true };
}

/**
 * Validate MIME Type
 * 验证MIME类型
 */
export function validateMimeType(
  mimeType: string,
): { valid: boolean; error?: string } {
  const allowedTypes = [
    ...ASSET_CONSTANTS.ALLOWED_IMAGE_TYPES,
    ...ASSET_CONSTANTS.ALLOWED_VIDEO_TYPES,
    ...ASSET_CONSTANTS.ALLOWED_AUDIO_TYPES,
  ];

  if (!allowedTypes.includes(mimeType as any)) {
    return {
      valid: false,
      error: `不支持的文件类型: ${mimeType}。只支持图片（JPG, PNG, GIF, WebP, SVG, BMP, ICO, AVIF, JFIF）、视频（MP4, WebM, OGG, MOV, M4V）和音频（MP3, WAV, OGG, AAC, FLAC）。`,
    };
  }
  return { valid: true };
}

/**
 * Get Asset Type from MIME Type
 * 根据MIME类型获取素材类型
 */
export function getAssetType(mimeType: string): AssetType | null {
  if (mimeType.startsWith('image/')) return 'IMAGE' as AssetType;
  if (mimeType.startsWith('video/')) return 'VIDEO' as AssetType;
  if (mimeType.startsWith('audio/')) return 'AUDIO' as AssetType;
  return null;
}

function normalizeSearchText(value: string | undefined): string {
  return value?.trim().toLowerCase() || '';
}

/**
 * Match Asset Search Query
 * 按标题/提示词模糊匹配素材搜索关键词
 */
export function matchesAssetSearchQuery(
  asset: Asset,
  searchQuery: string | undefined,
): boolean {
  const tokens = normalizeSearchText(searchQuery).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  const searchableAsset = asset as SearchableAsset;
  const searchableText = [
    searchableAsset.name,
    searchableAsset.title,
    searchableAsset.prompt,
    asset.characterMeta?.name,
    asset.characterMeta?.prompt,
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(' ');

  return tokens.every((token) => searchableText.includes(token));
}

/**
 * Filter Assets
 * 筛选和排序素材
 */
export function filterAssets(
  assets: Asset[],
  filters: FilterState,
): FilteredAssetsResult {
  const filtered = assets
    .filter((asset) => {
      // Type filter
      const matchesType =
        !filters.activeType || 
        filters.activeType === ('ALL' as any) || 
        asset.type === filters.activeType;

      // Source filter
      const matchesSource =
        !filters.activeSource ||
        filters.activeSource === ('ALL' as any) ||
        asset.source === (filters.activeSource as any);

      // Category filter
      const matchesCategory =
        !filters.activeCategory ||
        filters.activeCategory === ('ALL' as any) ||
        (asset.category || AssetCategory.GENERAL) === filters.activeCategory;

      // Search filter
      const matchesSearch = matchesAssetSearchQuery(asset, filters.searchQuery);

      return matchesType && matchesSource && matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      switch (filters.sortBy) {
        case 'DATE_DESC':
          return b.createdAt - a.createdAt;
        case 'DATE_ASC':
          return a.createdAt - b.createdAt;
        case 'NAME_ASC':
          return a.name.localeCompare(b.name);
        case 'NAME_DESC':
          return b.name.localeCompare(a.name);
        case 'SIZE_DESC':
          return (b.size || 0) - (a.size || 0);
        case 'SIZE_ASC':
          return (a.size || 0) - (b.size || 0);
        default:
          return 0;
      }
    });

  return {
    assets: filtered,
    count: filtered.length,
    isEmpty: filtered.length === 0,
  };
}

/**
 * Download Asset
 * 下载素材到本地
 */
export function downloadAsset(asset: Asset): void {
  const link = document.createElement('a');
  link.href = asset.url;
  link.download = asset.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Generate Asset Name from Prompt
 * 从提示词生成素材名称
 */
export function generateAssetNameFromPrompt(
  prompt: string | undefined,
  type: AssetType,
): string {
  if (prompt && prompt.length > 0) {
    const truncated = prompt.substring(0, ASSET_CONSTANTS.PROMPT_NAME_MAX_LENGTH);
    return truncated.length < prompt.length ? `${truncated}...` : truncated;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const format =
    type === 'IMAGE'
      ? ASSET_CONSTANTS.DEFAULT_IMAGE_NAME_FORMAT
      : type === 'AUDIO'
      ? ASSET_CONSTANTS.DEFAULT_AUDIO_NAME_FORMAT
      : ASSET_CONSTANTS.DEFAULT_VIDEO_NAME_FORMAT;

  return format.replace('{timestamp}', timestamp);
}

import { formatFileSize as formatFileSizeUtil, formatDate as formatDateUtil } from '@aitu/utils';

/**
 * Format File Size
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  return formatFileSizeUtil(bytes);
}

/**
 * Format Date
 * 格式化日期为 YYYY-MM-DD HH:mm:ss 格式
 */
export function formatDate(timestamp: number): string {
  return formatDateUtil(timestamp);
}
