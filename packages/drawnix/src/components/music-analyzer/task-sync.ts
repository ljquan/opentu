import type { Task } from '../../types/task.types';
import { TaskType } from '../../types/task.types';
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
import {
  normalizeMusicAnalysisData,
  type MusicAnalysisData,
} from '../../services/music-analysis-service';

type MusicAnalyzerTaskAction = 'analyze' | 'rewrite' | 'lyrics-gen';

function getTaskAction(task: Task): MusicAnalyzerTaskAction | null {
  const action = (task.params as { musicAnalyzerAction?: unknown }).musicAnalyzerAction;
  return action === 'analyze' || action === 'rewrite' || action === 'lyrics-gen' ? action : null;
}

function getTaskChatResponse(task: Task): string {
  return String(task.result?.chatResponse || '').trim();
}

function parseAnalysisResult(task: Task): MusicAnalysisData {
  const structured = task.result?.analysisData;
  if (structured && typeof structured === 'object') {
    return normalizeMusicAnalysisData(structured);
  }

  const raw = getTaskChatResponse(task);
  if (!raw) {
    throw new Error('分析任务缺少结果内容');
  }
  return normalizeMusicAnalysisData(JSON.parse(raw));
}

function getTaskSourceSnapshot(task: Task): MusicAnalysisSourceSnapshot | null {
  const snapshot = (task.params as { musicAnalyzerSourceSnapshot?: unknown })
    .musicAnalyzerSourceSnapshot as MusicAnalysisSourceSnapshot | undefined;
  return snapshot?.type === 'upload' ? snapshot : null;
}

function getStructuredRewriteResult(task: Task): LyricsRewriteResult | null {
  const structured = task.result?.analysisData as Partial<LyricsRewriteResult> | undefined;
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
      ? structured.styleTags.map((item) => String(item || '').trim()).filter(Boolean)
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
      (task.params as { musicAnalyzerSourceLabel?: unknown }).musicAnalyzerSourceLabel ||
        snapshot?.fileName ||
        '本地音频'
    ).trim();

    const record: MusicAnalysisRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      source: 'upload',
      sourceLabel,
      sourceSnapshot: snapshot,
      analysisModel: String(task.params.model || ''),
      analysisModelRef:
        (task.params as { modelRef?: MusicAnalysisRecord['analysisModelRef'] }).modelRef || null,
      analysis,
      styleTags:
        analysis.sunoStyleTags.length > 0 ? analysis.sunoStyleTags : analysis.genreTags,
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
    const recordId = String(
      (task.params as { musicAnalyzerRecordId?: unknown }).musicAnalyzerRecordId || ''
    ).trim();
    if (!recordId) return null;

    const records = await loadRecords();
    const target = records.find((record) => record.id === recordId);
    if (!target || target.pendingLyricsGenTaskId !== task.id) return null;

    const lyricsResult = parseLyricsGenResult(task);
    const nextTitle = lyricsResult?.title || target.title || '';
    const nextStyleTags =
      lyricsResult && lyricsResult.styleTags.length > 0
        ? lyricsResult.styleTags
        : target.styleTags || [];
    const nextLyricsDraft = lyricsResult?.lyricsDraft || target.lyricsDraft || '';
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

    const nextRecords = await updateRecord(recordId, {
      title: nextTitle,
      styleTags: nextStyleTags,
      lyricsDraft: nextLyricsDraft,
      ...versionPatch,
      pendingLyricsGenTaskId: null,
    });
    const updatedRecord =
      nextRecords.find((record) => record.id === recordId) ||
      ({
        ...target,
        title: nextTitle,
        styleTags: nextStyleTags,
        lyricsDraft: nextLyricsDraft,
        ...versionPatch,
        pendingLyricsGenTaskId: null,
      } as MusicAnalysisRecord);

    return { records: nextRecords, record: updatedRecord };
  }

  const recordId = String(
    (task.params as { musicAnalyzerRecordId?: unknown }).musicAnalyzerRecordId || ''
  ).trim();
  if (!recordId) {
    return null;
  }

  const records = await loadRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target || target.pendingRewriteTaskId !== task.id) {
    return null;
  }

  const rewriteResult = getStructuredRewriteResult(task) || parseLyricsRewriteResult(getTaskChatResponse(task));

  // 创建歌词版本快照
  const versionCount = (target.lyricsVersions || []).length;
  const version = createLyricsVersion(
    {
      ...target,
      title: rewriteResult.title || target.title,
      styleTags: rewriteResult.styleTags.length > 0 ? rewriteResult.styleTags : target.styleTags,
      lyricsDraft: rewriteResult.lyricsDraft || target.lyricsDraft,
    },
    `AI 改写 #${versionCount + 1}`,
    target.rewritePrompt
  );
  const versionPatch = addLyricsVersionToRecord(target, version);

  const nextRecords = await updateRecord(recordId, {
    title: rewriteResult.title || target.title,
    styleTags: rewriteResult.styleTags.length > 0 ? rewriteResult.styleTags : target.styleTags,
    lyricsDraft: rewriteResult.lyricsDraft || target.lyricsDraft,
    pendingRewriteTaskId: null,
    ...versionPatch,
  });
  const updatedRecord =
    nextRecords.find((record) => record.id === recordId) ||
    ({
      ...target,
      title: rewriteResult.title || target.title,
      styleTags: rewriteResult.styleTags.length > 0 ? rewriteResult.styleTags : target.styleTags,
      lyricsDraft: rewriteResult.lyricsDraft || target.lyricsDraft,
      pendingRewriteTaskId: null,
    } as MusicAnalysisRecord);

  return { records: nextRecords, record: updatedRecord };
}

