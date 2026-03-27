import type { ModelConfig, ModelVendor } from '../../constants/model-config';
import type { ModelRef } from '../../utils/settings-manager';
import type {
  ProviderAuthStrategy,
  ProviderModelBinding,
  ProviderProtocol,
  ResolvedProviderContext,
} from '../provider-routing';

export type ModelKind = 'image' | 'video' | 'chat';

export interface AdapterContext {
  baseUrl: string;
  apiKey?: string;
  authType?: ProviderAuthStrategy;
  extraHeaders?: Record<string, string>;
  provider?: ResolvedProviderContext | null;
  binding?: ProviderModelBinding | null;
  fetcher?: typeof fetch;
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
  referenceImages?: string[];
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

export type ModelAdapter = ImageModelAdapter | VideoModelAdapter;
