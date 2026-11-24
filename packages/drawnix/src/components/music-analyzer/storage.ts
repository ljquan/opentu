import { unifiedCacheService } from '../../services/unified-cache-service';
import { normalizeMusicAnalysisData } from '../../services/music-analysis-service';
import {
  addRecordWithCap,
  deleteRecordById,
  loadRecordsByKey,
  saveRecordsByKey,
  updateRecordById,
  type WorkflowRecordStorageOptions,
} from '../shared/workflow/record-storage';
import type { MusicAnalysisRecord } from './types';
import { normalizeMusicBrief } from './music-brief';

const STORAGE_KEY = 'music-analyzer:records';
const MAX_RECORDS = 50;

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeRecord(record: MusicAnalysisRecord): MusicAnalysisRecord {
  return {
    ...record,
    analysis: record.analysis
      ? normalizeMusicAnalysisData(record.analysis)
      : record.analysis,
    musicBrief: normalizeMusicBrief(record.musicBrief),
    styleTags: record.styleTags
      ? normalizeStringList(record.styleTags)
      : record.styleTags,
  };
}

function cleanupRecordAudioCache(record: MusicAnalysisRecord): void {
  if (!record.sourceSnapshot?.cacheUrl) {
    return;
  }

  void unifiedCacheService
    .deleteCache(record.sourceSnapshot.cacheUrl)
    .catch((error) => {
      console.warn('[MusicAnalyzer] Failed to delete audio cache:', error);
    });
}

const storageOptions: WorkflowRecordStorageOptions<MusicAnalysisRecord> = {
  normalizeRecord,
  onPruneRecord: cleanupRecordAudioCache,
  onDeleteRecord: cleanupRecordAudioCache,
};

export async function loadRecords(): Promise<MusicAnalysisRecord[]> {
  return loadRecordsByKey<MusicAnalysisRecord>(STORAGE_KEY, storageOptions);
}

export async function saveRecords(
  records: MusicAnalysisRecord[]
): Promise<void> {
  await saveRecordsByKey(STORAGE_KEY, records, storageOptions);
}

export async function addRecord(
  record: MusicAnalysisRecord
): Promise<MusicAnalysisRecord[]> {
  return addRecordWithCap(STORAGE_KEY, record, MAX_RECORDS, storageOptions);
}

export async function updateRecord(
  id: string,
  patch: Partial<MusicAnalysisRecord>
): Promise<MusicAnalysisRecord[]> {
  return updateRecordById(STORAGE_KEY, id, patch, storageOptions);
}

export async function deleteRecord(id: string): Promise<MusicAnalysisRecord[]> {
  return deleteRecordById(STORAGE_KEY, id, storageOptions);
}
