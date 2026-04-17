/**
 * 爆款MV生成器 - 持久化存储
 *
 * 基于 kvStorageService（IndexedDB）存储 MV 创作记录。
 * 最多保存 50 条，超出时删除最早的非收藏记录。
 */

import { kvStorageService } from '../../services/kv-storage-service';
import type { MVRecord } from './types';

const STORAGE_KEY = 'mv-creator:records';
const MAX_RECORDS = 50;

export async function loadRecords(): Promise<MVRecord[]> {
  const records = await kvStorageService.get<MVRecord[]>(STORAGE_KEY);
  return Array.isArray(records) ? records : [];
}

export async function saveRecords(records: MVRecord[]): Promise<void> {
  await kvStorageService.set(STORAGE_KEY, records);
}

export async function addRecord(record: MVRecord): Promise<MVRecord[]> {
  const records = await loadRecords();
  records.unshift(record);

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
  patch: Partial<MVRecord>
): Promise<MVRecord[]> {
  const records = await loadRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...patch };
    await saveRecords(records);
  }
  return records;
}

export async function deleteRecord(id: string): Promise<MVRecord[]> {
  const records = await loadRecords();
  const filtered = records.filter(r => r.id !== id);
  await saveRecords(filtered);
  return filtered;
}
