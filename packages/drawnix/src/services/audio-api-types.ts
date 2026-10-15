import type { NativeSunoResult } from './suno-native';
import type { ModelRef } from '../utils/settings-types';
import type { AudioGenerationRequest } from './model-adapters/types';

export interface AudioGenerationParams extends AudioGenerationRequest {
  model: string;
  modelRef?: ModelRef | null;
  taskId?: string;
}

export interface SunoV2Resource {
  id: string;
  kind: 'music_id' | 'persona_id' | 'model_id' | 'file_id';
  profileId: string;
  title?: string;
  audioUrl?: string;
}

export interface SunoV2Result {
  action: string;
  profileId: string;
  resources: SunoV2Resource[];
  files: Array<{ format?: string; fileUrl: string }>;
  lyrics: Array<{ text: string; title?: string; tags?: string[] }>;
  data: unknown;
}

export interface AudioClipRecord {
  batchIndex?: number;
  imageLargeUrl?: string | null;
  imageUrl?: string | null;
  audioUrl?: string;
  clipId?: string;
  id?: string;
  clip_id?: string;
  title?: string;
  status?: string;
  state?: string;
  mv?: string;
  model_name?: string;
  major_model_version?: string;
  duration?: number | null;
  audio_url?: string;
  image_url?: string | null;
  image_large_url?: string | null;
  batch_index?: number;
  metadata?: Record<string, unknown> & {
    duration?: number | null;
    prompt?: string;
    tags?: string;
    error_message?: string | null;
  };
  [key: string]: unknown;
}

export interface AudioLyricsPayload {
  text?: string;
  title?: string;
  tags?: string[];
  status?: string;
  errorMessage?: string;
}

export interface AudioTaskResponse {
  taskId: string;
  action?: string;
  status: string;
  progress?: number;
  failReason?: string;
  clips: AudioClipRecord[];
  lyrics?: AudioLyricsPayload | null;
  sunoV2?: SunoV2Result;
  sunoNative?: NativeSunoResult;
  raw: unknown;
}
