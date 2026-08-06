import {
  addRecordWithCap,
  deleteRecordById,
  loadRecordsByKey,
  saveRecordsByKey,
  updateRecordById,
} from '../shared/workflow/record-storage';
import type { ComicRecord } from './types';
import { stripLargeImageDataFromComicPage } from './utils';

const STORAGE_KEY = 'comic-creator:records';
const MAX_RECORDS = 50;
const LEGACY_DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2-vip';
const DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2';

function normalizeLegacyImageModel(record: ComicRecord): ComicRecord {
  if (
    record.imageModel !== LEGACY_DEFAULT_IMAGE_MODEL_ID ||
    record.imageModelRef?.profileId
  ) {
    return record;
  }

  return {
    ...record,
    imageModel: DEFAULT_IMAGE_MODEL_ID,
    imageModelRef: null,
  };
}

function sanitizeRecord(record: ComicRecord): ComicRecord {
  const normalizedRecord = normalizeLegacyImageModel(record);
  return {
    ...normalizedRecord,
    starred: !!normalizedRecord.starred,
    pages: Array.isArray(normalizedRecord.pages)
      ? normalizedRecord.pages.map(stripLargeImageDataFromComicPage)
      : [],
  };
}

export async function loadRecords(): Promise<ComicRecord[]> {
  return loadRecordsByKey<ComicRecord>(STORAGE_KEY, {
    normalizeRecord: sanitizeRecord,
  });
}

export async function saveRecords(records: ComicRecord[]): Promise<void> {
  await saveRecordsByKey(STORAGE_KEY, records, {
    normalizeRecord: sanitizeRecord,
  });
}

export async function addRecord(record: ComicRecord): Promise<ComicRecord[]> {
  return addRecordWithCap(STORAGE_KEY, record, MAX_RECORDS, {
    normalizeRecord: sanitizeRecord,
  });
}

export async function updateRecord(
  id: string,
  patch: Partial<ComicRecord>
): Promise<ComicRecord[]> {
  return updateRecordById(STORAGE_KEY, id, sanitizeRecordPatch(patch), {
    normalizeRecord: sanitizeRecord,
  });
}

export async function deleteRecord(id: string): Promise<ComicRecord[]> {
  return deleteRecordById(STORAGE_KEY, id, {
    normalizeRecord: sanitizeRecord,
  });
}

function sanitizeRecordPatch(
  patch: Partial<ComicRecord>
): Partial<ComicRecord> {
  if (!patch.pages) {
    return patch;
  }

  return {
    ...patch,
    pages: patch.pages.map(stripLargeImageDataFromComicPage),
  };
}
