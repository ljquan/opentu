import type { ModelType } from '../../constants/model-config';
import type {
  ImageApiCompatibility,
  ManualHttpTemplateMetadata,
  ModelRef,
  ProviderProfile,
} from '../../utils/settings-types';

export type ProviderOperation = ModelType;

export type ProviderProtocol =
  | 'openai.chat.completions'
  | 'openai.images.generations'
  | 'openai.images.edits'
  | 'openai.async.media'
  | 'openai.async.video'
  | 'tuzi.suno.music'
  | 'google.generateContent'
  | 'mj.imagine'
  | 'flux.task'
  | 'kling.video'
  | 'seedance.task'
  | 'happyhorse.video'
  | 'tuzi.ppt-explainer'
  | (string & {});

export type ProviderBindingConfidence = 'high' | 'medium' | 'low';

export type ProviderBindingSource = 'discovered' | 'template' | 'manual';

export type ProviderAuthStrategy = 'bearer' | 'header' | 'query' | 'custom';
export type ProviderBaseUrlStrategy = 'preserve' | 'trim-v1' | 'ensure-v1';
export type ProviderVideoDurationMode = 'request-param' | 'model-alias';
export type ProviderVideoResultMode = 'inline-url' | 'download-content';
export type ProviderTextImageInputMode =
  | 'openai-image_url'
  | 'google-inline-data';

export type ProviderPptExplainerSourceKind = 'topic' | 'current_ppt' | 'pptx';
export type ProviderPptExplainerPresentationInput = 'pptx' | 'slide_images';
export type ProviderPptExplainerPresenterMode =
  | 'single_voice'
  | 'dual_voice'
  | 'single_avatar'
  | 'dual_avatar';
export type ProviderPptExplainerCancelMethod = 'DELETE' | 'POST';

export interface ProviderPptExplainerResponsePaths {
  status?: string;
  error?: string;
  remoteId?: string;
  progress?: string;
  finalVideoUrl?: string;
}

export interface ProviderPptExplainerStatusMapping {
  queued: string[];
  processing: string[];
  completed: string[];
  failed: string[];
  cancelled?: string[];
}

export interface ProviderPptExplainerBindingMetadata {
  capabilities: {
    sources: ProviderPptExplainerSourceKind[];
    presentationInputs: ProviderPptExplainerPresentationInput[];
    presenterModes: ProviderPptExplainerPresenterMode[];
    finalComposition: boolean;
    /** Explicit opt-in: the binding clones a supplied sample before narration. */
    referenceAudioVoiceCloning?: boolean;
  };
  /** Multipart mapping for voice-cloning samples. Required when capability is enabled. */
  referenceAudio?: {
    fieldName: string;
    acceptedMimeTypes?: string[];
  };
  responsePaths: {
    submit: ProviderPptExplainerResponsePaths & { remoteId: string };
    poll: ProviderPptExplainerResponsePaths & {
      status: string;
      finalVideoUrl: string;
    };
    cancel?: ProviderPptExplainerResponsePaths;
  };
  statusMapping: ProviderPptExplainerStatusMapping;
  progressScale?: 'percent' | 'ratio';
  idempotencyHeader?: string;
  cancel?: {
    pathTemplate: string;
    method: ProviderPptExplainerCancelMethod;
  };
}

export interface ProviderVideoBindingMetadata {
  allowedDurations?: string[];
  defaultDuration?: string;
  durationMode?: ProviderVideoDurationMode;
  durationField?: string;
  durationToModelMap?: Record<string, string>;
  strictDurationValidation?: boolean;
  resultMode?: ProviderVideoResultMode;
  downloadPathTemplate?: string;
  versionField?: string;
  versionOptions?: string[];
  defaultVersion?: string;
  versionOptionsByAction?: Record<string, string[]>;
}

export interface ProviderTextBindingMetadata {
  supportsImageInput?: boolean;
  imageInputMode?: ProviderTextImageInputMode;
  maxImageCount?: number;
  capabilitySource?: ProviderBindingSource | 'heuristic';
  capabilityConfidence?: ProviderBindingConfidence;
}

export interface ProviderImageBindingMetadata {
  imageApiCompatibility?: ImageApiCompatibility;
  resolvedImageApiCompatibility?: Exclude<ImageApiCompatibility, 'auto'>;
  action?: 'generation' | 'edit';
  maxImageCount?: number;
  supportsMask?: boolean;
}

export interface ProviderBindingMetadata {
  text?: ProviderTextBindingMetadata;
  image?: ProviderImageBindingMetadata;
  video?: ProviderVideoBindingMetadata;
  audio?: ProviderAudioBindingMetadata;
  pptExplainer?: ProviderPptExplainerBindingMetadata;
  manualHttp?: ManualHttpTemplateMetadata;
  [key: string]: unknown;
}

export interface ProviderAudioBindingMetadata {
  action?: string;
  defaultAction?: string;
  submitPathByAction?: Record<string, string>;
  versionField?: string;
  versionOptions?: string[];
  defaultVersion?: string;
  supportsContinuation?: boolean;
  supportsUploadContinuation?: boolean;
  supportsTags?: boolean;
  supportsTitle?: boolean;
  supportsLyricsPrompt?: boolean;
}

export interface ProviderProfileSnapshot
  extends Pick<
    ProviderProfile,
    | 'id'
    | 'name'
    | 'providerType'
    | 'baseUrl'
    | 'apiKey'
    | 'imageApiCompatibility'
    | 'preferAsyncImageEndpoint'
    | 'extraHeaders'
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
    supportsAudio: boolean;
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
  preferredRequestSchema?: string | readonly string[] | null;
  requiredProtocol?: ProviderProtocol | readonly ProviderProtocol[] | null;
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
  timeoutMs?: number;
  credentials?: RequestCredentials;
  fetcher?: typeof fetch;
  /** 图片提交的本地任务 ID；仅在供应商与运行时允许时写入 X-Request-Id。 */
  requestId?: string;
  /** 是否允许同步图片请求在网络结果未知时进入 Request ID 恢复。 */
  allowImageSubmissionOutcomeRecovery?: boolean;
  /** 响应体将通过 provider transport 的有界 reader 读取。 */
  controlledResponseBody?: boolean;
}

export interface PreparedProviderTransportRequest {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
}
