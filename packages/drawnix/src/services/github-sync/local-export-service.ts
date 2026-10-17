/**
 * 本地导出服务
 * 支持将同步数据（包括媒体）导出为本地 ZIP 文件
 */

import { logDebug, logInfo, logSuccess, logWarning, logError } from './sync-log-service';
import { dataSerializer } from './data-serializer';
import { mediaCollector } from './media-collector';
import { unifiedCacheService } from '../unified-cache-service';
import { VERSIONS } from '../../constants';
import type {
  MediaItem,
  SyncedMediaFile,
  MediaSyncProgressCallback,
} from './types';
import { base64ToBlob, blobToBase64, formatSize } from './blob-utils';

/** 导出进度回调 */
export type ExportProgressCallback = (
  progress: number,
  message: string,
  phase: 'collecting' | 'media' | 'compressing'
) => void;

/** 导出结果 */
export interface LocalExportResult {
  success: boolean;
  filename: string;
  size: number;
  stats: {
    boards: number;
    prompts: number;
    tasks: number;
    media: number;
    mediaSize: number;
  };
  error?: string;
}

/** 导入结果 */
export interface LocalImportResult {
  success: boolean;
  stats: {
    boards: number;
    prompts: number;
    tasks: number;
    media: number;
  };
  errors: string[];
}

/**
 * 本地导出服务
 */
class LocalExportService {
  /**
   * 导出所有数据到 ZIP 文件
   * @param options 导出选项
   */
  async exportToZip(options?: {
    includeCurrentBoardMedia?: boolean;
    includeAllMedia?: boolean;
    currentBoardId?: string | null;
    onProgress?: ExportProgressCallback;
  }): Promise<LocalExportResult> {
    const {
      includeCurrentBoardMedia = true,
      includeAllMedia = false,
      currentBoardId = null,
      onProgress,
    } = options || {};

    const result: LocalExportResult = {
      success: false,
      filename: '',
      size: 0,
      stats: {
        boards: 0,
        prompts: 0,
        tasks: 0,
        media: 0,
        mediaSize: 0,
      },
    };

    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();

      // 阶段 1：收集同步数据
      onProgress?.(5, '正在收集数据...', 'collecting');
      const syncData = await dataSerializer.collectSyncData();

      result.stats.boards = syncData.boards.size;
      result.stats.prompts =
        syncData.prompts.promptHistory.length +
        syncData.prompts.videoPromptHistory.length +
        syncData.prompts.imagePromptHistory.length;
      result.stats.tasks = syncData.tasks.completedTasks.length;

      onProgress?.(10, '正在序列化数据...', 'collecting');

      // 添加 manifest
      const manifest = {
        ...syncData.manifest,
        exportedAt: Date.now(),
        appVersion: VERSIONS.app,
        exportType: 'local',
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      // 添加 workspace
      zip.file('workspace.json', JSON.stringify(syncData.workspace, null, 2));

      // 添加 prompts
      zip.file('prompts.json', JSON.stringify(syncData.prompts, null, 2));

      // 添加 tasks
      zip.file('tasks.json', JSON.stringify(syncData.tasks, null, 2));

      // 添加 boards
      const boardsFolder = zip.folder('boards');
      if (boardsFolder) {
        for (const [boardId, board] of syncData.boards) {
          boardsFolder.file(`${boardId}.json`, JSON.stringify(board, null, 2));
        }
      }

      onProgress?.(20, '正在收集媒体资源...', 'media');

      // 阶段 2：收集并添加媒体
      let mediaItems: MediaItem[] = [];

      if (includeAllMedia) {
        // 收集所有画布的媒体
        const allMedia = await mediaCollector.collectAllBoardsMedia(currentBoardId);
        mediaItems = allMedia.items;
      } else if (includeCurrentBoardMedia && currentBoardId) {
        // 仅收集当前画布的媒体
        const currentMedia = await mediaCollector.collectCurrentBoardMedia(currentBoardId);
        mediaItems = currentMedia.currentBoardItems;
      }

      if (mediaItems.length > 0) {
        const mediaFolder = zip.folder('media');
        if (mediaFolder) {
          const totalMedia = mediaItems.length;

          for (let i = 0; i < mediaItems.length; i++) {
            const item = mediaItems[i];
            const progress = 20 + Math.round((i / totalMedia) * 60);
            onProgress?.(progress, `正在导出媒体 (${i + 1}/${totalMedia})...`, 'media');

            try {
              // 获取媒体 Blob
              const blob = await unifiedCacheService.getCachedBlob(item.url);
              if (!blob || blob.size === 0) {
                logWarning(`LocalExportService] Media not found: ${item.url}`);
                continue;
              }

              // 转换为 Base64
              const base64Data = await blobToBase64(blob);

              // 构建媒体文件
              const mediaFile: SyncedMediaFile = {
                url: item.url,
                type: item.type,
                source: item.source,
                mimeType: item.mimeType || blob.type,
                size: blob.size,
                base64Data,
                syncedAt: Date.now(),
                syncedFromDevice: 'local_export',
                originalUrl: item.originalUrl,
              };

              // 使用 URL 的安全编码作为文件名
              const safeFilename = this.urlToSafeFilename(item.url);
              mediaFolder.file(`${safeFilename}.json`, JSON.stringify(mediaFile, null, 2));

              result.stats.media++;
              result.stats.mediaSize += blob.size;
            } catch (error: any) {
              logError(`LocalExportService] Failed to export media ${item.url}:`, error);
            }
          }
        }
      }

      onProgress?.(85, '正在压缩文件...', 'compressing');

      // 阶段 3：生成 ZIP
      const blob = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        },
        (metadata) => {
          const zipProgress = 85 + Math.round(metadata.percent * 0.14);
          onProgress?.(zipProgress, `正在压缩: ${Math.round(metadata.percent)}%`, 'compressing');
        }
      );

