import type { NativeSunoResult } from '../../services/suno-native';
import { generateUUID } from '../../utils/runtime-helpers';
import type { Task } from '../../types/task.types';
import { TaskType } from '../../types/task.types';
import type { SunoV2Result } from '../../services/suno-v2';
import type {
  GeneratedClip,
  LyricsRewriteResult,
  MusicAnalysisRecord,
  MusicAnalysisSourceSnapshot,
} from './types';
import { addRecord, loadRecords, updateRecord } from './storage';
import {
  addLyricsVersionToRecord,
  createLyricsVersion,
  parseLyricsRewriteResult,
} from './utils';
import { mergeMusicBriefStyleTags, normalizeMusicBrief } from './music-brief';
import {
  extractBatchRecordId,
  extractGeneratedClipsFromAudioTask,
  parseStructuredOrChatJson,
  readTaskAction,
  readTaskChatResponse,
  readTaskStringParam,
  syncGeneratedClipsForRecord,
  updateWorkflowRecord,
} from '../shared/workflow';
import {
  normalizeMusicAnalysisData,
  type MusicAnalysisData,
} from '../../services/music-analysis-service';

type MusicAnalyzerTaskAction = 'analyze' | 'rewrite' | 'lyrics-gen';

function getTaskAction(task: Task): MusicAnalyzerTaskAction | null {
  return readTaskAction(task, 'musicAnalyzerAction', [
    'analyze',
    'rewrite',
    'lyrics-gen',
  ] as const);
}

function parseAnalysisResult(task: Task): MusicAnalysisData {
  return parseStructuredOrChatJson(task, {
    missingMessage: '分析任务缺少结果内容',
    fromStructured: (structured) => normalizeMusicAnalysisData(structured),
  });
}

function getTaskSourceSnapshot(task: Task): MusicAnalysisSourceSnapshot | null {
  const snapshot = (task.params as { musicAnalyzerSourceSnapshot?: unknown })
    .musicAnalyzerSourceSnapshot as MusicAnalysisSourceSnapshot | undefined;
  return snapshot?.type === 'upload' ? snapshot : null;
}

function getTaskMusicBrief(task: Task): MusicAnalysisRecord['musicBrief'] {
  return normalizeMusicBrief(
    (task.params as { musicAnalyzerMusicBrief?: unknown })
      .musicAnalyzerMusicBrief as MusicAnalysisRecord['musicBrief'] | undefined
  );
}

function getStructuredRewriteResult(task: Task): LyricsRewriteResult | null {
  const structured = task.result?.analysisData as
    | Partial<LyricsRewriteResult>
    | undefined;
  if (!structured || typeof structured !== 'object') {
    return null;
  }

  if (
    typeof structured.lyricsDraft !== 'string' &&
    typeof structured.title !== 'string' &&
    !Array.isArray(structured.styleTags)
  ) {
    return null;
  }

  return {
    title: String(structured.title || '').trim(),
    styleTags: Array.isArray(structured.styleTags)
      ? structured.styleTags
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [],
    lyricsDraft: String(structured.lyricsDraft || '').trim(),
  };
}

