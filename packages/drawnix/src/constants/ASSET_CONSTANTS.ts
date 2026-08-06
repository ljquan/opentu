/**
 * Asset Management Constants
 * 素材管理常量
 */

export const ASSET_CONSTANTS = {
  // 存储配置
  STORAGE_NAME: 'aitu-assets',
  STORE_NAME: 'assets',

  // 限制
  MAX_NAME_LENGTH: 255,
  STORAGE_WARNING_THRESHOLD: 0.8, // 80%
  STORAGE_CRITICAL_THRESHOLD: 0.95, // 95%

  // 文件类型
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/x-icon', 'image/avif', 'image/jfif'],
  ALLOWED_VIDEO_TYPES: [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-m4v',
  ],
  ALLOWED_ZIP_TYPES: ['application/zip', 'application/x-zip-compressed'],
  ALLOWED_AUDIO_TYPES: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/flac'],

  // UI配置
  GRID_COLUMNS_DESKTOP: 5,
  GRID_COLUMNS_TABLET: 3,
  GRID_COLUMNS_MOBILE: 2,

  // 默认名称格式
  DEFAULT_IMAGE_NAME_FORMAT: 'AI图片-{timestamp}',
  DEFAULT_VIDEO_NAME_FORMAT: 'AI视频-{timestamp}',
  DEFAULT_AUDIO_NAME_FORMAT: 'AI音频-{timestamp}',
  PROMPT_NAME_MAX_LENGTH: 20,
} as const;
