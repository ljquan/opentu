/**
 * Media Utilities
 *
 * 媒体处理工具模块
 * - 视频：缩略图生成、帧提取、时间格式化
 * - 图片：压缩、加载、去白边/透明边
 */

// Types
export * from './types';

// Video utilities
export {
  calculateThumbnailSize,
  generateVideoThumbnailFromBlob,
  extractVideoFrame,
  extractFirstFrame,
  extractLastFrame,
  formatVideoTimestamp,
} from './video';

// Image utilities
export {
  // 图片加载
  loadImage,
  createCanvasFromImage,
  parsePixelSize,
  normalizeImageBlobToSize,
  // 压缩
  getCompressionStrategy,
  compressImageBlob,
  compressImageBlobWithStats,
  // 边框检测
  isBorderColor,
  isBackgroundPixel,
  isWhiteBorderPixel,
  // 边框裁剪
  trimBorders,
  trimCanvasBorders,
  trimCanvasWhiteAndTransparentBorder,
  trimCanvasWhiteAndTransparentBorderWithInfo,
  trimImageWhiteAndTransparentBorder,
  removeWhiteBorder,
} from './image';