export async function syncMusicAnalyzerTask(task: Task): Promise<{
  records: MusicAnalysisRecord[];
  record: MusicAnalysisRecord;
} | null> {
  if (task.status !== 'completed') {
    return null;
  }

  const action = getTaskAction(task);
  if (!action) {
    return null;
  }

  if (action === 'analyze') {
    const records = await loadRecords();
    const existing = records.find((record) => record.analyzeTaskId === task.id);
    if (existing) {
      return { records, record: existing };
    }

    const analysis = parseAnalysisResult(task);
    const snapshot = getTaskSourceSnapshot(task);
    const sourceLabel = String(
      (task.params as { musicAnalyzerSourceLabel?: unknown })
        .musicAnalyzerSourceLabel ||
        snapshot?.fileName ||
        '本地音频'
    ).trim();
    const musicBrief = getTaskMusicBrief(task);

    const record: MusicAnalysisRecord = {
      id: generateUUID(),
      createdAt: Date.now(),
      source: 'upload',
      sourceLabel,
      sourceSnapshot: snapshot,
      analysisModel: String(task.params.model || ''),
      analysisModelRef:
        (task.params as { modelRef?: MusicAnalysisRecord['analysisModelRef'] })
          .modelRef || null,
      analysis,
      musicBrief,
      styleTags: mergeMusicBriefStyleTags(
        analysis.sunoStyleTags.length > 0
          ? analysis.sunoStyleTags
          : analysis.genreTags,
        musicBrief
      ),
      title:
        analysis.sunoTitle ||
        analysis.titleSuggestions[0] ||
        sourceLabel.replace(/\.[^.]+$/, ''),
      lyricsDraft: analysis.sunoLyricsDraft || '',
      analyzeTaskId: task.id,
      starred: false,
    };

    const nextRecords = await addRecord(record);
    return { records: nextRecords, record };
  }

  // lyrics-gen: Suno 歌词生成或文本草稿生成完成 → 回填到 record
  if (action === 'lyrics-gen') {
    const recordId = readTaskStringParam(task, 'musicAnalyzerRecordId');
    if (!recordId) return null;

    const records = await loadRecords();
    const target = records.find((record) => record.id === recordId);
    if (!target || target.pendingLyricsGenTaskId !== task.id) return null;

    const v2 = (task.result?.analysisData as { sunoV2?: SunoV2Result } | undefined)?.sunoV2;
    if (v2) return updateWorkflowRecord(target, {
      ...sunoV2RecordPatch(target, task, v2), pendingLyricsGenTaskId: null,
    }, updateRecord);

    const lyricsResult = parseLyricsGenResult(task);
    const nextTitle = lyricsResult?.title || target.title || '';
    const nextStyleTags =
      lyricsResult && lyricsResult.styleTags.length > 0
        ? mergeMusicBriefStyleTags(lyricsResult.styleTags, target.musicBrief)
        : mergeMusicBriefStyleTags(target.styleTags || [], target.musicBrief);
    const nextLyricsDraft =
      lyricsResult?.lyricsDraft || target.lyricsDraft || '';
    const versionPatch = lyricsResult
      ? addLyricsVersionToRecord(
          {
            ...target,
            title: nextTitle,
            styleTags: nextStyleTags,
            lyricsDraft: nextLyricsDraft,
          },
          createLyricsVersion(
            {
              ...target,
              title: nextTitle,
              styleTags: nextStyleTags,
              lyricsDraft: nextLyricsDraft,
            },
            task.type === TaskType.CHAT ? 'AI 草稿' : 'Suno 歌词',
            target.creationPrompt
          )
        )
      : {};

    return updateWorkflowRecord(
      target,
      {
        title: nextTitle,
        styleTags: nextStyleTags,
        lyricsDraft: nextLyricsDraft,
        ...versionPatch,
        pendingLyricsGenTaskId: null,
      },
      updateRecord
    );
  }

  const recordId = readTaskStringParam(task, 'musicAnalyzerRecordId');
  if (!recordId) {
    return null;
  }

  const records = await loadRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target || target.pendingRewriteTaskId !== task.id) {
    return null;
  }

  const rewriteResult =
    getStructuredRewriteResult(task) ||
    parseLyricsRewriteResult(readTaskChatResponse(task));
  const nextRewriteTitle = rewriteResult.title || target.title;
  const nextRewriteStyleTags =
    rewriteResult.styleTags.length > 0
      ? mergeMusicBriefStyleTags(rewriteResult.styleTags, target.musicBrief)
      : mergeMusicBriefStyleTags(target.styleTags, target.musicBrief);
  const nextRewriteLyricsDraft =
    rewriteResult.lyricsDraft || target.lyricsDraft;

  // 创建歌词版本快照
  const versionCount = (target.lyricsVersions || []).length;
  const version = createLyricsVersion(
    {
      ...target,
      title: nextRewriteTitle,
      styleTags: nextRewriteStyleTags,
      lyricsDraft: nextRewriteLyricsDraft,
    },
    `AI 改写 #${versionCount + 1}`,
    target.rewritePrompt
  );
  const versionPatch = addLyricsVersionToRecord(target, version);

  return updateWorkflowRecord(
    target,
    {
      title: nextRewriteTitle,
      styleTags: nextRewriteStyleTags,
      lyricsDraft: nextRewriteLyricsDraft,
      pendingRewriteTaskId: null,
      ...versionPatch,
    },
    updateRecord
  );
}

