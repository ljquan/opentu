export const PART_SIZE_THRESHOLD: number;

export class SharedBackupPartManager {
  baseFilename: string;
  backupId: string;
  partIndex: number;
  currentZip: any;
  currentSize: number;
  downloadedParts: Array<{ filename: string; size: number }>;
  part1Zip: any;

  constructor(baseFilename: string, backupId: string, options?: {
    source?: string;
    revokeDelayMs?: number;
    interPartPauseMs?: number;
    finalPartPauseMs?: number;
    preserveAssetEntryDate?: boolean;
    downloadBlob?: (blob: Blob, filename: string, revokeDelayMs?: number) => Promise<void>;
    ZipCtor?: new () => any;
  });

  addFile(path: string, content: string | object): void;
  addAssetBlob(
    path: string,
    blob: Blob,
    metaPath: string,
    metaContent: string | object,
    createdAt?: number
  ): Promise<void>;
  finalizePart(): Promise<void>;
  startNewPart(): void;
  finalizeAll(manifest: any): Promise<{
    files: Array<{ filename: string; size: number }>;
    totalParts: number;
    stats?: any;
  }>;
}
