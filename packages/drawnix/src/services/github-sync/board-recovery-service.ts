/**
 * 画布恢复服务
 * 用于从远程 Gist 中恢复丢失的画布元数据
 */

import { logDebug, logError } from './sync-log-service';
import { gitHubApiService } from './github-api-service';
import { cryptoService } from './crypto-service';
import type { Board, BoardMetadata } from '../../types/workspace.types';

/**
 * 从远程 Gist 恢复画布元数据
 */
export async function recoverBoardsFromRemote(
  gistId: string,
  password?: string
): Promise<{
  success: boolean;
  recoveredBoards: BoardMetadata[];
  errors: string[];
}> {
  const result = {
    success: false,
    recoveredBoards: [] as BoardMetadata[],
    errors: [] as string[],
  };

  try {
    logDebug('[BoardRecovery] Starting recovery from gist', { gistId });

    // 获取 Gist 中的所有文件
    const gist = await gitHubApiService.getGist(gistId);
    const boardFiles = Object.keys(gist.files).filter(
      filename => filename.startsWith('board_') && filename.endsWith('.json')
    );

    logDebug('[BoardRecovery] Found board files', {
      boardFileCount: boardFiles.length,
    });

    if (boardFiles.length === 0) {
      result.errors.push('未找到任何画布文件');
      return result;
    }

    // 尝试解密并提取每个画布的元数据
    for (const filename of boardFiles) {
      try {
        const content = await gitHubApiService.getGistFileContent(filename, gistId);
        if (!content) {
          result.errors.push(`无法读取文件: ${filename}`);
          continue;
        }

        // 尝试解密
        const decrypted = await cryptoService.decryptOrPassthrough(content, gistId, password);
        const board: Board = JSON.parse(decrypted);

        // 提取元数据
        const metadata: BoardMetadata = {
          id: board.id,
          name: board.name,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          folderId: board.folderId || null,
          order: board.order ?? 0,
        };

        result.recoveredBoards.push(metadata);
        logDebug('[BoardRecovery] Recovered board', {
          boardId: metadata.id,
          boardName: metadata.name,
        });
      } catch (error) {
        const errorMsg = `解密失败: ${filename} - ${error instanceof Error ? error.message : '未知错误'}`;
        result.errors.push(errorMsg);
        logError(
          '[BoardRecovery] Failed to recover board from file',
          error instanceof Error ? error : undefined,
          {
            filename,
            errorMsg,
          }
        );
      }
    }

    result.success = result.recoveredBoards.length > 0;
    logDebug('[BoardRecovery] Recovery complete', {
      recovered: result.recoveredBoards.length,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    result.errors.push(`恢复失败: ${error instanceof Error ? error.message : '未知错误'}`);
    logError(
      '[BoardRecovery] Recovery failed',
      error instanceof Error ? error : undefined
    );
    return result;
  }
}
