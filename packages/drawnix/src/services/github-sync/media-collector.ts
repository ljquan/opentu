/**
 * 媒体资源收集器
 * 负责从画布、素材库、任务队列中收集媒体资源
 */

import { logDebug, logInfo, logSuccess, logWarning, logError } from './sync-log-service';
import { PlaitDrawElement } from '@plait/draw';
import { workspaceStorageService } from '../workspace-storage-service';
import { assetStorageService } from '../asset-storage-service';
import { taskStorageReader } from '../task-storage-reader';
import { unifiedCacheService } from '../unified-cache-service';
import { isVideoElement } from '../../plugins/with-video';
import { isVirtualUrl } from '../../utils/asset-cleanup';
import { TaskStatus, TaskType } from '../../types/task.types';
import type { Board } from '../../types/workspace.types';
import type {
  MediaItem,
  MediaSource,
  MediaPriority,
  CollectedMedia,
} from './types';

/**
 * 判断 URL 是否为本地资源
 */
function isLocalUrl(url: string): boolean {
  return isVirtualUrl(url);
}

/**
 * 判断 URL 是否为外部资源
 */
function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * 根据条件获取媒体优先级
 */
function getMediaPriority(
  isCurrentBoard: boolean,
  source: MediaSource,
  type: 'image' | 'video'
): MediaPriority {
  if (isCurrentBoard) {
    if (source === 'local') {
      return type === 'image' ? 'current_board_local_image' : 'current_board_local_video';
    } else {
      return type === 'image' ? 'current_board_url_image' : 'current_board_url_video';
    }
  } else {
    if (source === 'local') {
      return type === 'image' ? 'other_local_image' : 'other_local_video';
    } else {
      return type === 'image' ? 'other_url_image' : 'other_url_video';
    }
  }
}

/**
 * 优先级排序值（数值越小优先级越高）
 */
const PRIORITY_ORDER: Record<MediaPriority, number> = {
  'current_board_local_image': 1,
  'current_board_local_video': 2,
  'current_board_url_image': 3,
  'current_board_url_video': 4,
  'other_local_image': 5,
  'other_local_video': 6,
  'other_url_image': 7,
  'other_url_video': 8,
};

/**
 * 按优先级排序媒体项
 */
