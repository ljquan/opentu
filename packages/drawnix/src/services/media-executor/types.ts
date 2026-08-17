import type { ModelRef } from '../../utils/settings-manager';
import type { GeminiMessagePart } from '../../utils/gemini-api/types';
import type {
  GenerationParams as TaskGenerationParams,
  TaskResultVisibility,
} from '../../types/shared/core.types';
import type { TaskInvocationRouteSnapshot } from '../../types/task.types';
import type {
  ProviderAuthStrategy,
  ProviderModelBinding,
  ResolvedProviderContext,
} from '../provider-routing';

/**
 * Media Executor Types
 *
 * 定义媒体执行器接口，SW 执行器和主线程降级执行器都实现此接口。
 * 采用场景化方法设计，每个场景有专门的方法和参数类型。
 */

// ============================================================================
// 图片生成参数
// ============================================================================

export interface ImageGenerationParams {
  /** 任务 ID（用于写入 tasks 表） */
  taskId: string;
  /** 当前正式提交使用的 Request ID；重试时与任务 ID 解耦。 */
  requestId?: string;
  /** 生成提示词 */
  prompt: string;
  /** 模型名称 */
  model?: string;
  /** 模型来源引用（用于按供应商路由） */
  modelRef?: ModelRef | null;
  /** 图片尺寸 (如 "1024x1024", "16:9") */
  size?: string;
  /** 图片生成模式：文生图、图生图或编辑 */
  generationMode?: 'text_to_image' | 'image_to_image' | 'image_edit';
  /** 参考图片 URL 列表 */
  referenceImages?: string[];
  /** 编辑蒙版图片 URL 或 data URL */
  maskImage?: string;
  /** GPT Image 输入保真度 */
  inputFidelity?: 'high' | 'low';
  /** GPT Image 背景模式 */
  background?: 'transparent' | 'opaque' | 'auto';
  /** GPT Image 输出格式 */
  outputFormat?: 'png' | 'jpeg' | 'webp';
  /** GPT Image 输出压缩率 */
  outputCompression?: number;
  /** 上传图片列表（与 SW 一致，fallback 会从中提取 URL） */
  uploadedImages?: Array<{ url?: string }>;
  /** 分辨率档位 */
  resolution?: '1k' | '2k' | '4k';
  /** 官方画质（GPT）或兼容旧值 */
  quality?: 'auto' | 'low' | 'medium' | 'high' | '1k' | '2k' | '4k';
  /** 生成数量 (1-10) */
  count?: number;
  /** 额外参数（如 seedream_quality），透传给 adapter */
  params?: Record<string, unknown>;
  /** 素材库轻量元数据 */
  assetMetadata?: TaskGenerationParams['assetMetadata'];
  /** 控制生成结果是否投影到素材库和画布。 */
  resultVisibility?: TaskResultVisibility;
}

// ============================================================================
// 视频生成参数
// ============================================================================

export interface VideoGenerationParams {
  /** 任务 ID */
  taskId: string;
  /** 生成提示词 */
  prompt: string;
  /** 模型名称 (如 "veo3", "sora-2") */
  model?: string;
  /** 模型来源引用（用于按供应商路由） */
  modelRef?: ModelRef | null;
  /** 视频时长 (秒) */
  duration?: string;
  /** 视频尺寸 */
  size?: string;
  /** 输入参考（图片或视频 URL） */
  inputReference?: string;
  /** 多个输入参考 */
  inputReferences?: Array<{
    type: 'image' | 'video';
    url: string;
  }>;
  /** 参考图片（兼容旧接口） */
  referenceImages?: string[];
  /** 额外参数（如 aspect_ratio），透传给 adapter */
  params?: Record<string, unknown>;
}

// ============================================================================
// AI 分析参数
// ============================================================================

export interface AIAnalyzeParams {
  /** 任务 ID */
  taskId: string;
  /** 分析提示词（与 messages 二选一） */
  prompt?: string;
  /** 预构建的消息数组（与 prompt 二选一，优先级更高） */
  messages?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | GeminiMessagePart[];
  }>;
  /** 待分析的图片 URL 列表 */
  images?: string[];
  /** 参考图片（用于占位符替换） */
  referenceImages?: string[];
  /** 模型名称 */
  model?: string;
  /** 模型来源引用（用于按供应商路由） */
  modelRef?: ModelRef | null;
  /** 用户选择的文本模型（优先于系统配置） */
  textModel?: string;
  /** 系统提示词（仅在使用 prompt 时有效） */
  systemPrompt?: string;
}

