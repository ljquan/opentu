/**
 * 爆款MV生成器 - 类型定义
 */

import type { VideoShot } from '../../services/video-analysis-service';
import type { GeneratedClip } from '../music-analyzer/types';
import type { ModelRef } from '../../utils/settings-manager';

export type { VideoShot, GeneratedClip };

export type PageId = 'create' | 'storyboard' | 'generate' | 'history';

/** MV 分镜版本快照 */
export interface StoryboardVersion {
  id: string;
  createdAt: number;
  label: string;
  prompt?: string;
  shots: VideoShot[];
}

/** MV 创作记录 */
export interface MVRecord {
  id: string;
  createdAt: number;
  /** 用户创意描述 */
  creationPrompt: string;
  sourceLabel: string;
  starred: boolean;

  // ── 音乐相关 ──
  musicTitle?: string;
  musicStyleTags?: string[];
  musicLyrics?: string;
  /** Suno 生成任务 ID 列表 */
  musicTaskIds?: string[];
  /** 已生成的音乐片段 */
  generatedClips?: GeneratedClip[];
  /** 用户选定的配乐 clipId */
  selectedClipId?: string | null;
  /** 选定配乐的时长(秒) */
  selectedClipDuration?: number | null;
  /** 选定配乐的音频 URL */
  selectedClipAudioUrl?: string | null;

  // ── 分镜相关 ──
  videoModel?: string;
  videoModelRef?: ModelRef | null;
  segmentDuration?: number;
  videoStyle?: string;
  aspectRatio?: string;
  /** AI 分镜规划任务 ID */
  pendingStoryboardTaskId?: string | null;
  /** 编辑后的镜头列表 */
  editedShots?: VideoShot[];
  /** 分镜版本历史 */
  storyboardVersions?: StoryboardVersion[];
  activeVersionId?: string;

  // ── 生成相关 ──
  batchId?: string;
}