function sortByPriority(items: MediaItem[]): MediaItem[] {
  return [...items].sort((a, b) => {
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
}

/**
 * 从画布元素中提取媒体 URL
 */
function extractMediaFromBoard(
  board: Board,
  currentBoardId: string | null
): MediaItem[] {
  const items: MediaItem[] = [];
  const isCurrentBoard = board.id === currentBoardId;

  if (!board.elements || board.elements.length === 0) {
    return items;
  }

  const elements = board.elements.flatMap(element => {
    const svg = element.svgVectorPart as { version?: unknown; sourceUrl?: unknown } | undefined;
    return svg?.version === 1 && typeof svg.sourceUrl === 'string'
      ? [element, { ...element, url: svg.sourceUrl }]
      : [element];
  });
  for (const element of elements) {
    const url = (element as any).url;
    if (!url || typeof url !== 'string') {
      continue;
    }

    // 跳过 blob URL（临时 URL）
    if (url.startsWith('blob:')) {
      continue;
    }

    // 判断是否为图片或视频
    const isImage = PlaitDrawElement.isDrawElement(element) && PlaitDrawElement.isImage(element);
    const isVideo = isVideoElement(element);

    if (!isImage && !isVideo) {
      continue;
    }

    // 判断媒体类型和来源
    const type = isVideo ? 'video' : 'image';
    let source: MediaSource;
    let originalUrl: string | undefined;

    if (isLocalUrl(url)) {
      source = 'local';
    } else if (isExternalUrl(url)) {
      source = 'external';
      originalUrl = url;
    } else {
      // 其他格式（如相对路径），跳过
      continue;
    }

    const priority = getMediaPriority(isCurrentBoard, source, type);

    // 检查是否已存在
    const existingIndex = items.findIndex(item => item.url === url);
    if (existingIndex >= 0) {
      // 已存在，添加画板 ID
      if (!items[existingIndex].boardIds.includes(board.id)) {
        items[existingIndex].boardIds.push(board.id);
      }
      // 如果当前是当前画布，更新状态
      if (isCurrentBoard && !items[existingIndex].isCurrentBoard) {
        items[existingIndex].isCurrentBoard = true;
        items[existingIndex].priority = priority;
      }
    } else {
      items.push({
        url,
        type,
        source,
        originalUrl,
        boardIds: [board.id],
        isCurrentBoard,
        priority,
      });
    }
  }

  return items;
}

/**
 * 媒体资源收集器
 */
class MediaCollector {
  /**
   * 收集当前画布的媒体资源
   * @param currentBoardId 当前画布 ID
   */
  async collectCurrentBoardMedia(currentBoardId: string): Promise<CollectedMedia> {
    const board = await workspaceStorageService.loadBoard(currentBoardId);
    if (!board) {
      return this.createEmptyResult();
    }

    const items = extractMediaFromBoard(board, currentBoardId);
    
    // 补充元数据（MIME 类型、文件大小）
    await this.enrichMediaMetadata(items);

    const currentBoardItems = sortByPriority(items.filter(item => item.isCurrentBoard));

    return {
      items: sortByPriority(items),
      currentBoardItems,
      otherItems: [],
      stats: this.calculateStats(items),
    };
  }

  /**
   * 收集所有画布的媒体资源
   * @param currentBoardId 当前画布 ID（用于区分优先级）
   */
  async collectAllBoardsMedia(currentBoardId: string | null): Promise<CollectedMedia> {
    const boards = await workspaceStorageService.loadAllBoards();
    const allItems: MediaItem[] = [];

    for (const board of boards) {
      const boardItems = extractMediaFromBoard(board, currentBoardId);
      
      // 合并到总列表
      for (const item of boardItems) {
        const existingIndex = allItems.findIndex(existing => existing.url === item.url);
        if (existingIndex >= 0) {
          // 合并画板 ID
          for (const boardId of item.boardIds) {
            if (!allItems[existingIndex].boardIds.includes(boardId)) {
              allItems[existingIndex].boardIds.push(boardId);
            }
          }
          // 更新当前画布状态
          if (item.isCurrentBoard && !allItems[existingIndex].isCurrentBoard) {
            allItems[existingIndex].isCurrentBoard = true;
            allItems[existingIndex].priority = item.priority;
          }
        } else {
          allItems.push(item);
        }
      }
    }

    // 补充元数据
    await this.enrichMediaMetadata(allItems);

    const sortedItems = sortByPriority(allItems);
    const currentBoardItems = sortedItems.filter(item => item.isCurrentBoard);
    const otherItems = sortedItems.filter(item => !item.isCurrentBoard);

    return {
      items: sortedItems,
      currentBoardItems,
      otherItems,
      stats: this.calculateStats(allItems),
    };
  }

  /**
   * 收集素材库的媒体资源（用于手动同步）
   */
  async collectAssetLibraryMedia(): Promise<MediaItem[]> {
    await assetStorageService.initialize();
    const assets = await assetStorageService.getAllAssets();
    
    const items: MediaItem[] = [];

    for (const asset of assets) {
      const type = asset.type === 'IMAGE' ? 'image' : 'video';
      
      items.push({
        url: asset.url,
        type,
        source: 'local',
        boardIds: [],
        isCurrentBoard: false,
        priority: type === 'image' ? 'other_local_image' : 'other_local_video',
        mimeType: asset.mimeType,
        size: asset.size,
      });
    }

    return items;
  }

  /**
   * 收集任务队列的媒体资源（用于手动同步）
   */
  async collectTaskQueueMedia(): Promise<MediaItem[]> {
    // 从 IndexedDB 获取所有任务
    const allTasks = await taskStorageReader.getAllTasks();
    const items: MediaItem[] = [];

    // 筛选已完成的图片/视频任务
    const completedMediaTasks = allTasks.filter(
      task => task.status === TaskStatus.COMPLETED &&
        (task.type === TaskType.IMAGE || task.type === TaskType.VIDEO) &&
        task.result?.url
    );

    for (const task of completedMediaTasks) {
      const url = task.result!.url;
      const type = task.type === TaskType.VIDEO ? 'video' : 'image';

      // 跳过已处理的 URL
      if (items.some(item => item.url === url)) {
        continue;
      }

      items.push({
        url,
        type,
        source: 'local',
        boardIds: [],
        isCurrentBoard: false,
        priority: type === 'image' ? 'other_local_image' : 'other_local_video',
        mimeType: task.result?.format,
        size: task.result?.size,
      });
    }

    return items;
  }

  /**
   * 从指定的 URL 列表收集媒体资源（用于手动同步选中的项目）
   */
  async collectMediaByUrls(urls: string[]): Promise<MediaItem[]> {
    const items: MediaItem[] = [];

    for (const url of urls) {
      // 跳过 blob URL
      if (url.startsWith('blob:')) {
        continue;
      }

      // 判断媒体类型
      const type = this.guessMediaType(url);
      
      // 判断来源
      let source: MediaSource;
      let originalUrl: string | undefined;

      if (isLocalUrl(url)) {
        source = 'local';
      } else if (isExternalUrl(url)) {
        source = 'external';
        originalUrl = url;
      } else {
        continue;
      }

      items.push({
        url,
        type,
        source,
        originalUrl,
        boardIds: [],
        isCurrentBoard: false,
        priority: getMediaPriority(false, source, type),
      });
    }

    // 补充元数据
    await this.enrichMediaMetadata(items);

    return items;
  }

  /**
   * 补充媒体元数据（MIME 类型、文件大小）
   */
  private async enrichMediaMetadata(items: MediaItem[]): Promise<void> {
    for (const item of items) {
      // 如果已有元数据，跳过
      if (item.mimeType && item.size) {
        continue;
      }

      try {
        // 尝试从统一缓存获取信息
        const cacheInfo = await unifiedCacheService.getCacheInfo(item.url);
        if (cacheInfo.isCached) {
          item.size = cacheInfo.size;
          item.mimeType = cacheInfo.metadata?.mimeType as string | undefined;
        }
      } catch (error: any) {
        // 忽略错误，继续处理其他项
        logWarning(`MediaCollector] Failed to get metadata for ${item.url}:`, error);
      }
    }
  }

  /**
   * 根据 URL 猜测媒体类型
   */
  private guessMediaType(url: string): 'image' | 'video' {
    const lowerUrl = url.toLowerCase();
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv'];
    
    if (videoExtensions.some(ext => lowerUrl.includes(ext))) {
      return 'video';
    }
    
    // 检查路径中是否包含 video
    if (lowerUrl.includes('/video/') || lowerUrl.includes('#video')) {
      return 'video';
    }

    return 'image';
  }

  /**
   * 计算统计信息
   */
  private calculateStats(items: MediaItem[]): CollectedMedia['stats'] {
    return {
      total: items.length,
      currentBoard: items.filter(item => item.isCurrentBoard).length,
      localImages: items.filter(item => item.source === 'local' && item.type === 'image').length,
      localVideos: items.filter(item => item.source === 'local' && item.type === 'video').length,
      urlImages: items.filter(item => item.source === 'external' && item.type === 'image').length,
      urlVideos: items.filter(item => item.source === 'external' && item.type === 'video').length,
    };
  }

  /**
   * 创建空结果
   */
  private createEmptyResult(): CollectedMedia {
    return {
      items: [],
      currentBoardItems: [],
      otherItems: [],
      stats: {
        total: 0,
        currentBoard: 0,
        localImages: 0,
        localVideos: 0,
        urlImages: 0,
        urlVideos: 0,
      },
    };
  }
}

/** 媒体收集器单例 */
export const mediaCollector = new MediaCollector();
