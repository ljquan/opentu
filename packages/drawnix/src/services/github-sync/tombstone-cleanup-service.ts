/**
 * Tombstone 清理服务
 * 定期清理过期的软删除记录和对应的远程文件
 */

import { logDebug, logError } from './sync-log-service';
import { gitHubApiService } from './github-api-service';
import { SYNC_FILES, type SyncManifest } from './types';

/** Tombstone 保留天数（30天） */
const TOMBSTONE_RETENTION_DAYS = 30;

/**
 * 清理过期的 tombstone 记录和对应的远程文件
 */
export async function cleanupExpiredTombstones(
  manifest: SyncManifest,
  gistId: string
): Promise<{
  success: boolean;
  cleanedCount: number;
  deletedFiles: string[];
  errors: string[];
}> {
  const result = {
    success: false,
    cleanedCount: 0,
    deletedFiles: [] as string[],
    errors: [] as string[],
  };

  try {
    const now = Date.now();
    const expiryTime = now - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    // 找出过期的 tombstone
    const expiredBoardIds: string[] = [];
    const filesToDelete: string[] = [];

    for (const [boardId, boardInfo] of Object.entries(manifest.boards)) {
      if (boardInfo.deletedAt && boardInfo.deletedAt < expiryTime) {
        expiredBoardIds.push(boardId);
        filesToDelete.push(SYNC_FILES.boardFile(boardId));
      }
    }

    if (expiredBoardIds.length === 0) {
      logDebug('[TombstoneCleanup] No expired tombstones found');
      result.success = true;
      return result;
    }

    logDebug('[TombstoneCleanup] Found expired tombstones', {
      expiredBoardCount: expiredBoardIds.length,
    });

    // 删除远程文件
    if (filesToDelete.length > 0) {
      try {
        await gitHubApiService.deleteGistFiles(filesToDelete, gistId);
        result.deletedFiles = filesToDelete;
        logDebug('[TombstoneCleanup] Deleted remote files', {
          deletedFileCount: filesToDelete.length,
        });
      } catch (error) {
        const errorMsg = `删除远程文件失败: ${error instanceof Error ? error.message : '未知错误'}`;
        result.errors.push(errorMsg);
        logError(
          '[TombstoneCleanup] Failed to delete remote files',
          error instanceof Error ? error : undefined,
          {
            errorMsg,
            filesToDelete,
          }
        );
      }
    }

    // 从 manifest 中移除过期的 tombstone 记录
    const updatedManifest = { ...manifest };
    for (const boardId of expiredBoardIds) {
      delete updatedManifest.boards[boardId];
      result.cleanedCount++;
    }

    result.success = result.errors.length === 0;
    logDebug('[TombstoneCleanup] Cleanup complete', {
      cleaned: result.cleanedCount,
      deleted: result.deletedFiles.length,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    result.errors.push(`清理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    logError(
      '[TombstoneCleanup] Cleanup failed',
      error instanceof Error ? error : undefined
    );
    return result;
  }
}