/** 从 Suno 歌词生成任务结果中提取歌词 */
function parseLyricsGenResult(task: Task): LyricsRewriteResult | null {
  const result = task.result;
  if (!result) return null;

  const structured = getStructuredRewriteResult(task);
  if (structured) {
    return structured;
  }

  const rawChatResponse = readTaskChatResponse(task);
  if (rawChatResponse) {
    try {
      return parseLyricsRewriteResult(rawChatResponse);
    } catch {
      // fall through to Suno-specific fields
    }
  }

  // Suno lyrics API 返回 lyricsText + lyricsTitle + lyricsTags
  const text = result.lyricsText || '';
  const title = result.lyricsTitle || result.title || '';
  const tags = result.lyricsTags;

  if (!text && !title) return null;

  const styleTags = Array.isArray(tags)
    ? tags.map((t) => String(t || '').trim()).filter(Boolean)
    : [];

  return {
    title: String(title).trim(),
    styleTags,
    lyricsDraft: String(text).trim(),
  };
}

/** 从已完成的 AUDIO 任务中提取 GeneratedClip */
export function extractClipsFromTask(task: Task): GeneratedClip[] {
  return extractGeneratedClipsFromAudioTask(task) as GeneratedClip[];
}

/** 同步批量生成任务完成 → 回填 generatedClips */
function sunoV2RecordPatch(target: MusicAnalysisRecord, task: Task, v2: SunoV2Result): Partial<MusicAnalysisRecord> {
  const patch: Partial<MusicAnalysisRecord> = {
    sunoV2Results: [...(target.sunoV2Results || []), { taskId: task.id, result: v2 }],
  };
  if (v2.lyrics.length) {
    let next = target;
    for (const lyrics of [...v2.lyrics].reverse()) {
      next = { ...next, ...addLyricsVersionToRecord(next, createLyricsVersion({
        ...next, title: lyrics.title || target.title,
        lyricsDraft: lyrics.text,
        styleTags: mergeMusicBriefStyleTags(lyrics.tags || target.styleTags || [], target.musicBrief),
      }, 'Suno v2 歌词', task.params.prompt)) };
    }
    patch.lyricsVersions = next.lyricsVersions;
    patch.activeVersionId = next.activeVersionId;
    patch.lyricsDraft = next.lyricsDraft;
    patch.title = next.title;
    patch.styleTags = next.styleTags;
  }
  return patch;
}

export async function syncMusicGenerationTask(
  task: Task,
  recordId: string
): Promise<{
  records: MusicAnalysisRecord[];
  record: MusicAnalysisRecord;
} | null> {
  const native = (task.result?.analysisData as { sunoNative?: NativeSunoResult } | undefined)?.sunoNative;
  if (task.status === 'completed' && native) {
    const records = await loadRecords(); const target = records.find((record) => record.id === recordId);
    if (!target) return null;
    if (target.sunoNativeResults?.some((item) => item.taskId === task.id)) return { records, record: target };
    const patch: Partial<MusicAnalysisRecord> = {
      sunoNativeResults: [...(target.sunoNativeResults || []), { taskId: task.id, result: native }],
    };
    if (native.lyrics.length) {
      let next = target;
      for (const lyrics of [...native.lyrics].reverse()) {
        next = { ...next, ...addLyricsVersionToRecord(next, createLyricsVersion({
          ...next, title: lyrics.title || target.title, lyricsDraft: lyrics.text,
        }, 'Suno 原生歌词', task.params.prompt)) };
      }
      Object.assign(patch, { lyricsVersions: next.lyricsVersions, activeVersionId: next.activeVersionId,
        lyricsDraft: next.lyricsDraft, title: next.title });
    }
    return updateWorkflowRecord(target, patch, updateRecord);
  }
  const v2 = (task.result?.analysisData as { sunoV2?: SunoV2Result } | undefined)?.sunoV2;
  if (task.status === 'completed' && v2) {
    const records = await loadRecords();
    const target = records.find((record) => record.id === recordId);
    if (!target) return null;
    const previous = target.sunoV2Results || [];
    if (previous.some((item) => item.taskId === task.id)) return { records, record: target };
    return updateWorkflowRecord(target, sunoV2RecordPatch(target, task, v2), updateRecord);
  }
  return syncGeneratedClipsForRecord(task, recordId, {
    loadRecords,
    updateRecord,
  });
}

export function isMusicAnalyzerTask(task: Task): boolean {
  return getTaskAction(task) !== null;
}

/** 检查 AUDIO 任务是否属于某个音乐分析记录的批量生成 */
export function getMusicGenerationRecordId(task: Task): string | null {
  if (task.type !== TaskType.AUDIO) return null;
  const batchId = (task.params as { batchId?: string }).batchId;
  if (!batchId) return null;
  return extractBatchRecordId(batchId, { prefix: 'ma_' });
}
