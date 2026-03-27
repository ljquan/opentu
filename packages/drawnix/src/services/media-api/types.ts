/**
 * Media API 共享类型定义
 *
 * 用于 SW 和主线程共享的 API 调用类型
 */

import type {
  ProviderAuthStrategy,
  ProviderModelBinding,
  ResolvedProviderContext,
} from '../provider-routing/types';

/**
 * 基础 API 配置
 */
export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  /** 可选：自定义 fetch 实现（用于 SW 中注入 debugFetch） */
  fetchImpl?: typeof fetch;
  /** 可选：统一供应商上下文 */
  provider?: ResolvedProviderContext | null;
  /** 可选：协议绑定 */
  binding?: ProviderModelBinding | null;
  /** 可选：鉴权策略 */
  authType?: ProviderAuthStrategy;
  /** 可选：供应商类型 */
  providerType?: string;
  /** 可选：额外请求头 */
  extraHeaders?: Record<string, string>;
}

/**
 * 图片 API 配置（扩展自基础配置）
 */
export interface ImageApiConfig extends ApiConfig {
  /** 默认模型名称 */
  defaultModel?: string;
}

/**
 * 视频 API 配置（扩展自基础配置）
 */
export interface VideoApiConfig extends ApiConfig {
  /** 默认模型名称 */
  defaultModel?: string;
}

/**
 * 图片生成参数
 */
export interface ImageGenerationParams {
  prompt: string;
  model?: string;
  /** 尺寸字符串，如 '1024x1024' */
  size?: string;
  /** 宽高比，如 '1:1', '16:9' */
  aspectRatio?: string;
  /** 参考图片 URL 或 base64 数组 */
  referenceImages?: string[];
  /** 质量设置 */
  quality?: '1k' | '2k' | '4k' | string;
  /** 生成数量 */
  n?: number;
}

/**
 * 视频生成参数
 */
export interface VideoGenerationParams {
  prompt: string;
  model?: string;
  /** 视频时长（秒） */
  duration?: number | string;
  /** 尺寸，如 '16:9', '9:16' */
  size?: string;
  /** 参考图片 */
  referenceImages?: string[];
  /** 额外参数（如 sora_mode） */
  params?: Record<string, unknown>;
}

/**
 * 图片生成结果
 */
export interface ImageGenerationResult {
  /** 主图片 URL */
  url: string;
  /** 多图时的所有 URL */
  urls?: string[];
  /** 图片格式 */
  format?: string;
}

/**
 * 视频生成结果
 */
export interface VideoGenerationResult {
  /** 视频 URL */
  url: string;
  /** 视频格式 */
  format?: string;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  /** 时长（秒） */
  duration?: number;
}

/**
 * 视频状态响应
 */
export interface VideoStatusResponse {
  id: string;
  model?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'succeeded' | 'error';
  progress?: number;
  video_url?: string;
  url?: string;
  width?: number;
  height?: number;
  seconds?: string;
  error?: string | { code: string; message: string };
  message?: string;
}

/**
 * 异步任务提交响应
 */
export interface AsyncTaskSubmitResponse {
  id: string;
  status: string;
  progress?: number;
  error?: string | { code?: string; message?: string };
}

/**
 * 轮询配置
 */
export interface PollingOptions {
  /** 进度回调 */
  onProgress?: (progress: number) => void;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 轮询间隔（毫秒），默认 5000 */
  interval?: number;
  /** 最大尝试次数，默认 1080（90分钟） */
  maxAttempts?: number;
}

/**
 * 异步图片生成选项
 */
export interface AsyncImageOptions extends PollingOptions {
  /** 提交成功后的回调，返回远程任务 ID */
  onSubmitted?: (remoteId: string) => void;
}
