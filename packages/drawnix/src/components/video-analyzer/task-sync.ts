import type { Task } from '../../types/task.types';
import type { AnalysisRecord, AnalysisSourceSnapshot, VideoAnalysisData } from './types';
import { addRecord, loadRecords, updateRecord } from './storage';
import { applyRewriteShotUpdates, parseRewriteShotUpdates } from './utils';

type VideoAnalyzerTaskAction = 'analyze' | 'rewrite';

function getTaskAction(task: Task): VideoAnalyzerTaskAction | null {
  const action = (task.params as { videoAnalyzerAction?: unknown }).videoAnalyzerAction;
  return action === 'analyze' || action === 'rewrite' ? action : null;
}

function getTaskChatResponse(task: Task): string {
  return String(task.result?.chatResponse || '').trim();
}

function parseAnalysisResult(task: Task): VideoAnalysisData {
  const structured = task.result?.analysisData;
  if (structured && typeof structured === 'object') {
    return structured as VideoAnalysisData;
  }
  const raw = getTaskChatResponse(task);
  if (!raw) {
    throw new Error('分析任务缺少结果内容');
  }
  return JSON.parse(raw) as VideoAnalysisData;
}

function getTaskSourceSnapshot(task: Task): AnalysisSourceSnapshot | null {
  const snapshot = (task.params as { videoAnalyzerSourceSnapshot?: unknown })
    .videoAnalyzerSourceSnapshot as AnalysisSourceSnapshot | undefined;
  if (snapshot?.type === 'youtube' || snapshot?.type === 'upload') {
    return snapshot;
  }

  const source = (task.params as { videoAnalyzerSource?: unknown }).videoAnalyzerSource;
  const sourceLabel = String(
    (task.params as { videoAnalyzerSourceLabel?: unknown }).videoAnalyzerSourceLabel || ''
  ).trim();
  if (source === 'youtube' && sourceLabel) {
    return { type: 'youtube', youtubeUrl: sourceLabel };
  }

  return null;
}

export async function syncVideoAnalyzerTask(task: Task): Promise<{
  records: AnalysisRecord[];
  record: AnalysisRecord;
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
    const existing = records.find(record => record.analyzeTaskId === task.id);
    if (existing) {
      return { records, record: existing };
    }

    const analysis = parseAnalysisResult(task);
    const source = ((task.params as { videoAnalyzerSource?: unknown }).videoAnalyzerSource === 'upload'
      ? 'upload'
      : 'youtube') as AnalysisRecord['source'];
    const sourceLabel = String(
      (task.params as { videoAnalyzerSourceLabel?: unknown }).videoAnalyzerSourceLabel ||
        (source === 'youtube'
          ? getTaskSourceSnapshot(task)?.type === 'youtube'
            ? getTaskSourceSnapshot(task)?.youtubeUrl
            : ''
          : '本地视频')
    );

    const record: AnalysisRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      source,
      sourceLabel,
      sourceSnapshot: getTaskSourceSnapshot(task),
      model: String(task.params.model || ''),
      modelRef: (task.params as { modelRef?: AnalysisRecord['modelRef'] }).modelRef || null,
      analysis,
      starred: false,
      analyzeTaskId: task.id,
    };

    const nextRecords = await addRecord(record);
    return { records: nextRecords, record };
  }

  const recordId = String(
    (task.params as { videoAnalyzerRecordId?: unknown }).videoAnalyzerRecordId || ''
  ).trim();
  if (!recordId) {
    return null;
  }

  const records = await loadRecords();
  const target = records.find(record => record.id === recordId);
  if (!target || target.pendingRewriteTaskId !== task.id) {
    return null;
  }

  const raw = getTaskChatResponse(task);
  if (!raw) {
    throw new Error('脚本改编任务缺少结果内容');
  }

  const updates = parseRewriteShotUpdates(raw);
  const baseShots = target.editedShots || target.analysis.shots;
  const editedShots = applyRewriteShotUpdates(baseShots, updates);
  const nextRecords = await updateRecord(recordId, {
    editedShots,
    pendingRewriteTaskId: null,
  });
  const updatedRecord =
    nextRecords.find(record => record.id === recordId) ||
    ({ ...target, editedShots, pendingRewriteTaskId: null } as AnalysisRecord);

  return { records: nextRecords, record: updatedRecord };
}

export function isVideoAnalyzerTask(task: Task): boolean {
  return getTaskAction(task) !== null;
}