export interface TextGenerationParams {
  taskId?: string;
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  referenceImages?: string[];
  inlineDataParts?: GeminiMessagePart[];
  params?: Record<string, unknown>;
}

// ============================================================================
// AI 分析返回结果
// ============================================================================

export interface AIAnalyzeResult {
  /** 文本内容 */
  content?: string;
  /** 动态添加的步骤（AI 规划的后续任务） */
  addSteps?: Array<{
    id: string;
    mcp: string;
    args: Record<string, unknown>;
    description: string;
    status: 'pending';
  }>;
}

export interface TextGenerationResult {
  content: string;
}

// ============================================================================
// 执行进度回调
// ============================================================================

export interface ExecutionProgress {
  /** 进度百分比 (0-100) */
  progress: number;
  /** 当前阶段 */
  phase?: 'submitting' | 'polling' | 'downloading';
  /** 阶段描述 */
  message?: string;
}

export type ProgressCallback = (progress: ExecutionProgress) => void;

// ============================================================================
// 执行选项
// ============================================================================

export interface ExecutionOptions {
  /** 进度回调 */
  onProgress?: ProgressCallback;
  /** 图片正式提交请求即将发出。 */
  onSubmissionAttempt?: (
    invocationRoute?: TaskInvocationRouteSnapshot
  ) => void | Promise<void>;
  /** 当前执行尝试是否仍可写回任务结果。 */
  isCurrentAttempt?: () => boolean;
  /** 取消信号 */
  signal?: AbortSignal;
}

// ============================================================================
// 媒体执行器接口
// ============================================================================

/**
 * 媒体执行器接口
 *
 * SW 执行器和主线程降级执行器都实现此接口。
 * 方法返回 void，结果直接写入 IndexedDB 的 tasks 表。
 * 调用方通过轮询 IndexedDB 获取结果。
 */
export interface IMediaExecutor {
  /**
   * 执行器名称（用于日志）
   */
  readonly name: string;

  /**
   * 检查执行器是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 生成图片
   *
   * 执行流程：
   * 1. 更新 tasks 表状态为 processing
   * 2. 调用 API 生成图片
   * 3. 处理响应，缓存图片到 Cache Storage
   * 4. 更新 tasks 表状态为 completed/failed
   */
  generateImage(
    params: ImageGenerationParams,
    options?: ExecutionOptions
  ): Promise<void>;

  /**
   * 生成视频
   *
   * 执行流程：
   * 1. 更新 tasks 表状态为 processing
   * 2. 提交视频生成请求，获取 remoteId
   * 3. 轮询检查生成进度
   * 4. 下载生成结果，缓存到 Cache Storage
   * 5. 更新 tasks 表状态为 completed/failed
   */
  generateVideo(
    params: VideoGenerationParams,
    options?: ExecutionOptions
  ): Promise<void>;

  /**
   * AI 分析
   *
   * 执行流程：
   * 1. 更新 tasks 表状态为 processing
   * 2. 调用 LLM API 进行分析
   * 3. 解析返回的 tool calls，转换为 addSteps
   * 4. 更新 tasks 表状态为 completed/failed
   *
   * @returns AI 分析结果，包含动态添加的步骤
   */
  aiAnalyze(
    params: AIAnalyzeParams,
    options?: ExecutionOptions
  ): Promise<AIAnalyzeResult>;

  generateText(
    params: TextGenerationParams,
    options?: ExecutionOptions
  ): Promise<TextGenerationResult>;
}

// ============================================================================
// API 配置类型（从 SW 类型复制，避免循环依赖）
// ============================================================================

export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  textModelName?: string;
  authType?: ProviderAuthStrategy;
  providerType?: string;
  extraHeaders?: Record<string, string>;
  protocol?: string | null;
  binding?: ProviderModelBinding | null;
  provider?: ResolvedProviderContext | null;
}

export interface VideoAPIConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  params?: Record<string, unknown>;
  authType?: ProviderAuthStrategy;
  providerType?: string;
  extraHeaders?: Record<string, string>;
  binding?: ProviderModelBinding | null;
  provider?: ResolvedProviderContext | null;
}

export interface ExecutorConfig {
  geminiConfig: GeminiConfig;
  videoConfig: VideoAPIConfig;
}