      // 生成文件名
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
      result.filename = `foxvue_sync_${dateStr}_${timeStr}.zip`;
      result.size = blob.size;
      result.success = true;

      onProgress?.(100, '导出完成', 'compressing');

      // 自动下载
      this.downloadBlob(blob, result.filename);

      logDebug('LocalExportService] Export completed:', {
        ...result.stats,
        mediaSize: formatSize(result.stats.mediaSize),
        totalSize: formatSize(result.size),
      });

      return result;
    } catch (error: any) {
      logError('LocalExportService] Export failed:', error);
      result.error = error instanceof Error ? error.message : '导出失败';
      return result;
    }
  }

  /**
   * 从 ZIP 文件导入数据
   * @param file ZIP 文件
   * @param onProgress 进度回调
   */
  async importFromZip(
    file: File,
    onProgress?: ExportProgressCallback
  ): Promise<LocalImportResult> {
    const result: LocalImportResult = {
      success: false,
      stats: {
        boards: 0,
        prompts: 0,
        tasks: 0,
        media: 0,
      },
      errors: [],
    };

    try {
      onProgress?.(5, '正在读取文件...', 'collecting');
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);

      onProgress?.(10, '正在验证文件格式...', 'collecting');

      // 验证 manifest
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        throw new Error('无效的导出文件：未找到 manifest.json');
      }

      const manifestContent = await manifestFile.async('string');
      const manifest = JSON.parse(manifestContent);

      if (!manifest.version) {
        throw new Error('无效的导出文件：manifest 格式错误');
      }

      onProgress?.(15, '正在读取数据...', 'collecting');

      // 读取所有数据文件
      const workspaceFile = zip.file('workspace.json');
      const promptsFile = zip.file('prompts.json');
      const tasksFile = zip.file('tasks.json');

      const workspace = workspaceFile
        ? JSON.parse(await workspaceFile.async('string'))
        : null;
      const prompts = promptsFile
        ? JSON.parse(await promptsFile.async('string'))
        : null;
      const tasks = tasksFile
        ? JSON.parse(await tasksFile.async('string'))
        : null;

      // 读取画板
      const boards = new Map();
      const boardsFolder = zip.folder('boards');
      if (boardsFolder) {
        const boardFiles = Object.keys(zip.files).filter(
          (name) => name.startsWith('boards/') && name.endsWith('.json')
        );

        for (const boardPath of boardFiles) {
          try {
            const boardFile = zip.file(boardPath);
            if (boardFile) {
              const boardContent = await boardFile.async('string');
              const board = JSON.parse(boardContent);
              boards.set(board.id, board);
              result.stats.boards++;
            }
          } catch (error: any) {
            const filename = boardPath.split('/').pop() || boardPath;
            result.errors.push(`画板 "${filename}" 导入失败`);
          }
        }
      }

      onProgress?.(30, '正在应用数据...', 'collecting');

      // 应用数据到本地
      const applied = await dataSerializer.applySyncData({
        workspace,
        boards,
        prompts,
        tasks,
      });

      result.stats.boards = applied.boardsApplied;
      result.stats.prompts = applied.promptsApplied;
      result.stats.tasks = applied.tasksApplied;

      onProgress?.(50, '正在导入媒体...', 'media');

      // 导入媒体
      const mediaFolder = zip.folder('media');
      if (mediaFolder) {
        const mediaFiles = Object.keys(zip.files).filter(
          (name) => name.startsWith('media/') && name.endsWith('.json')
        );

        const totalMedia = mediaFiles.length;
        for (let i = 0; i < mediaFiles.length; i++) {
          const mediaPath = mediaFiles[i];
          const progress = 50 + Math.round((i / totalMedia) * 45);
          onProgress?.(progress, `正在导入媒体 (${i + 1}/${totalMedia})...`, 'media');

          try {
            const mediaFile = zip.file(mediaPath);
            if (mediaFile) {
              const mediaContent = await mediaFile.async('string');
              const mediaData: SyncedMediaFile = JSON.parse(mediaContent);

              // 转换 Base64 为 Blob 并缓存
              const blob = base64ToBlob(mediaData.base64Data, mediaData.mimeType);
              if (blob && blob.size > 0) {
                await unifiedCacheService.cacheToCacheStorageOnly(mediaData.url, blob);
                result.stats.media++;
              }
            }
          } catch (error: any) {
            const filename = mediaPath.split('/').pop() || mediaPath;
            result.errors.push(`媒体 "${filename}" 导入失败`);
          }
        }
      }

      onProgress?.(100, '导入完成', 'media');

      result.success = result.errors.length === 0;

      logDebug('LocalExportService] Import completed:', result.stats);

      return result;
    } catch (error: any) {
      logError('LocalExportService] Import failed:', error);
      result.errors.push(error instanceof Error ? error.message : '导入失败');
      return result;
    }
  }

  /**
   * 将 URL 转换为安全的文件名
   */
  private urlToSafeFilename(url: string): string {
    // 使用 Base64 编码，替换不安全字符
    const base64 = btoa(unescape(encodeURIComponent(url)));
    return base64.replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '.');
  }

  /**
   * 从文件名还原 URL
   */
  private safeFilenameToUrl(filename: string): string | null {
    try {
      // 移除 .json 后缀
      const base64 = filename.replace(/\.json$/, '');
      // 还原 Base64 特殊字符
      const restored = base64.replace(/_/g, '/').replace(/-/g, '+').replace(/\./g, '=');
      return decodeURIComponent(escape(atob(restored)));
    } catch {
      return null;
    }
  }

  /**
   * 下载 Blob 文件
   */
  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/** 本地导出服务单例 */
export const localExportService = new LocalExportService();
