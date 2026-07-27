/**
 * Media API 共享模块
 *
 * 提供统一的媒体生成 API 调用逻辑，SW 和主线程共用
 *
 * 设计原则：
 * - 只依赖标准 fetch（SW 和主线程都支持）
 * - 无 DOM 依赖
 * - 可注入 fetch 实现（SW 可注入 debugFetch）
 * - 进度回调可选
 */

// 类型导出
export type {
  ApiConfig,
  ImageApiConfig,
  VideoApiConfig,
  ImageGenerationParams,
  ImageGenerationResult,
  VideoGenerationParams,
  VideoGenerationResult,
  VideoStatusResponse,
  AsyncTaskSubmitResponse,
  PollingOptions,
  AsyncImageOptions,
} from './types';

// 工具函数导出
export {
  isAsyncImageModel,
  normalizeApiBase,
  getExtensionFromUrl,
  sizeToAspectRatio,
  aspectRatioToSize,
  extractPromptFromMessages,
  parseSize,
  parseErrorMessage,
  sleep,
} from './utils';

// 图片 API 导出
export {
  buildImageRequestBody,
  parseImageResponse,
  generateImageSync,
  generateImageAsync,
  resumeAsyncImagePolling,
} from './image-api';

// 视频 API 导出
export {
  VideoGenerationFailedError,
  submitVideoGeneration,
  queryVideoStatus,
  pollVideoUntilComplete,
  generateVideo,
  resumeVideoPolling,
} from './video-api';
