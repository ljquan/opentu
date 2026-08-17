import type { PPTOutline, PPTSlideTransition } from '../ppt';
import type { TaskInvocationRouteSnapshot } from '../../types/task.types';
import type { ModelRef } from '../../utils/settings-types';
import type { PptExplainerProviderRouteSnapshot } from './provider-contract';
import type { PptxImportCheckpoint } from '../pptx-import';

export const PPT_EXPLAINER_SCHEMA_VERSION = 1 as const;

export type PptExplainerSourceKind = 'topic' | 'current_ppt' | 'pptx';
export type PptExplainerReviewMode = 'confirm' | 'skip_after_warning';
export type PptExplainerPresenterMode =
  | 'single_voice'
  | 'dual_voice'
  | 'single_avatar'
  | 'dual_avatar';
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
  voiceId: string;
  avatarAssetId?: string;
  avatarSourceUrl?: string;
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
  videoModel: string;
  videoModelRef: ModelRef;
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
  speakers: PptExplainerSpeaker[];
  stage: PptExplainerStage;
  slides: PptExplainerSlide[];
  idempotencyKey: string;
  remoteId?: string;
  presentationInput: 'pptx' | 'slide_images';
  originalRoute: PptExplainerProviderRouteSnapshot;
  models: PptExplainerModelRoutes;
  delivery: PptExplainerDeliveryState;
  executionAttempt: number;
  diagnostics?: string[];
}

export interface PptExplainerCreateInput {
  source: PptExplainerSourceKind;
  sourceBoardId: string;
  topic?: string;
  reviewMode: PptExplainerReviewMode;
  presenterMode: PptExplainerPresenterMode;
  speakers: PptExplainerSpeaker[];
  textModel: string;
  textModelRef?: ModelRef | null;
  imageModel?: string;
  imageModelRef?: ModelRef | null;
  videoModel: string;
  videoModelRef: ModelRef;
  providerBindingId?: string;
  pptxFile?: File;
}

export interface PptExplainerManifest extends Record<string, unknown> {
  schemaVersion: typeof PPT_EXPLAINER_SCHEMA_VERSION;
  jobId: string;
  source: PptExplainerSourceKind;
  deckFingerprint?: string;
  presenterMode: PptExplainerPresenterMode;
  speakers: PptExplainerSpeaker[];
  slides: Array<{
    pageIndex: number;
    title?: string;
    notes?: string;
    transition?: PPTSlideTransition;
    turns: PptExplainerTurn[];
    assetName?: string;
  }>;
}
