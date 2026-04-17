/**
 * 爆款MV生成器 - 任务同步
 */

import type { Task } from '../../types/task.types';
import { TaskType } from '../../types/task.types';
import type { MVRecord, VideoShot } from './types';
import type { GeneratedClip } from '../music-analyzer/types';
import { extractClipsFromTask } from '../music-analyzer/task-sync';
import { addRecord, loadRecords, updateRecord } from './storage';
import { addStoryboardVersionToRecord, createStoryboardVersion } from './utils';

// ── 分镜规划任务 ──

function getMVCreatorAction(task: Task): 'storyboard' | null {
  const action = (task.params as { mvCreatorAction?: unknown }).mvCreatorAction;
  return action === 'storyboard' ? action : null;
}

export function isMVCreatorTask(task: Task): boolean {
  return getMVCreatorAction(task) !== null;
}

function parseStoryboardShots(task: Task): VideoShot[] {
  const chatResponse = String(task.result?.chatResponse || '').trim();
  if (!chatResponse) throw new Error('分镜任务缺少结果内容');

  const jsonMatch = chatResponse.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('响应中未找到有效 JSON 数组');

  const shots = JSON.parse(jsonMatch[0]) as VideoShot[];
  return shots.map((s, i) => ({
    ...s,
    id: s.id || `shot_${i + 1}`,
  }));
}

export async function syncMVStoryboardTask(task: Task): Promise<{
  records: MVRecord[];
  record: MVRecord;
} | null> {
  if (task.status !== 'completed' || getMVCreatorAction(task) !== 'storyboard') {
    return null;
  }

  const recordId = String(
    (task.params as { mvCreatorRecordId?: unknown }).mvCreatorRecordId || ''
  ).trim();
  if (!recordId) return null;

  const records = await loadRecords();
  const target = records.find(r => r.id === recordId);
  if (!target || target.pendingStoryboardTaskId !== task.id) return null;

  const shots = parseStoryboardShots(task);
  const versionCount = (target.storyboardVersions || []).length;
  const version = createStoryboardVersion(
    shots,
    `AI 分镜 #${versionCount + 1}`,
    (task.params as { prompt?: string }).prompt
  );
  const versionPatch = addStoryboardVersionToRecord(target, version);

  const nextRecords = await updateRecord(recordId, {
    editedShots: shots,
    pendingStoryboardTaskId: null,
    ...versionPatch,
  });
  const updatedRecord = nextRecords.find(r => r.id === recordId) || {
    ...target,
    editedShots: shots,
    pendingStoryboardTaskId: null,
    ...versionPatch,
  } as MVRecord;

  return { records: nextRecords, record: updatedRecord };
}

// ── 音乐生成任务 ──

export function getMVMusicRecordId(task: Task): string | null {
  if (task.type !== TaskType.AUDIO) return null;
  const batchId = (task.params as { batchId?: string }).batchId;
  if (!batchId || !batchId.startsWith('mv_')) return null;
  // batchId: mv_{recordId}_music_{index}
  const rest = batchId.slice(3);
  const musicIdx = rest.indexOf('_music_');
  return musicIdx > 0 ? rest.slice(0, musicIdx) : null;
}

export async function syncMVMusicTask(
  task: Task,
  recordId: string
): Promise<{ records: MVRecord[]; record: MVRecord } | null> {
  if (task.type !== TaskType.AUDIO || task.status !== 'completed') return null;

  const clips = extractClipsFromTask(task);
  if (clips.length === 0) return null;

  const records = await loadRecords();
  const target = records.find(r => r.id === recordId);
  if (!target) return null;

  const existingClips = target.generatedClips || [];
  const mergeKey = (clip: GeneratedClip): string => {
    const clipId = String(clip.clipId || '').trim();
    return clipId ? `clip:${clipId}` : `audio:${clip.audioUrl}`;
  };

  const mergedMap = new Map<string, GeneratedClip>();
  existingClips.forEach(clip => mergedMap.set(mergeKey(clip), clip));

  let changed = false;
  clips.forEach(clip => {
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
  const nextRecords = await updateRecord(recordId, { generatedClips: mergedClips });
  const updatedRecord = nextRecords.find(r => r.id === recordId) || {
    ...target,
    generatedClips: mergedClips,
  } as MVRecord;

  return { records: nextRecords, record: updatedRecord };
}