/** 从 Suno 歌词生成任务结果中提取歌词 */
function parseLyricsGenResult(task: Task): LyricsRewriteResult | null {
  const result = task.result;
  if (!result) return null;

  const structured = getStructuredRewriteResult(task);
  if (structured) {
    return structured;
  }

  const rawChatResponse = getTaskChatResponse(task);
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
  if (task.type !== TaskType.AUDIO || task.status !== 'completed' || !task.result) {
    return [];
  }

  const clips: GeneratedClip[] = [];
  const result = task.result;

  // Suno 返回的 clips 数组（AudioClipResult[]）
  if (Array.isArray(result.clips)) {
    for (const clip of result.clips) {
      if (clip.audioUrl) {
        clips.push({
          clipId: clip.clipId || clip.id || '',
          audioUrl: clip.audioUrl,
          imageUrl: clip.imageUrl || clip.imageLargeUrl,
          title: clip.title,
          duration: clip.duration ?? null,
          taskId: result.providerTaskId || task.remoteId || task.id,
        });
      }
    }
  }

  // 单个 url 结果
  if (clips.length === 0 && result.url) {
    clips.push({
      clipId: result.primaryClipId || '',
      audioUrl: result.url,
      imageUrl: result.previewImageUrl,
      title: result.title,
      duration: result.duration ?? null,
      taskId: result.providerTaskId || task.remoteId || task.id,
    });
  }

  return clips;
}

/** 同步批量生成任务完成 → 回填 generatedClips */
export async function syncMusicGenerationTask(
  task: Task,
  recordId: string
): Promise<{ records: MusicAnalysisRecord[]; record: MusicAnalysisRecord } | null> {
  if (task.type !== TaskType.AUDIO || task.status !== 'completed') return null;

  const clips = extractClipsFromTask(task);
  if (clips.length === 0) return null;

  const records = await loadRecords();
  const target = records.find((r) => r.id === recordId);
  if (!target) return null;

  const existingClips = target.generatedClips || [];
  const mergeKey = (clip: GeneratedClip): string => {
    const clipId = String(clip.clipId || '').trim();
    if (clipId) {
      return `clip:${clipId}`;
    }
    return `audio:${clip.audioUrl}`;
  };

  const mergedMap = new Map<string, GeneratedClip>();
  existingClips.forEach((clip) => {
    mergedMap.set(mergeKey(clip), clip);
  });

  let changed = false;
  clips.forEach((clip) => {
    const key = mergeKey(clip);
    const existing = mergedMap.get(key);
    if (!existing) {
      mergedMap.set(key, clip);
      changed = true;
      return;
    }

    const nextClip: GeneratedClip = {
      ...existing,
      ...clip,
      taskId: clip.taskId || existing.taskId,
      clipId: clip.clipId || existing.clipId,
      audioUrl: clip.audioUrl || existing.audioUrl,
    };
    if (JSON.stringify(existing) !== JSON.stringify(nextClip)) {
      mergedMap.set(key, nextClip);
      changed = true;
    }
  });
  if (!changed) return { records, record: target };

  const mergedClips = Array.from(mergedMap.values());

  const nextRecords = await updateRecord(recordId, {
    generatedClips: mergedClips,
  });
  const updatedRecord = nextRecords.find((r) => r.id === recordId) || {
    ...target,
    generatedClips: mergedClips,
  } as MusicAnalysisRecord;

  return { records: nextRecords, record: updatedRecord };
}

export function isMusicAnalyzerTask(task: Task): boolean {
  return getTaskAction(task) !== null;
}

/** 检查 AUDIO 任务是否属于某个音乐分析记录的批量生成 */
export function getMusicGenerationRecordId(task: Task): string | null {
  if (task.type !== TaskType.AUDIO) return null;
  const batchId = (task.params as { batchId?: string }).batchId;
  if (!batchId || !batchId.startsWith('ma_')) return null;
  // batchId 格式: ma_{recordId}_gen_{index} 或 ma_{recordId}_cont_{clipId}_{at}
  const rest = batchId.slice(3); // 去掉 'ma_'
  const underscoreIdx = rest.indexOf('_');
  return underscoreIdx > 0 ? rest.slice(0, underscoreIdx) : rest;
}
