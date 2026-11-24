/**
 * 视频拆解器持久化存储
 *
 * 基于共享 workflow record-storage 存储分析历史记录。
 * 最多保存 50 条，超出时删除最早的非收藏记录。
 */

import {
  addRecordWithCap,
  deleteRecordById,
  loadRecordsByKey,
  saveRecordsByKey,
  updateRecordById,
} from '../shared/workflow/record-storage';
import type { AnalysisRecord } from './types';

const STORAGE_KEY = 'video-analyzer:records';
const MAX_RECORDS = 50;

export async function loadRecords(): Promise<AnalysisRecord[]> {
  return loadRecordsByKey<AnalysisRecord>(STORAGE_KEY);
}

export async function saveRecords(records: AnalysisRecord[]): Promise<void> {
  await saveRecordsByKey(STORAGE_KEY, records);
}

export async function addRecord(record: AnalysisRecord): Promise<AnalysisRecord[]> {
  return addRecordWithCap(STORAGE_KEY, record, MAX_RECORDS);
}

export async function updateRecord(
  id: string,
  patch: Partial<AnalysisRecord>
): Promise<AnalysisRecord[]> {
  return updateRecordById(STORAGE_KEY, id, patch);
}

export async function deleteRecord(id: string): Promise<AnalysisRecord[]> {
  return deleteRecordById(STORAGE_KEY, id);
}
