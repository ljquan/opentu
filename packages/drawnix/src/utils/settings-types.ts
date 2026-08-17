import type { ModelConfig, ModelType } from '../constants/model-config';
import type { ProviderPricingCache } from './model-pricing-types';

export interface GeminiSettings {
  apiKey: string;
  baseUrl: string;
  chatModel?: string;
  audioModelName?: string;
  imageModelName?: string;
  videoModelName?: string;
  textModelName?: string;
}

export type ProviderType = 'openai-compatible' | 'gemini-compatible' | 'custom';
export type ProviderAuthType = 'bearer' | 'header' | 'query' | 'custom';
export type ImageApiCompatibility =
  | 'auto'
  | 'openai-gpt-image'
  | 'tuzi-gpt-image'
  | 'openai-compatible-basic';

export const DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: ImageApiCompatibility =
  'openai-gpt-image';
export const LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: ImageApiCompatibility =
  'tuzi-gpt-image';

export interface ProviderCapabilities {
  supportsModelsEndpoint: boolean;
  supportsText: boolean;
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsAudio: boolean;
  supportsTools: boolean;
}

export interface ProviderProfile {
  id: string;
  name: string;
  iconUrl?: string;
  homepageUrl?: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  authType: ProviderAuthType;
  imageApiCompatibility?: ImageApiCompatibility;
  preferAsyncImageEndpoint?: boolean;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  pricingUrl?: string;
  cnyPerUsd?: number;
  pricingGroup?: string;
  /** Server-managed credential metadata. These profiles are never persisted in global settings. */
  managedBy?: 'tuzi';
  managedGroup?: string;
  managedCredentialId?: string;
  managedTokenId?: number | string;
}

export type ProviderCatalogManualBindingConfidence = 'high' | 'medium' | 'low';
export type ProviderCatalogManualBindingSource = 'manual';
export type ProviderCatalogManualBindingBaseUrlStrategy =
  | 'preserve'
  | 'trim-v1';
export type ManualHttpResponseKind = 'text' | 'image' | 'task' | 'audio';
export type ManualHttpBodyType = 'json' | 'form-data' | 'raw' | 'none';
export type ManualHttpFormFieldKind = 'text' | 'file' | 'file-list';

export interface ManualHttpResponsePaths {
  text?: string;
  imageUrl?: string;
  imageUrls?: string;
  b64Json?: string;
  taskId?: string;
  status?: string;
  progress?: string;
  resultUrl?: string;
  resultUrls?: string;
  audioUrl?: string;
  audioUrls?: string;
  error?: string;
}

export interface ManualHttpFormField {
  name: string;
  value: string;
  kind?: ManualHttpFormFieldKind;
  filename?: string;
}

export interface ManualHttpTemplateMetadata {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyType?: ManualHttpBodyType;
  bodyTemplate?: string;
  formFields?: ManualHttpFormField[];
  responseKind?: ManualHttpResponseKind;
  responsePaths?: ManualHttpResponsePaths;
  pollPaths?: ManualHttpResponsePaths;
  pollResponsePaths?: ManualHttpResponsePaths;
}

export interface ProviderCatalogManualBinding {
  id: string;
  modelId: string;
  operation: ModelType;
  protocol: string;
  requestSchema: string;
  responseSchema: string;
  submitPath: string;
  baseUrlStrategy?: ProviderCatalogManualBindingBaseUrlStrategy;
  pollPathTemplate?: string;
  priority: number;
  confidence: ProviderCatalogManualBindingConfidence;
  source: ProviderCatalogManualBindingSource;
  metadata?: Record<string, unknown> & {
    manualHttp?: ManualHttpTemplateMetadata;
  };
}

export interface ProviderCatalog {
  profileId: string;
  discoveredAt: number | null;
  discoveredModels: ModelConfig[];
  selectedModelIds: string[];
  manualBindings?: ProviderCatalogManualBinding[];
  sourceBaseUrl?: string;
  signature?: string;
  error?: string | null;
}

export interface ModelRef {
  profileId: string | null;
  modelId: string | null;
}

export interface RouteConfig {
  defaultModelRef: ModelRef | null;
}

export interface InvocationPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  text: RouteConfig;
  image: RouteConfig;
  video: RouteConfig;
  audio: RouteConfig;
}

export interface SettingsMigrations {
  legacyDefaultImageApiCompatibilityV1?: boolean;
  legacyDefaultImageModelV1?: boolean;
}

export interface TtsSettings {
  selectedVoice?: string;
  rate: number;
  pitch: number;
  volume: number;
  voicesByLanguage?: Record<string, string>;
}

export interface AppSettings {
  gemini: GeminiSettings;
  tts: TtsSettings;
  providerProfiles: ProviderProfile[];
  providerCatalogs: ProviderCatalog[];
  providerPricingCache: ProviderPricingCache[];
  invocationPresets: InvocationPreset[];
  activePresetId: string;
  migrations: SettingsMigrations;
}

export interface ResolvedInvocationRoute {
  routeType: ModelType;
  modelId: string;
  profileId: string | null;
  profileName: string | null;
  providerType: ProviderType | null;
  baseUrl: string;
  apiKey: string;
  source: 'preset' | 'legacy';
}
