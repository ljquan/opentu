import {
  normalizeMusicAnalysisData,
  type MusicAnalysisData,
} from '../../services/music-analysis-service';
import { createModelRef, type ModelRef } from '../../utils/settings-manager';

export type { MusicAnalysisData };

export type PageId = 'create' | 'lyrics' | 'generate' | 'history';

export type CreationMode = 'scratch' | 'reference';
export type SunoMusicEditAction = 'generate' | 'continue' | 'infill';

export type MusicAnalysisSourceSnapshot = {
  type: 'upload';
  cacheUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
};

/** 歌词版本快照（复用视频工具 ScriptVersion 模式） */
export interface LyricsVersion {
  id: string;
  createdAt: number;
  label: string;
  prompt?: string;
  title: string;
  styleTags: string[];
  lyricsDraft: string;
}

/** 已生成的音频片段 */
export interface GeneratedClip {
  clipId: string;
  audioUrl: string;
  imageUrl?: string;
  title?: string;
  duration?: number | null;
  taskId: string;
}

export interface MusicAnalysisRecord {
  id: string;
  createdAt: number;
  source: 'upload' | 'scratch';
  sourceLabel: string;
  sourceSnapshot?: MusicAnalysisSourceSnapshot | null;
  // 分析字段（scratch 模式可选）
  analysisModel?: string;
  analysisModelRef?: ModelRef | null;
  analysis?: MusicAnalysisData | null;
  // scratch 模式的创作描述
  creationPrompt?: string;
  // 歌词字段
  rewritePrompt?: string;
  lyricsDraft?: string;
  styleTags?: string[];
  title?: string;
  // 任务追踪
  analyzeTaskId?: string | null;
  pendingRewriteTaskId?: string | null;
  pendingLyricsGenTaskId?: string | null;
  generateTaskId?: string | null;
  // 批量生成
  generateTaskIds?: string[];
  generatedClips?: GeneratedClip[];
  // 音乐编辑动作
  musicEditAction?: SunoMusicEditAction | null;
  // 续写 / Infill
  continueFromClipId?: string | null;
  continueAt?: number | null;
  infillStartS?: number | null;
  infillEndS?: number | null;
  // 歌词版本管理
  lyricsVersions?: LyricsVersion[];
  activeVersionId?: string;
  starred: boolean;
}

export interface LyricsRewriteResult {
  title: string;
  styleTags: string[];
  lyricsDraft: string;
}

export function readModelRef(
  raw?: Partial<ModelRef> | null
): ModelRef | null {
  return createModelRef(raw?.profileId || null, raw?.modelId || null);
}

export function formatMusicAnalysisMarkdown(analysis: MusicAnalysisData): string {
  const normalized = normalizeMusicAnalysisData(analysis);
  const lines = [
    '# 音频分析结果',
    '',
    `**语言：** ${normalized.language || '-'}`,
    `**情绪：** ${normalized.mood || '-'}`,
    `**风格标签：** ${normalized.genreTags.join(', ') || '-'}`,
    `**结构标签：** ${normalized.structure.join(' ') || '-'}`,
  ];

  if (normalized.hook) {
    lines.push(`**Hook：** ${normalized.hook}`);
  }

  lines.push('', '## 摘要', normalized.summary || '-');
  lines.push('', '## 改写建议', normalized.lyricRewriteBrief || '-');

  if (normalized.titleSuggestions.length > 0) {
    lines.push('', '## 标题建议');
    normalized.titleSuggestions.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }

  if (
    normalized.sunoTitle ||
    normalized.sunoStyleTags.length > 0 ||
    normalized.sunoLyricsDraft
  ) {
    lines.push('', '## Suno 生成建议');
    lines.push(`**推荐标题：** ${normalized.sunoTitle || '-'}`);
    lines.push(`**推荐风格：** ${normalized.sunoStyleTags.join(', ') || '-'}`);
    lines.push('', normalized.sunoLyricsDraft || '-');
  }

  return lines.join('\n');
}

export function formatLyricsMarkdown(data: {
  title?: string;
  styleTags?: string[];
  lyricsDraft?: string;
}): string {
  const title = String(data.title || '').trim() || '未命名歌曲';
  const tags = (data.styleTags || []).filter(Boolean);
  const lyrics = String(data.lyricsDraft || '').trim();

  return [
    `# ${title}`,
    '',
    `标签: ${tags.join(', ') || '-'}`,
    '',
    lyrics || '暂无歌词',
  ].join('\n');
}
