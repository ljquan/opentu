import type { PPTOutline, PPTSlideTransition } from '../ppt';
import type { TaskInvocationRouteSnapshot } from '../../types/task.types';
import type { ModelRef } from '../../utils/settings-types';
import type { PptExplainerProviderRouteSnapshot } from './provider-contract';
import type { PptxImportCheckpoint } from '../pptx-import';

export const PPT_EXPLAINER_SCHEMA_VERSION = 1 as const;

export type PptExplainerSourceKind = 'topic' | 'current_ppt' | 'pptx';
export type PptExplainerReviewMode = 'confirm' | 'skip_after_warning';
/** Historical provider tasks may still contain provider; new tasks are local only. */
export type PptExplainerExecutionMode = 'provider' | 'local';
export type PptExplainerPresenterMode =
  | 'single_voice'
  | 'dual_voice'
  | 'single_avatar'
  | 'dual_avatar';
export type PptExplainerVoiceSource = 'voice_id' | 'reference_audio';
export type PptExplainerStage =
  | 'preparing'
  | 'review_pending'
  | 'snapshotting'
  | 'scripting'
  | 'submitting'
  | 'polling'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PptExplainerSpeaker {
  id: string;
  displayName: string;
  /** Omitted on old tasks; absence is treated as voice_id for compatibility. */
  voiceSource?: PptExplainerVoiceSource;
  voiceId?: string;
  voiceReference?: PptExplainerVoiceReference;
  avatarAssetId?: string;
  avatarSourceUrl?: string;
}

export interface PptExplainerVoiceReference {
  /** Job-private internal artifact URL. Never sent in the provider manifest. */
  cacheUrl: string;
  /** Stable association used by the multipart part and manifest. */
  assetName: string;
  filename: string;
  mimeType: string;
  size: number;
  sourceAssetId?: string;
}

export interface PptExplainerReferenceAudioInput {
  /** A direct browser upload. Never persisted. */
  file?: File;
  /** A previously stored audio asset; resolved from local cache only. */
  sourceAssetId?: string;
  sourceUrl?: string;
  filename: string;
  mimeType: string;
  size?: number;
}

export interface PptExplainerSpeakerInput {
  id: string;
  displayName: string;
  voiceSource?: PptExplainerVoiceSource;
  voiceId?: string;
  referenceAudio?: PptExplainerReferenceAudioInput;
  avatarAssetId?: string;
  avatarSourceUrl?: string;
}

export interface PptExplainerCreateSpeakerInput {
  id: string;
  displayName: string;
}

export interface PptExplainerTurn {
  speakerId: string;
  text: string;
  /** Optional provider estimate. OpenTu does not cap or truncate it. */
  estimatedDurationSeconds?: number;
}

export interface PptExplainerSlide {
  pageIndex: number;
  frameId?: string;
  title?: string;
  snapshotUrl?: string;
  snapshotMimeType?: string;
  notes?: string;
  transition?: PPTSlideTransition;
  turns: PptExplainerTurn[];
  diagnostics?: string[];
}

export interface PptExplainerPptxSource {
  filename: string;
  mimeType: string;
  cacheUrl: string;
  /** Pending staged sources use a job-scoped placeholder until inspection. */
  fingerprint?: string;
}

export interface PptExplainerModelRoutes {
  textModel: string;
  textModelRef?: ModelRef | null;
  textRoute?: TaskInvocationRouteSnapshot;
  imageModel?: string;
  imageModelRef?: ModelRef | null;
  imageRoute?: TaskInvocationRouteSnapshot;
  audioModel?: string;
  audioModelRef?: ModelRef | null;
  audioRoute?: TaskInvocationRouteSnapshot;
  videoModel?: string;
  videoModelRef?: ModelRef | null;
}

export interface PptExplainerDeliveryState {
  resultSaved: boolean;
  canvasInserted: boolean;
}

export interface PptExplainerTaskState {
  schemaVersion: typeof PPT_EXPLAINER_SCHEMA_VERSION;
  jobId: string;
  source: PptExplainerSourceKind;
  sourceBoardId: string;
  topic?: string;
  /** 用户在主题中指定的精确总页数，包含封面和结尾。 */
  requestedPageCount?: number;
  /** Lightweight task-owned outline used to restore concurrent topic drafts. */
  topicOutline?: PPTOutline;
  outlineFrameIds?: string[];
  /** Content fingerprints captured with the ordered current-PPT frame set. */
  sourceFrameRevisions?: Record<string, string>;
  /** Internal image tasks owned by this root task and cleaned with it. */
  internalTaskIds?: string[];
  pptxImport?: PptxImportCheckpoint;
  pptx?: PptExplainerPptxSource;
  deckFingerprint?: string;
  reviewMode: PptExplainerReviewMode;
  reviewAcceptedAt?: number;
  presenterMode: PptExplainerPresenterMode;
  executionMode?: PptExplainerExecutionMode;
  speakers: PptExplainerSpeaker[];
  voiceConsentAcceptedAt?: number;
  stage: PptExplainerStage;
  slides: PptExplainerSlide[];
  idempotencyKey: string;
  remoteId?: string;
  presentationInput: 'pptx' | 'slide_images';
  originalRoute?: PptExplainerProviderRouteSnapshot;
  models: PptExplainerModelRoutes;
  delivery: PptExplainerDeliveryState;
  executionAttempt: number;
  diagnostics?: string[];
}

export interface PptExplainerCreateInput {
  source: PptExplainerSourceKind;
  sourceBoardId: string;
  /** Current-PPT page subset selected in the editor. Omitted means all pages. */
  currentPptFrameIds?: string[];
  topic?: string;
  requestedPageCount?: number;
  reviewMode: PptExplainerReviewMode;
  presenterMode: 'single_voice' | 'dual_voice';
  speakers: PptExplainerCreateSpeakerInput[];
  textModel: string;
  textModelRef?: ModelRef | null;
  imageModel?: string;
  imageModelRef?: ModelRef | null;
  videoModel: string;
  videoModelRef?: ModelRef | null;
  pptxFile?: File;
}

export interface PptExplainerManifest extends Record<string, unknown> {
  schemaVersion: typeof PPT_EXPLAINER_SCHEMA_VERSION;
  jobId: string;
  source: PptExplainerSourceKind;
  deckFingerprint?: string;
  presenterMode: PptExplainerPresenterMode;
  speakers: Array<{
    id: string;
    displayName: string;
    voiceSource: PptExplainerVoiceSource;
    voiceId?: string;
    voiceReference?: { assetName: string };
    avatarAssetId?: string;
    avatarSourceUrl?: string;
  }>;
  slides: Array<{
    pageIndex: number;
    title?: string;
    notes?: string;
    transition?: PPTSlideTransition;
    turns: PptExplainerTurn[];
    assetName?: string;
  }>;
}
