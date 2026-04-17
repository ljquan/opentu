import { kvStorageService } from '../../services/kv-storage-service';
import { unifiedCacheService } from '../../services/unified-cache-service';
import { normalizeMusicAnalysisData } from '../../services/music-analysis-service';
import type { MusicAnalysisRecord } from './types';

const STORAGE_KEY = 'music-analyzer:records';
const MAX_RECORDS = 50;

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeRecord(record: MusicAnalysisRecord): MusicAnalysisRecord {
  return {
    ...record,
    analysis: record.analysis ? normalizeMusicAnalysisData(record.analysis) : record.analysis,
    styleTags: record.styleTags ? normalizeStringList(record.styleTags) : record.styleTags,
  };
}

export async function loadRecords(): Promise<MusicAnalysisRecord[]> {
  const records = await kvStorageService.get<MusicAnalysisRecord[]>(STORAGE_KEY);
  return Array.isArray(records) ? records.map(normalizeRecord) : [];
}

export async function saveRecords(records: MusicAnalysisRecord[]): Promise<void> {
  await kvStorageService.set(STORAGE_KEY, records);
}

export async function addRecord(record: MusicAnalysisRecord): Promise<MusicAnalysisRecord[]> {
  const records = await loadRecords();
  records.unshift(record);

  while (records.length > MAX_RECORDS) {
    let idx = -1;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      if (!records[i].starred) {
        idx = i;
        break;
      }
    }
    if (idx === -1) break;
    const [removed] = records.splice(idx, 1);
    if (removed?.sourceSnapshot?.cacheUrl) {
      void unifiedCacheService
        .deleteCache(removed.sourceSnapshot.cacheUrl)
        .catch((error) => {
          console.warn('[MusicAnalyzer] Failed to delete pruned audio cache:', error);
        });
    }
  }

  await saveRecords(records);
  return records;
}

export async function updateRecord(
  id: string,
  patch: Partial<MusicAnalysisRecord>
): Promise<MusicAnalysisRecord[]> {
  const records = await loadRecords();
  const index = records.findIndex((item) => item.id === id);
  if (index >= 0) {
    records[index] = { ...records[index], ...patch };
    await saveRecords(records);
  }
  return records;
}

export async function deleteRecord(id: string): Promise<MusicAnalysisRecord[]> {
  const records = await loadRecords();
  const target = records.find((item) => item.id === id);
  const filtered = records.filter((item) => item.id !== id);
  await saveRecords(filtered);
  if (target?.sourceSnapshot?.cacheUrl) {
    void unifiedCacheService.deleteCache(target.sourceSnapshot.cacheUrl).catch((error) => {
      console.warn('[MusicAnalyzer] Failed to delete audio cache:', error);
    });
  }
  return filtered;
}
