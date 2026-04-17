/**
 * Backup Part Manager
 * 主应用基于共享分片核心做轻量适配。
 */

import JSZip from 'jszip';
import type { BackupManifest, ExportResult } from './types';
import {
  PART_SIZE_THRESHOLD,
  SharedBackupPartManager,
} from '../../../../../apps/web/public/sw-debug/shared/backup-part-manager-core.js';

export { PART_SIZE_THRESHOLD };

export class BackupPartManager extends SharedBackupPartManager {
  constructor(baseFilename: string, backupId: string) {
    super(baseFilename, backupId, {
      source: 'app',
      revokeDelayMs: 1200,
      interPartPauseMs: 500,
      finalPartPauseMs: 700,
      preserveAssetEntryDate: true,
      ZipCtor: JSZip,
    });
  }

  override finalizeAll(manifest: BackupManifest): Promise<ExportResult> {
    return super.finalizeAll(manifest) as Promise<ExportResult>;
  }
}
