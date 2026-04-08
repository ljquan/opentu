/**
 * TaskQueuePanel Component
 *
 * Side panel that displays all tasks in the queue.
 * Supports filtering by status and provides batch operations.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Button, Tabs, Dialog, MessagePlugin, Input, Radio, Tooltip, Checkbox, Badge } from 'tdesign-react';
import { DeleteIcon, SearchIcon, UserIcon, RefreshIcon, PauseCircleIcon, CheckDoubleIcon, ImageIcon, VideoIcon, FilterIcon } from 'tdesign-icons-react';
import { Music4 } from 'lucide-react';
import { VirtualTaskList } from './VirtualTaskList';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import { Task, TaskType, TaskStatus } from '../../types/task.types';
import { unifiedCacheService } from '../../services/unified-cache-service';
import { useDrawnix, DialogType } from '../../hooks/use-drawnix';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import {
  AUDIO_CARD_DEFAULT_HEIGHT,
  AUDIO_CARD_DEFAULT_WIDTH,
  insertAudioFromUrl,
} from '../../data/audio';
import { executeCanvasInsertion } from '../../services/canvas-operations';
import { sanitizeFilename, downloadFromBlob, normalizeImageDataUrl } from '@aitu/utils';
import { downloadMediaFile } from '../../utils/download-utils';
import { BaseDrawer } from '../side-drawer';
import { CharacterCreateDialog } from '../character/CharacterCreateDialog';
import { CharacterList } from '../character/CharacterList';
import { useCharacters } from '../../hooks/useCharacters';
import { UnifiedMediaViewer, type MediaItem as UnifiedMediaItem } from '../shared/media-preview';
import { ImageEditor } from '../image-editor';
import { useGitHubSync } from '../../contexts/GitHubSyncContext';
import { mediaSyncService } from '../../services/github-sync/media-sync-service';
import { CloudUploadIcon } from 'tdesign-icons-react';
import { formatLyricsForCanvas, getLyricsTags, getLyricsTitle, isLyricsTask } from '../../utils/lyrics-task-utils';
import './task-queue.scss';

const { TabPanel } = Tabs;
const RadioGroup = Radio.Group;

// Storage key for drawer width
export const TASK_DRAWER_WIDTH_KEY = 'task-queue-drawer-width';

export interface TaskQueuePanelProps {
  /** Whether the panel is expanded */
  expanded: boolean;
  /** Callback when close button is clicked */
  onClose?: () => void;
  /** Callback when a task action is performed */
  onTaskAction?: (action: string, taskId: string) => void;
}

/**
 * TaskQueuePanel component - displays the full task queue
 */
