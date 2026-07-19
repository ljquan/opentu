import type {
  ModelConfig,
  ModelType,
  ModelVendor,
} from '../../constants/model-config';
import type { ModelRef } from '../../utils/settings-types';
import type {
  ProviderAuthStrategy,
  ProviderModelBinding,
  ProviderProtocol,
  ResolvedProviderContext,
} from '../provider-routing/types';

export type ModelKind = 'image' | 'video' | 'audio' | 'chat';

export interface AdapterContext {
  baseUrl: string;
  operation?: ModelType;
  apiKey?: string;
  authType?: ProviderAuthStrategy;
  extraHeaders?: Record<string, string>;
  provider?: ResolvedProviderContext | null;
  binding?: ProviderModelBinding | null;
  fetcher?: typeof fetch;
  /**
   * sendAdapterRequest 仅在 Tuzi 同源图片请求中生成 requestId 并回传。
   * caller 可在超时时通过 /log/get-request 找回结果。
   */
  onRequestSent?: (info: { requestId: string }) => void;
}

export interface AdapterMetadata {
  id: string;
  label: string;
  kind: ModelKind;
  docsUrl?: string;
  matchProtocols?: ProviderProtocol[];
  matchRequestSchemas?: string[];
  supportedModels?: string[];
  defaultModel?: string;
  /** 精确匹配的模型 ID 列表（优先级最高） */
  matchModels?: string[];
  /** 按厂商匹配（如 GEMINI/MIDJOURNEY/FLUX/DOUBAO 等） */
  matchVendors?: ModelVendor[];
  /** 按标签匹配（与 ModelConfig.tags 交集） */
  matchTags?: string[];
  /** 自定义匹配函数（接收 modelConfig） */
  matchPredicate?: (model: ModelConfig) => boolean;
}

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  size?: string;
  generationMode?: 'text_to_image' | 'image_to_image' | 'image_edit';
  referenceImages?: string[];
  maskImage?: string;
  inputFidelity?: 'high' | 'low';
  background?: 'transparent' | 'opaque' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  outputCompression?: number;
  params?: Record<string, unknown>;
}

export interface ImageGenerationResult {
  url: string;
  urls?: string[];
  thumbnails?: string[];
  format?: string;
  width?: number;
  height?: number;
  raw?: unknown;
}

export interface VideoGenerationRequest {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  size?: string;
  duration?: number;
  referenceImages?: string[];
  params?: Record<string, unknown>;
}

export interface VideoGenerationResult {
  url: string;
  format?: string;
  width?: number;
  height?: number;
  duration?: number;
  raw?: unknown;
}

export interface AudioGenerationRequest {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  title?: string;
  tags?: string;
  mv?: string;
  sunoAction?: string;
  notifyHook?: string;
  continueClipId?: string;
  continueTaskId?: string;
  continueAt?: number;
  infillStartS?: number;
  infillEndS?: number;
  params?: Record<string, unknown>;
}

export interface AudioGenerationClipResult {
  id?: string;
  clipId?: string;
  title?: string;
  status?: string;
  audioUrl: string;
  imageUrl?: string;
  imageLargeUrl?: string;
  duration?: number | null;
  modelName?: string;
  majorModelVersion?: string;
}

export interface AudioGenerationResult {
  url: string;
  resultKind?: 'audio' | 'lyrics';
  title?: string;
  lyricsText?: string;
  lyricsTitle?: string;
  lyricsTags?: string[];
  format?: string;
  duration?: number | null;
  imageUrl?: string;
  urls?: string[];
  providerTaskId?: string;
  primaryClipId?: string;
  clipIds?: string[];
  clips?: AudioGenerationClipResult[];
  raw?: unknown;
}

export interface ImageModelAdapter extends AdapterMetadata {
  kind: 'image';
  generateImage(
    context: AdapterContext,
    request: ImageGenerationRequest
  ): Promise<ImageGenerationResult>;
}

export interface VideoModelAdapter extends AdapterMetadata {
  kind: 'video';
  generateVideo(
    context: AdapterContext,
    request: VideoGenerationRequest
  ): Promise<VideoGenerationResult>;
}

export interface AudioModelAdapter extends AdapterMetadata {
  kind: 'audio';
  generateAudio(
    context: AdapterContext,
    request: AudioGenerationRequest
  ): Promise<AudioGenerationResult>;
}

export type ModelAdapter =
  | ImageModelAdapter
  | VideoModelAdapter
  | AudioModelAdapter;
