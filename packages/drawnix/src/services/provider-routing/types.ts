import type { ModelType } from '../../constants/model-config';
import type { ModelRef, ProviderProfile } from '../../utils/settings-manager';

export type ProviderOperation = ModelType;

export type ProviderProtocol =
  | 'openai.chat.completions'
  | 'openai.images.generations'
  | 'openai.async.media'
  | 'openai.async.video'
  | 'google.generateContent'
  | 'mj.imagine'
  | 'flux.task'
  | 'kling.video'
  | 'seedance.task'
  | (string & {});

export type ProviderBindingConfidence = 'high' | 'medium' | 'low';

export type ProviderBindingSource = 'discovered' | 'template' | 'manual';

export type ProviderAuthStrategy = 'bearer' | 'header' | 'query' | 'custom';
export type ProviderBaseUrlStrategy = 'preserve' | 'trim-v1';
export type ProviderVideoDurationMode = 'request-param' | 'model-alias';
export type ProviderVideoResultMode = 'inline-url' | 'download-content';
export type ProviderTextImageInputMode =
  | 'openai-image_url'
  | 'google-inline-data';

export interface ProviderVideoBindingMetadata {
  allowedDurations?: string[];
  defaultDuration?: string;
  durationMode?: ProviderVideoDurationMode;
  durationField?: string;
  durationToModelMap?: Record<string, string>;
  strictDurationValidation?: boolean;
  resultMode?: ProviderVideoResultMode;
  downloadPathTemplate?: string;
}

export interface ProviderTextBindingMetadata {
  supportsImageInput?: boolean;
  imageInputMode?: ProviderTextImageInputMode;
  maxImageCount?: number;
  capabilitySource?: ProviderBindingSource | 'heuristic';
  capabilityConfidence?: ProviderBindingConfidence;
}

export interface ProviderBindingMetadata {
  text?: ProviderTextBindingMetadata;
  video?: ProviderVideoBindingMetadata;
  [key: string]: unknown;
}

export interface ProviderProfileSnapshot
  extends Pick<
    ProviderProfile,
    'id' | 'name' | 'providerType' | 'baseUrl' | 'apiKey' | 'extraHeaders'
  > {
  authType: ProviderAuthStrategy;
}

export interface ResolvedProviderContext {
  profileId: string;
  profileName: string;
  providerType: ProviderProfile['providerType'] | string;
  baseUrl: string;
  apiKey: string;
  authType: ProviderAuthStrategy;
  extraHeaders?: Record<string, string>;
}

export interface ProviderModelBinding {
  id: string;
  profileId: string;
  modelId: string;
  operation: ProviderOperation;
  protocol: ProviderProtocol;
  requestSchema: string;
  responseSchema: string;
  submitPath: string;
  baseUrlStrategy?: ProviderBaseUrlStrategy;
  pollPathTemplate?: string;
  priority: number;
  confidence: ProviderBindingConfidence;
  source: ProviderBindingSource;
  metadata?: ProviderBindingMetadata;
}

export interface DiscoveredProviderModel {
  profileId: string;
  modelId: string;
  selectionKey: string;
  raw: unknown;
  capabilityHints: {
    supportsText: boolean;
    supportsImage: boolean;
    supportsVideo: boolean;
  };
  bindings: ProviderModelBinding[];
}

export interface NormalizedModelRef {
  profileId: string;
  modelId: string;
}

export interface InvocationPlan {
  provider: ResolvedProviderContext;
  modelRef: NormalizedModelRef;
  binding: ProviderModelBinding;
}

export interface InvocationPlanRequest {
  operation: ProviderOperation;
  modelRef?: ModelRef | null;
  fallbackModelRef?: ModelRef | null;
  bindingId?: string | null;
}

export interface InvocationPlannerRepositories {
  getProviderProfile(profileId: string): ProviderProfileSnapshot | null;
  getModelBindings(
    modelRef: NormalizedModelRef,
    operation: ProviderOperation
  ): ProviderModelBinding[];
}

export interface ProviderTransportRequest {
  path: string;
  baseUrlStrategy?: ProviderBaseUrlStrategy;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: BodyInit | null;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  fetcher?: typeof fetch;
}

export interface PreparedProviderTransportRequest {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
}