export const TaskQueuePanel: React.FC<TaskQueuePanelProps> = ({
  expanded,
  onClose,
  onTaskAction,
}) => {
  const {
    tasks,
    activeTasks,
    completedTasks,
    failedTasks,
    cancelledTasks,
    isLoading,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    retryTask,
    deleteTask,
    clearCompleted,
    clearFailed,
    batchDeleteTasks,
    batchRetryTasks,
    batchCancelTasks,
  } = useTaskQueue();

  const { board, openDialog } = useDrawnix();
  const { characters } = useCharacters();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearType, setClearType] = useState<'completed' | 'failed'>('completed');
  const [searchText, setSearchText] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<
    'all' | 'image' | 'video' | 'audio' | 'character'
  >('all');
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  
  // 图片编辑器状态
  const [imageEditorVisible, setImageEditorVisible] = useState(false);
  const [imageEditorUrl, setImageEditorUrl] = useState('');
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  // Character extraction dialog state
  const [characterDialogTask, setCharacterDialogTask] = useState<Task | null>(null);
  // Multi-selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  
  // Sync state
  const { isConfigured } = useGitHubSync();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  // Check if showing characters view
  const isCharacterView = typeFilter === 'character';

  // Initialize media cache status on component mount
  useEffect(() => {
    unifiedCacheService.initCacheStatus();
  }, []);

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    // Get tasks based on active tab
    let tasksToFilter: Task[];
    switch (activeTab) {
      case 'all':
        tasksToFilter = tasks;
        break;
      case 'active':
        tasksToFilter = activeTasks;
        break;
      case 'completed':
        tasksToFilter = completedTasks;
        break;
      case 'failed':
        tasksToFilter = failedTasks;
        break;
      case 'cancelled':
        tasksToFilter = cancelledTasks;
        break;
      default:
        tasksToFilter = tasks;
    }

    // Apply type filter
    if (typeFilter !== 'all' && typeFilter !== 'character') {
      tasksToFilter = tasksToFilter.filter(task =>
        task.type ===
        (typeFilter === 'image'
          ? TaskType.IMAGE
          : typeFilter === 'audio'
          ? TaskType.AUDIO
          : TaskType.VIDEO)
      );
    }

    // Apply search filter
    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase().trim();
      tasksToFilter = tasksToFilter.filter(task =>
        task.params.prompt.toLowerCase().includes(searchLower) ||
        String(task.result?.title || '').toLowerCase().includes(searchLower) ||
        String(task.result?.lyricsTitle || '').toLowerCase().includes(searchLower) ||
        String(task.result?.lyricsText || '').toLowerCase().includes(searchLower) ||
        (task.result?.lyricsTags || []).some((tag) =>
          String(tag).toLowerCase().includes(searchLower)
        )
      );
    }

    // Sort by time - newest first (reverse chronological)
    return [...tasksToFilter].sort((a, b) => b.createdAt - a.createdAt);
  }, [activeTab, tasks, activeTasks, completedTasks, failedTasks, cancelledTasks, typeFilter, searchText]);

  // Handle clear action
  const handleClear = (type: 'completed' | 'failed') => {
    setClearType(type);
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    if (clearType === 'completed') {
      clearCompleted();
    } else {
      clearFailed();
    }
    setShowClearConfirm(false);
  };

  // Task action handlers
  const handleRetry = (taskId: string) => {
    retryTask(taskId);
    onTaskAction?.('retry', taskId);
  };

  const handleDelete = (taskId: string) => {
    setTaskToDelete(taskId);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (taskToDelete) {
      deleteTask(taskToDelete);
      onTaskAction?.('delete', taskToDelete);
    }
    setShowDeleteConfirm(false);
    setTaskToDelete(null);
  };

  // Multi-selection handlers
  const handleToggleSelectionMode = () => {
    if (selectionMode) {
      // Exit selection mode and clear selections
      setSelectionMode(false);
      setSelectedTaskIds(new Set());
    } else {
      setSelectionMode(true);
    }
  };

  const handleSelectionChange = (taskId: string, selected: boolean) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(taskId);
      } else {
        newSet.delete(taskId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const allTaskIds = filteredTasks.map(t => t.id);
    setSelectedTaskIds(new Set(allTaskIds));
  };

  const handleDeselectAll = () => {
    setSelectedTaskIds(new Set());
  };

  const handleBatchDelete = () => {
    if (selectedTaskIds.size === 0) return;
    setShowBatchDeleteConfirm(true);
  };

  const confirmBatchDelete = () => {
    batchDeleteTasks(Array.from(selectedTaskIds));
    setSelectedTaskIds(new Set());
    setSelectionMode(false);
    setShowBatchDeleteConfirm(false);
    MessagePlugin.success(`已删除 ${selectedTaskIds.size} 个任务`);
  };

  const handleBatchRetry = () => {
    // Retry failed and cancelled tasks
    const retryableSelectedIds = Array.from(selectedTaskIds).filter(id => {
      const task = tasks.find(t => t.id === id);
      return task?.status === TaskStatus.FAILED || task?.status === TaskStatus.CANCELLED;
    });
    if (retryableSelectedIds.length === 0) {
      MessagePlugin.warning('没有可重试的任务');
      return;
    }
    batchRetryTasks(retryableSelectedIds);
    setSelectedTaskIds(new Set());
    setSelectionMode(false);
    MessagePlugin.success(`已重试 ${retryableSelectedIds.length} 个任务`);
  };

  // Count selected failed/cancelled tasks for retry button
  const selectedRetryableCount = useMemo(() => {
    return Array.from(selectedTaskIds).filter(id => {
      const task = tasks.find(t => t.id === id);
      return task?.status === TaskStatus.FAILED || task?.status === TaskStatus.CANCELLED;
    }).length;
  }, [selectedTaskIds, tasks]);

  // Count selected active tasks for cancel button
  const selectedActiveCount = useMemo(() => {
    return Array.from(selectedTaskIds).filter(id => {
      const task = tasks.find(t => t.id === id);
      return task?.status === TaskStatus.PENDING ||
             task?.status === TaskStatus.PROCESSING;
    }).length;
  }, [selectedTaskIds, tasks]);

  // Count selected completed tasks for sync button
  const selectedSyncableCount = useMemo(() => {
    return Array.from(selectedTaskIds).filter(id => {
      const task = tasks.find(t => t.id === id);
      return task?.status === TaskStatus.COMPLETED && 
             (task?.type === TaskType.IMAGE || task?.type === TaskType.VIDEO);
    }).length;
  }, [selectedTaskIds, tasks]);

  // Type counts for filter buttons
  const typeCounts = useMemo(() => {
    return {
      all: tasks.length,
      image: tasks.filter(t => t.type === TaskType.IMAGE).length,
      video: tasks.filter(t => t.type === TaskType.VIDEO).length,
      audio: tasks.filter(t => t.type === TaskType.AUDIO).length,
      character: characters.length,
    };
  }, [tasks, characters]);

  const handleBatchCancel = () => {
    // Only cancel active tasks
    const activeSelectedIds = Array.from(selectedTaskIds).filter(id => {
      const task = tasks.find(t => t.id === id);
      return task?.status === TaskStatus.PENDING ||
             task?.status === TaskStatus.PROCESSING;
    });
    if (activeSelectedIds.length === 0) {
      MessagePlugin.warning('没有可取消的进行中任务');
      return;
    }
    batchCancelTasks(activeSelectedIds);
    setSelectedTaskIds(new Set());
    setSelectionMode(false);
    MessagePlugin.success(`已取消 ${activeSelectedIds.length} 个任务`);
  };

  const handleBatchSync = async () => {
    // Only sync completed image/video tasks
    const syncableSelectedIds = Array.from(selectedTaskIds).filter(id => {
      const task = tasks.find(t => t.id === id);
      return task?.status === TaskStatus.COMPLETED && 
             (task?.type === TaskType.IMAGE || task?.type === TaskType.VIDEO);
    });
    
    if (syncableSelectedIds.length === 0 || isSyncing) return;
    
    setIsSyncing(true);
    setSyncProgress(0);
    
    try {
      const result = await (mediaSyncService as any).syncMultipleTasks(
        syncableSelectedIds,
        (current: any, total: any) => {
          setSyncProgress(Math.round((current / total) * 100));
        }
      );
      
      console.log('[TaskQueuePanel] Batch sync result:', result);
      setSyncProgress(100);
      
      if (result.succeeded > 0) {
        MessagePlugin.success(`已同步 ${result.succeeded} 个任务`);
      }
      if (result.failed > 0) {
        MessagePlugin.warning(`${result.failed} 个任务同步失败`);
      }
    } catch (error) {
      console.error('[TaskQueuePanel] Batch sync failed:', error);
      MessagePlugin.error('同步失败，请稍后重试');
    } finally {
      setIsSyncing(false);
      setSyncProgress(0);
    }
  };

  const handleDownload = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && isLyricsTask(task)) {
      MessagePlugin.info('歌词任务支持复制或插入画布');
      return;
    }
    if (!task?.result?.url && !task?.result?.urls?.length) return;

    const urls = task.result.urls?.length ? task.result.urls : [task.result.url];

    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const filename = `${sanitizeFilename(task.params.prompt) || task.type}${urls.length > 1 ? `-${i + 1}` : ''}.${task.result.format}`;
        // 1. 优先从本地 IndexedDB 缓存获取
        const cachedBlob = await unifiedCacheService.getCachedBlob(url);
        if (cachedBlob) {
          downloadFromBlob(cachedBlob, filename);
          continue;
        }
        // 2. 缓存不存在，从 URL 下载（带重试，SW 会自动去重）
        const result = await downloadMediaFile(
          url,
          task.params.prompt,
          task.result.format,
          task.type
        );
        if (result && 'opened' in result) {
          // 浏览器已打开标签页
        }
      }
      MessagePlugin.success(
        task.type === TaskType.AUDIO
          ? urls.length > 1
            ? '多条音频已开始下载'
            : '音频下载成功'
          : urls.length > 1
          ? '多图已开始下载'
          : '下载成功'
      );
      onTaskAction?.('download', taskId);
    } catch (error) {
      console.error('Download failed:', error);
      MessagePlugin.error('下载失败，请稍后重试');
    }
  };

  const handleCopy = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !isLyricsTask(task)) {
      MessagePlugin.warning('暂无可复制的歌词');
      return;
    }

    const text = formatLyricsForCanvas(task);
    if (!text.trim()) {
      MessagePlugin.warning('暂无可复制的歌词');
      return;
    }

    if (!navigator.clipboard?.writeText) {
      MessagePlugin.warning('当前环境不支持复制');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      MessagePlugin.success('歌词已复制');
      onTaskAction?.('copy', taskId);
    } catch (error) {
      console.error('Failed to copy lyrics:', error);
      MessagePlugin.error('复制失败，请稍后重试');
    }
  };

  const handleInsert = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !board) {
      console.warn('Cannot insert: task result or board not available');
      MessagePlugin.warning('无法插入：白板未就绪');
      return;
    }
    if (!task.result?.url && !task.result?.urls?.length && !isLyricsTask(task)) {
      console.warn('Cannot insert: task result is empty');
      MessagePlugin.warning('无法插入：任务结果为空');
      return;
    }

    try {
      const taskResult = task.result!;
      if (task.type === TaskType.IMAGE) {
        const urls = taskResult.urls?.length ? taskResult.urls : [taskResult.url];
        for (const url of urls) {
          await insertImageFromUrl(board, normalizeImageDataUrl(url));
        }
        MessagePlugin.success(urls.length > 1 ? '多图已插入到白板' : '图片已插入到白板');
      } else if (task.type === TaskType.VIDEO) {
        // 插入视频到白板
        await insertVideoFromUrl(board, taskResult.url);
        // console.log('Video inserted to board:', taskId);
        MessagePlugin.success('视频已插入到白板');
      } else if (task.type === TaskType.AUDIO) {
        if (isLyricsTask(task)) {
          await executeCanvasInsertion({
            items: [
              {
                type: 'text',
                content: formatLyricsForCanvas(task),
                metadata: {
                  title: getLyricsTitle(
                    taskResult,
                    task.params.title || task.params.prompt
                  ),
                  tags: getLyricsTags(taskResult),
                },
              },
            ],
          });
          MessagePlugin.success('歌词已插入到白板');
          onTaskAction?.('insert', taskId);
          return;
        }

        const urls = taskResult.urls?.length ? taskResult.urls : [taskResult.url];
        const baseMetadata = {
          title: taskResult.title || task.params.title || task.params.prompt,
          duration: taskResult.duration,
          previewImageUrl: taskResult.previewImageUrl,
          tags:
            typeof task.params.tags === 'string'
              ? task.params.tags
              : undefined,
          mv:
            typeof task.params.mv === 'string'
              ? task.params.mv
              : undefined,
          prompt: task.params.prompt,
          providerTaskId: taskResult.providerTaskId || task.remoteId,
          clipId: taskResult.primaryClipId || taskResult.clipIds?.[0],
          clipIds: taskResult.clipIds,
        };

        if (urls.length === 1) {
          await insertAudioFromUrl(board, urls[0], baseMetadata);
        } else {
          await executeCanvasInsertion({
            items: urls.map((audioUrl, index) => ({
              type: 'audio',
              content: audioUrl,
              groupId: `task-audio-${task.id}`,
              dimensions: {
                width: AUDIO_CARD_DEFAULT_WIDTH,
                height: AUDIO_CARD_DEFAULT_HEIGHT,
              },
              metadata: {
                ...baseMetadata,
                title:
                  taskResult.clips?.[index]?.title ||
                  `${baseMetadata.title || 'Audio'} ${index + 1}`,
                clipId:
                  taskResult.clips?.[index]?.clipId ||
                  taskResult.clipIds?.[index] ||
                  baseMetadata.clipId,
              },
            })),
          });
        }

        MessagePlugin.success(
          urls.length > 1 ? '多条音频卡片已插入到白板' : '音频卡片已插入到白板'
        );
      }
      onTaskAction?.('insert', taskId);
    } catch (error) {
      console.error('Failed to insert to board:', error);
      MessagePlugin.error(`插入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleEdit = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      console.warn('Cannot edit: task not found');
      return;
    }

    // 根据任务类型打开对应的对话框
    if (task.type === TaskType.IMAGE) {
      // 准备图片生成初始数据
      const initialData = {
        initialPrompt: task.params.prompt,
        initialWidth: task.params.width,
        initialHeight: task.params.height,
        initialImages: task.params.uploadedImages,  // 传递上传的参考图片(数组)
        initialResultUrl: task.result?.url,  // 传递结果URL用于预览
        initialResultUrls: task.result?.urls,  // 多图结果
      };
      openDialog(DialogType.aiImageGeneration, initialData);
    } else if (task.type === TaskType.VIDEO) {
      // 准备视频生成初始数据
      const initialData = {
        initialPrompt: task.params.prompt,
        initialDuration: typeof task.params.seconds === 'string'
          ? parseInt(task.params.seconds, 10)
          : task.params.seconds,  // 确保转换为数字
        initialModel: task.params.model,  // 传递模型
        initialSize: task.params.size,  // 传递尺寸
        initialImages: task.params.uploadedImages,  // 传递上传的图片（多图片格式）
        initialResultUrl: task.result?.url,  // 传递结果URL用于预览
        initialResultUrls: task.result?.urls,  // 多图/多视频结果
      };
      openDialog(DialogType.aiVideoGeneration, initialData);
    } else if (task.type === TaskType.AUDIO) {
      MessagePlugin.info('音频任务暂不支持从任务面板直接编辑');
      return;
    }

    onTaskAction?.('edit', taskId);
  };

  // Handle extract character action
  const handleExtractCharacter = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setCharacterDialogTask(task);
      onTaskAction?.('extractCharacter', taskId);
    }
  };

  // Get completed tasks with results for navigation (deduplicated by ID)
  const completedTasksWithResults = useMemo(() => {
    const seen = new Set<string>();
    return filteredTasks.filter(t => {
      if (
        t.status !== TaskStatus.COMPLETED ||
        !t.result?.url ||
        (t.type !== TaskType.IMAGE && t.type !== TaskType.VIDEO)
      ) {
        return false;
      }
      if (seen.has(t.id)) return false; // 跳过重复的任务 ID
      seen.add(t.id);
      return true;
    });
  }, [filteredTasks]);

  // 展开多图任务为多个 MediaItem，同时建立 taskId -> 首个 previewIndex 的映射
  const { previewMediaItems, taskIdToPreviewIndex } = useMemo(() => {
    const items: UnifiedMediaItem[] = [];
    const indexMap = new Map<string, number>();

    for (const task of completedTasksWithResults) {
      const urls = task.result!.urls?.length
        ? task.result!.urls
        : [task.result!.url];
      const mediaType = task.type === TaskType.VIDEO ? 'video' as const : 'image' as const;
      const title = task.params.prompt?.substring(0, 50);

      // 记录该任务第一张图在列表中的索引
      indexMap.set(task.id, items.length);

      for (let i = 0; i < urls.length; i++) {
        const normalizedUrl = mediaType === 'image'
          ? normalizeImageDataUrl(urls[i])
          : urls[i];
        items.push({
          id: urls.length > 1 ? `${task.id}-${i}` : task.id,
          url: normalizedUrl,
          type: mediaType,
          title: urls.length > 1 ? `${title} (${i + 1}/${urls.length})` : title,
        });
      }
    }

    return { previewMediaItems: items, taskIdToPreviewIndex: indexMap };
  }, [completedTasksWithResults]);

  // Preview navigation handlers - 使用 Map 精确查找索引
  const handlePreviewOpen = useCallback((taskId: string) => {
    setPreviewTaskId(taskId);
    const index = taskIdToPreviewIndex.get(taskId);
    if (index !== undefined) {
      setPreviewInitialIndex(index);
      setPreviewVisible(true);
    }
  }, [taskIdToPreviewIndex]);

  const handlePreviewClose = useCallback(() => {
    setPreviewTaskId(null);
    setPreviewVisible(false);
  }, []);

  // 处理图片编辑
  const handlePreviewEdit = useCallback((item: UnifiedMediaItem) => {
    if (item.type !== 'image') return;
    setImageEditorUrl(item.url);
    setImageEditorVisible(true);
    setPreviewVisible(false); // 关闭预览
  }, []);

  // 编辑后插入画布
  const handleEditInsert = useCallback(async (editedImageUrl: string) => {
    if (!board) return;
    
    try {
      const taskId = `edited-image-${Date.now()}`;
      const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
      
      // 将 data URL 转换为 Blob
      const response = await fetch(editedImageUrl);
      const blob = await response.blob();
      
      // 缓存到 Cache API
      await unifiedCacheService.cacheMediaFromBlob(stableUrl, blob, 'image', { taskId });
      
      // 插入到画布
      await insertImageFromUrl(board, stableUrl);
      
      // 关闭编辑器
      setImageEditorVisible(false);
      setImageEditorUrl('');
    } catch (error) {
      console.error('Failed to insert edited image:', error);
    }
  }, [board]);

  // Handle close
  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // 计算各 Tab 的显示数量（已加载数据中的分类 + 未加载的估算）
  // 全部数量使用 totalCount（来自 SW），其他分类使用已加载数据的数量
  const displayTotalCount = totalCount > 0 ? totalCount : tasks.length;

  // Filter section with tabs and filters
  const filterSection = (
    <div className="task-queue-panel__filters-container">
      <Tabs value={activeTab} onChange={(value) => setActiveTab(value as string)}>
        <TabPanel value="all" label={`全部 (${displayTotalCount})`} />
        <TabPanel value="active" label={`生成中 (${activeTasks.length})`} />
        <TabPanel value="failed" label={`失败 (${failedTasks.length})`} />
        <TabPanel value="completed" label={`已完成 (${completedTasks.length})`} />
      </Tabs>

      <div className="task-queue-panel__filters">
        {/* Simplified Type Filters */}
        <div className="task-queue-panel__type-filters">
          <Tooltip content={`全部 (${typeCounts.all})`} theme="light">
            <Button
              size="small"
              variant="text"
              shape="square"
              onClick={() => setTypeFilter('all')}
              className={typeFilter === 'all' ? 'task-queue-panel__filter-btn--active' : ''}
            >
              <FilterIcon size="16px" />
            </Button>
          </Tooltip>
          <Tooltip content={`图片 (${typeCounts.image})`} theme="light">
            <Button
              size="small"
              variant="text"
              shape="square"
              onClick={() => setTypeFilter('image')}
              className={typeFilter === 'image' ? 'task-queue-panel__filter-btn--active' : ''}
            >
              <ImageIcon size="16px" />
            </Button>
          </Tooltip>
          <Tooltip content={`视频 (${typeCounts.video})`} theme="light">
            <Button
              size="small"
              variant="text"
              shape="square"
              onClick={() => setTypeFilter('video')}
              className={typeFilter === 'video' ? 'task-queue-panel__filter-btn--active' : ''}
            >
              <VideoIcon size="16px" />
            </Button>
          </Tooltip>
          <Tooltip content={`音频 (${typeCounts.audio})`} theme="light">
            <Button
              size="small"
              variant="text"
              shape="square"
              onClick={() => setTypeFilter('audio')}
              className={typeFilter === 'audio' ? 'task-queue-panel__filter-btn--active' : ''}
            >
              <Music4 size={16} strokeWidth={1.9} />
            </Button>
          </Tooltip>
          <Tooltip content={`角色 (${typeCounts.character})`} theme="light">
            <Button
              size="small"
              variant="text"
              shape="square"
              onClick={() => setTypeFilter('character')}
              className={typeFilter === 'character' ? 'task-queue-panel__filter-btn--active' : ''}
            >
              <UserIcon size="16px" />
            </Button>
          </Tooltip>
        </div>

        {/* Search row integrated in the same line */}
        <div className="task-queue-panel__search-row">
          <Input
            value={searchText}
            onChange={(value) => setSearchText(value)}
            placeholder="搜索..."
            clearable
            prefixIcon={<SearchIcon />}
            size="small"
            className="task-queue-panel__search-input"
          />

          <div className="task-queue-panel__filter-actions">
            <Tooltip content={selectionMode ? "退出多选" : "批量操作"} theme="light">
              <Button
                size="small"
                variant={selectionMode ? "base" : "outline"}
                theme={selectionMode ? "primary" : "default"}
                icon={<CheckDoubleIcon />}
                data-track="task_click_toggle_selection"
                onClick={handleToggleSelectionMode}
              >
                {selectionMode ? "退出" : "多选"}
              </Button>
            </Tooltip>

            {failedTasks.length > 0 && !selectionMode && (
              <Tooltip content="清除失败" theme="light">
                <Button
                  size="small"
                  variant="text"
                  theme="default"
                  icon={<DeleteIcon style={{ color: 'var(--td-text-color-placeholder)' }} />}
                  data-track="task_click_clear_failed"
                  onClick={() => handleClear('failed')}
                  className="task-queue-panel__clear-btn"
                />
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* Batch action bar - shown when in selection mode */}
      {selectionMode && !isCharacterView && (
        <div className="task-queue-panel__batch-actions">
          <div className="task-queue-panel__batch-select">
            <Checkbox
              checked={selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0}
              indeterminate={selectedTaskIds.size > 0 && selectedTaskIds.size < filteredTasks.length}
              onChange={(checked) => checked ? handleSelectAll() : handleDeselectAll()}
            />
            <span className="task-queue-panel__batch-count">
              已选 {selectedTaskIds.size} / {filteredTasks.length}
            </span>
          </div>
          <div className="task-queue-panel__batch-buttons">
            {selectedActiveCount > 0 && (
              <Button
                size="small"
                variant="outline"
                theme="warning"
                icon={<PauseCircleIcon />}
                data-track="task_click_batch_cancel"
                onClick={handleBatchCancel}
              >
                取消 ({selectedActiveCount})
              </Button>
            )}
            {selectedRetryableCount > 0 && (
              <Button
                size="small"
                theme="primary"
                icon={<RefreshIcon />}
                data-track="task_click_batch_retry"
                onClick={handleBatchRetry}
              >
                重试 ({selectedRetryableCount})
              </Button>
            )}
            {isConfigured && selectedSyncableCount > 0 && (
              <Tooltip content="同步选中的任务到云端" placement="bottom" theme="light">
                <Button
                  size="small"
                  variant="outline"
                  icon={<CloudUploadIcon />}
                  data-track="task_click_batch_sync"
                  onClick={handleBatchSync}
                  disabled={isSyncing}
                  loading={isSyncing}
                >
                  {isSyncing ? `${syncProgress}%` : `同步 (${selectedSyncableCount})`}
                </Button>
              </Tooltip>
            )}
            <Button
              size="small"
              variant="text"
              theme="default"
              icon={<DeleteIcon />}
              data-track="task_click_batch_delete"
              onClick={handleBatchDelete}
              disabled={selectedTaskIds.size === 0}
            >
              删除 ({selectedTaskIds.size})
            </Button>

          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <BaseDrawer
        isOpen={expanded}
        onClose={handleClose}
        title="任务队列"
        filterSection={filterSection}
        position="toolbar-right"
        width="responsive"
        storageKey={TASK_DRAWER_WIDTH_KEY}
        showBackdrop={false}
        closeOnEsc={false}
        showCloseButton={true}
        className="task-queue-panel"
        contentClassName="task-queue-panel__content"
        resizable={true}
        minWidth={320}
        maxWidth={1024}
        data-testid="task-queue-panel"
      >
        {isCharacterView ? (
          /* Character List View */
          <CharacterList
            showHeader={false}
            title=""
          />
        ) : (
          /* Task List View with Virtual Scrolling */
          <VirtualTaskList
            tasks={filteredTasks}
            selectionMode={selectionMode}
            selectedTaskIds={selectedTaskIds}
            onSelectionChange={handleSelectionChange}
            onRetry={handleRetry}
            onDelete={handleDelete}
            onDownload={handleDownload}
            onInsert={handleInsert}
            onCopy={handleCopy}
            onEdit={handleEdit}
            onPreviewOpen={handlePreviewOpen}
            onExtractCharacter={handleExtractCharacter}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            totalCount={totalCount}
            loadedCount={loadedCount}
            className="task-queue-panel__list"
            emptyContent={
              isLoading ? (
                <div className="task-queue-panel__empty">
                  <div className="task-queue-panel__empty-icon">⏳</div>
                  <div className="task-queue-panel__empty-text">加载中...</div>
                </div>
              ) : (
                <div className="task-queue-panel__empty">
                  <div className="task-queue-panel__empty-icon">📋</div>
                  <div className="task-queue-panel__empty-text">
                    {activeTab === 'all' ? '暂无任务' : `暂无${activeTab === 'active' ? '生成中' : activeTab === 'completed' ? '已完成' : activeTab === 'failed' ? '失败' : '已取消'}任务`}
                  </div>
                </div>
              )
            }
          />
        )}
      </BaseDrawer>

      {/* Clear Confirmation Dialog */}
      <Dialog
        visible={showClearConfirm}
        header="确认清除"
        onClose={() => setShowClearConfirm(false)}
        onConfirm={confirmClear}
        onCancel={() => setShowClearConfirm(false)}
      >
        确定要清除所有{clearType === 'completed' ? '已完成' : '失败'}的任务吗？此操作无法撤销。
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        visible={showDeleteConfirm}
        header="确认删除"
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      >
        确定要删除此任务吗？此操作无法撤销。
      </Dialog>

      {/* Batch Delete Confirmation Dialog */}
      <Dialog
        visible={showBatchDeleteConfirm}
        header="确认批量删除"
        onClose={() => setShowBatchDeleteConfirm(false)}
        onConfirm={confirmBatchDelete}
        onCancel={() => setShowBatchDeleteConfirm(false)}
      >
        确定要删除选中的 {selectedTaskIds.size} 个任务吗？此操作无法撤销。
      </Dialog>

      {/* 统一预览 */}
      <UnifiedMediaViewer
        visible={previewVisible}
        items={previewMediaItems}
        initialIndex={previewInitialIndex}
        onClose={handlePreviewClose}
        showThumbnails={true}
        onEdit={handlePreviewEdit}
      />

      {/* 图片编辑器 - 任务场景只支持插入画布和下载 */}
      {imageEditorVisible && imageEditorUrl && (
        <ImageEditor
          visible={imageEditorVisible}
          imageUrl={imageEditorUrl}
          showOverwrite={false}
          onClose={() => {
            setImageEditorVisible(false);
            setImageEditorUrl('');
          }}
          onInsert={board ? handleEditInsert : undefined}
        />
      )}

      {/* Character Create Dialog */}
      <CharacterCreateDialog
        visible={!!characterDialogTask}
        task={characterDialogTask}
        onClose={() => setCharacterDialogTask(null)}
        onCreateStart={() => {
          // Start indicator (API call begins)
          // console.log('Character creation started');
        }}
        onCreateComplete={(characterId) => {
          // console.log('Character created:', characterId);
          // Close dialog (don't auto-switch to character view)
          setCharacterDialogTask(null);
        }}
      />
    </>
  );
};
