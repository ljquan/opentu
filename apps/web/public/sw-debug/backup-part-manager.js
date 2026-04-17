/**
 * SW Debug Panel - Backup Part Manager
 * sw-debug 基于共享分片核心做轻量适配。
 */

import {
  PART_SIZE_THRESHOLD,
  SharedBackupPartManager,
} from './shared/backup-part-manager-core.js';

export { PART_SIZE_THRESHOLD };

export class BackupPartManager extends SharedBackupPartManager {
  constructor(baseFilename, backupId) {
    super(baseFilename, backupId, {
      source: 'sw-debug-panel',
      revokeDelayMs: 0,
      interPartPauseMs: 500,
      finalPartPauseMs: 500,
      preserveAssetEntryDate: false,
      ZipCtor: globalThis.JSZip,
    });
  }
}
