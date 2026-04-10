/**
 * 视频拆解器持久化存储
 *
 * 基于 kvStorageService（IndexedDB）存储分析历史记录。
 * 最多保存 50 条，超出时删除最早的非收藏记录。
 */

import { kvStorageService } from '../../services/kv-storage-service';
import type { AnalysisRecord } from './types';

const STORAGE_KEY = 'video-analyzer:records';
const MAX_RECORDS = 50;

export async function loadRecords(): Promise<AnalysisRecord[]> {
  const records = await kvStorageService.get<AnalysisRecord[]>(STORAGE_KEY);
  return records || [];
}

export async function saveRecords(records: AnalysisRecord[]): Promise<void> {
  await kvStorageService.set(STORAGE_KEY, records);
}

export async function addRecord(record: AnalysisRecord): Promise<AnalysisRecord[]> {
  const records = await loadRecords();
  records.unshift(record);

  // 超出限制时删除最早的非收藏记录
  while (records.length > MAX_RECORDS) {
    let idx = -1;
    for (let i = records.length - 1; i >= 0; i--) {
      if (!records[i].starred) { idx = i; break; }
    }
    if (idx === -1) break;
    records.splice(idx, 1);
  }

  await saveRecords(records);
  return records;
}

export async function updateRecord(
  id: string,
  patch: Partial<AnalysisRecord>
): Promise<AnalysisRecord[]> {
  const records = await loadRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...patch };
    await saveRecords(records);
  }
  return records;
}

export async function deleteRecord(id: string): Promise<AnalysisRecord[]> {
  const records = await loadRecords();
  const filtered = records.filter(r => r.id !== id);
  await saveRecords(filtered);
  return filtered;
}
