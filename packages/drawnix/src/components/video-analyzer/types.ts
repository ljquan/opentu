/**
 * 视频拆解器内部类型定义
 */

import type { VideoAnalysisData, VideoShot } from '../../services/video-analysis-service';
import { createModelRef, type ModelRef } from '../../utils/settings-manager';

export type { VideoAnalysisData, VideoShot };

/** 页面标识 */
export type PageId = 'analyze' | 'script' | 'generate' | 'history';

/** 商品信息 / 改编提示词 */
export interface ProductInfo {
  /** 用户提示词（合并了原 name/category/sellingPoints） */
  prompt: string;
  /** 目标视频时长（秒），默认为原视频时长 */
  targetDuration?: number;
  /** 视频生成模型 ID */
  videoModel?: string;
  /** 视频生成模型引用（用于保留供应商 profileId） */
  videoModelRef?: ModelRef | null;
  /** 用户选择的单段时长（秒），来自视频模型的 durationOptions */
  segmentDuration?: number;
  /** 用户选择的视频尺寸 */
  videoSize?: string;
  /** 用户编辑的画面风格（覆盖 analysis.video_style） */
  videoStyle?: string;
  /** 用户编辑的 BGM 情绪（覆盖 analysis.bgm_mood） */
  bgmMood?: string;

  /** @deprecated use prompt */
  name?: string;
  /** @deprecated use prompt */
  category?: string;
  /** @deprecated use prompt */
  sellingPoints?: string;
}

export type AnalysisSourceSnapshot =
  | {
      type: 'youtube';
      youtubeUrl: string;
    }
  | {
      type: 'upload';
      cacheUrl: string;
      fileName: string;
      mimeType: string;
      size: number;
    };

/** 将旧格式 ProductInfo 迁移为新格式（幂等） */
export function migrateProductInfo(raw: Partial<ProductInfo>, fallbackDuration: number): ProductInfo {
  if (raw.prompt !== undefined) {
    return {
      prompt: raw.prompt,
      targetDuration: raw.targetDuration ?? fallbackDuration,
      videoModel: raw.videoModel,
      videoModelRef: createModelRef(raw.videoModelRef?.profileId, raw.videoModelRef?.modelId),
      segmentDuration: raw.segmentDuration,
      videoSize: raw.videoSize,
      videoStyle: raw.videoStyle,
      bgmMood: raw.bgmMood,
    };
  }
  const parts: string[] = [];
  if (raw.name) parts.push(raw.name);
  if (raw.category) parts.push(raw.category);
  if (raw.sellingPoints) parts.push(raw.sellingPoints);
  return {
    prompt: parts.join('，'),
    targetDuration: raw.targetDuration ?? fallbackDuration,
    videoModel: raw.videoModel,
    videoModelRef: createModelRef(raw.videoModelRef?.profileId, raw.videoModelRef?.modelId),
    segmentDuration: raw.segmentDuration,
    videoSize: raw.videoSize,
    videoStyle: raw.videoStyle,
    bgmMood: raw.bgmMood,
  };
}

/** 脚本版本快照 */
export interface ScriptVersion {
  id: string;
  createdAt: number;
  /** 版本标签，如 "AI 改编 #1" */
  label: string;
  /** 该版本使用的提示词 */
  prompt?: string;
  /** 该版本的镜头列表（深拷贝，各版本独立） */
  shots: VideoShot[];
}

/** 分析记录（持久化到 IndexedDB） */
export interface AnalysisRecord {
  id: string;
  createdAt: number;
  source: 'upload' | 'youtube';
  sourceLabel: string;
  sourceSnapshot?: AnalysisSourceSnapshot | null;
  model: string;
  modelRef?: ModelRef | null;
  analysis: VideoAnalysisData;
  /** 用户编辑后的脚本 */
  editedShots?: VideoShot[];
  /** 商品信息 */
  productInfo?: ProductInfo;
  /** 关联的生成任务 batchId */
  batchId?: string;
  /** 生成该分析记录的队列任务 ID */
  analyzeTaskId?: string | null;
  /** 当前挂起的脚本改编任务 ID */
  pendingRewriteTaskId?: string | null;
  /** 是否收藏 */
  starred: boolean;
  /** 脚本版本历史（最新在前，最多 10 个） */
  scriptVersions?: ScriptVersion[];
  /** 当前活跃的脚本版本 ID */
  activeVersionId?: string;
}

/** 镜头类型颜色映射 */
export const SHOT_TYPE_COLORS: Record<string, string> = {
  opening: '#3B82F6',
  product: '#F59E0B',
  detail: '#8B5CF6',
  scene: '#10B981',
  cta: '#EF4444',
  other: '#6B7280',
};

/** aspect_ratio → 视频尺寸 */
export function aspectRatioToVideoSize(ratio?: string): string {
  switch (ratio) {
    case '9x16': return '720x1280';
    case '1x1': return '1024x1024';
    default: return '1280x720';
  }
}

/** 将镜头列表格式化为完整的 Markdown 脚本（用于插入画布） */
export function formatShotsMarkdown(
  shots: VideoShot[],
  analysis: VideoAnalysisData,
  productInfo?: ProductInfo | null
): string {
  const shotsMd = shots.map((s, i) => {
    const lines = [
      `### ${i + 1}. ${s.label} (${s.startTime}s-${s.endTime}s)`,
      ``,
      `**画面描述：** ${s.description || '-'}`,
      ``,
      `**旁白：** ${s.narration || '-'}`,
      s.dialogue ? `\n**角色对白：** ${s.dialogue}` : '',
      s.dialogue_speakers ? `\n**对白角色：** ${s.dialogue_speakers}` : '',
      s.speech_relation ? `\n**语音关系：** ${s.speech_relation}` : '',
      s.camera_movement ? `\n**运镜：** ${s.camera_movement}` : '',
      s.first_frame_prompt ? `\n**首帧 Prompt：** ${s.first_frame_prompt}` : '',
      s.last_frame_prompt ? `\n**尾帧 Prompt：** ${s.last_frame_prompt}` : '',
      s.transition_hint ? `\n**转场：** ${s.transition_hint}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }).join('\n\n---\n\n');

  const headerParts = [`# 视频脚本`];
  if (productInfo?.prompt) headerParts.push(`\n**提示词：** ${productInfo.prompt}`);
  const dur = productInfo?.targetDuration || analysis.totalDuration;
  headerParts.push(`\n**时长：** ${dur}s | **画面比例：** ${analysis.aspect_ratio || '16x9'}`);
  if (analysis.video_style) headerParts.push(` | **风格：** ${analysis.video_style}`);
  if (analysis.bgm_mood) headerParts.push(` | **BGM：** ${analysis.bgm_mood}`);
  if (analysis.suggestion) headerParts.push(`\n\n> ${analysis.suggestion}`);

  return `${headerParts.join('')}\n\n${shotsMd}`;
}
