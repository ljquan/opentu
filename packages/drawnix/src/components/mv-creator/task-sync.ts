/**
 * 爆款MV生成器 - 任务同步
 */

import type { Task } from '../../types/task.types';
import { TaskType } from '../../types/task.types';
import type { MVRecord, VideoShot, VideoCharacter } from './types';
import type { GeneratedClip } from '../music-analyzer/types';
import { extractClipsFromTask } from '../music-analyzer/task-sync';
import { addRecord, loadRecords, updateRecord } from './storage';
import { addStoryboardVersionToRecord, createStoryboardVersion } from './utils';
import { parseRewriteShotUpdates, applyRewriteShotUpdates } from '../video-analyzer/utils';

// ── 分镜规划任务 ──

function getMVCreatorAction(task: Task): 'storyboard' | 'rewrite' | null {
  const action = (task.params as { mvCreatorAction?: unknown }).mvCreatorAction;
  return action === 'storyboard' || action === 'rewrite' ? action : null;
}

export function isMVCreatorTask(task: Task): boolean {
  return getMVCreatorAction(task) !== null;
}

function parseStoryboardResult(task: Task): { shots: VideoShot[]; characters: VideoCharacter[] } {
  let chatResponse = String(task.result?.chatResponse || '').trim();
  if (!chatResponse) throw new Error('分镜任务缺少结果内容');

  const codeBlockMatch = chatResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    chatResponse = codeBlockMatch[1].trim();
  }

  // 尝试新格式：{ characters: [...], shots: [...] }
  const objMatch = chatResponse.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (Array.isArray(parsed.shots)) {
        const shots = (parsed.shots as VideoShot[]).map((s, i) => ({
          ...s,
          id: s.id || `shot_${i + 1}`,
        }));
        const characters = Array.isArray(parsed.characters) ? parsed.characters as VideoCharacter[] : [];
        return { shots, characters };
      }
    } catch { /* fall through */ }
  }

  // 纯 JSON 数组
  const arrMatch = chatResponse.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const shots = (JSON.parse(arrMatch[0]) as VideoShot[]).map((s, i) => ({
        ...s,
        id: s.id || `shot_${i + 1}`,
      }));
      return { shots, characters: [] };
    } catch { /* fall through to partial extraction */ }
  }

  // 截断兜底：逐个提取完整的 JSON 对象
  const objects: VideoShot[] = [];
  const characters: VideoCharacter[] = [];
  const objectPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(chatResponse)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && typeof obj === 'object') {
        if (obj.id?.startsWith('char_') && obj.name && obj.description) {
          characters.push(obj as VideoCharacter);
        } else if (obj.id?.startsWith('shot_') || obj.startTime !== undefined) {
          objects.push({ ...obj, id: obj.id || `shot_${objects.length + 1}` } as VideoShot);
        }
      }
    } catch { /* skip */ }
  }

  if (objects.length > 0) return { shots: objects, characters };
  throw new Error('响应中未找到有效 JSON（可能因输出过长被截断）');
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

  const { shots, characters } = parseStoryboardResult(task);
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
    storyboardGeneratedAt: Date.now(),
    ...(characters.length > 0 ? { characters } : {}),
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

// ── 脚本改编任务 ──

export async function syncMVRewriteTask(task: Task): Promise<{
  records: MVRecord[];
  record: MVRecord;
} | null> {
  if (task.status !== 'completed' || getMVCreatorAction(task) !== 'rewrite') {
    return null;
  }

  const recordId = String(
    (task.params as { mvCreatorRecordId?: unknown }).mvCreatorRecordId || ''
  ).trim();
  if (!recordId) return null;

  const records = await loadRecords();
  const target = records.find(r => r.id === recordId);
  if (!target || target.pendingRewriteTaskId !== task.id) return null;

  const chatResponse = String(task.result?.chatResponse || '').trim();
  if (!chatResponse) return null;

  // 尝试解析 { characters, shots } 格式（改编可能同时更新角色）
  let newShots: VideoShot[];
  let updatedCharacters: VideoCharacter[] | null = null;

  const objMatch = chatResponse.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (Array.isArray(parsed.shots)) {
        newShots = parsed.shots.map((s: VideoShot, i: number) => ({
          ...s,
          id: s.id || `shot_${i + 1}`,
        }));
        if (Array.isArray(parsed.characters) && parsed.characters.length > 0) {
          updatedCharacters = parsed.characters as VideoCharacter[];
        }
      } else {
        const updates = parseRewriteShotUpdates(chatResponse);
        const currentShots = target.editedShots || [];
        newShots = applyRewriteShotUpdates(currentShots, updates);
      }
    } catch {
      const updates = parseRewriteShotUpdates(chatResponse);
      const currentShots = target.editedShots || [];
      newShots = applyRewriteShotUpdates(currentShots, updates);
    }
  } else {
    const updates = parseRewriteShotUpdates(chatResponse);
    const currentShots = target.editedShots || [];
    newShots = applyRewriteShotUpdates(currentShots, updates);
  }

  const versionCount = (target.storyboardVersions || []).length;
  const version = createStoryboardVersion(
    newShots,
    `AI 改编 #${versionCount + 1}`,
    (task.params as { prompt?: string }).prompt
  );
  const versionPatch = addStoryboardVersionToRecord(target, version);

  const nextRecords = await updateRecord(recordId, {
    editedShots: newShots,
    pendingRewriteTaskId: null,
    storyboardGeneratedAt: Date.now(),
    ...(updatedCharacters ? { characters: updatedCharacters } : {}),
    ...versionPatch,
  });
  const updatedRecord = nextRecords.find(r => r.id === recordId) || {
    ...target,
    editedShots: newShots,
    pendingRewriteTaskId: null,
    ...(updatedCharacters ? { characters: updatedCharacters } : {}),
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
