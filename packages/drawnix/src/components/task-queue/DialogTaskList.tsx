/**
 * DialogTaskList Component
 *
 * Displays tasks that were created from the current dialog session.
 * Used within AI generation dialogs to show only tasks created in that dialog.
 * Supports pagination with scroll-to-load-more and type filtering via RPC.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { VirtualTaskList } from './VirtualTaskList';
import { useFilteredTaskQueue } from '../../hooks/useFilteredTaskQueue';
import { Task, TaskType, TaskStatus } from '../../types/task.types';
import { useDrawnix, DialogType } from '../../hooks/use-drawnix';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import { MessagePlugin, Dialog, Input, Button, Tooltip } from 'tdesign-react';
import { SearchIcon, DeleteIcon } from 'tdesign-icons-react';
import { sanitizeFilename, downloadFromBlob } from '@aitu/utils';
import { downloadMediaFile } from '../../utils/download-utils';
import { unifiedCacheService } from '../../services/unified-cache-service';
import { CharacterCreateDialog } from '../character/CharacterCreateDialog';
import {
  UnifiedMediaViewer,
  type MediaItem as UnifiedMediaItem,
} from '../shared/media-preview';
import './dialog-task-list.scss';

export interface DialogTaskListProps {
  /** Task IDs to display. If not provided, shows all tasks (subject to taskType filter) */
  taskIds?: string[];
  /** Type of tasks to show (optional filter) - used for RPC filtering */
  taskType?: TaskType;
  /** Callback when edit button is clicked - if provided, will update parent form instead of opening dialog */
  onEditTask?: (task: any) => void;
}

/**
 * DialogTaskList component - displays filtered tasks for a specific dialog
 * Now uses useFilteredTaskQueue for pagination and type filtering via RPC.
 */
export const DialogTaskList: React.FC<DialogTaskListProps> = ({
  taskIds,
  taskType,
  onEditTask,
}) => {
  // 使用按类型过滤的分页 hook
  const {
    tasks,
    isLoading,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    retryTask,
    deleteTask,
  } = useFilteredTaskQueue({ taskType });

  const { board, openDialog } = useDrawnix();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [searchText, setSearchText] = useState('');
  // Character extraction dialog state
  const [characterDialogTask, setCharacterDialogTask] = useState<Task | null>(
    null
  );

  // Clear failed tasks state
  const [showClearFailedConfirm, setShowClearFailedConfirm] = useState(false);

  const failedTaskCount = useMemo(() => {
    return tasks.filter((t) => t.status === TaskStatus.FAILED).length;
  }, [tasks]);

  const handleClearFailed = useCallback(() => {
    const failedTasks = tasks.filter((t) => t.status === TaskStatus.FAILED);
    failedTasks.forEach((task) => deleteTask(task.id));
    setShowClearFailedConfirm(false);
    MessagePlugin.success(`已清除 ${failedTasks.length} 个失败任务`);
  }, [tasks, deleteTask]);

  // Fuzzy match helper: all tokens must be present in concatenated fields
  const taskMatchesQuery = (task: any, query: string) => {
    if (!query.trim()) return true;
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    // Note: PENDING is deprecated, displayed as '处理中' for legacy compatibility
    const statusLabelMap: Record<TaskStatus, string> = {
      [TaskStatus.PENDING]: '处理中',
      [TaskStatus.PROCESSING]: '处理中',
      [TaskStatus.COMPLETED]: '已完成',
      [TaskStatus.FAILED]: '失败',
      [TaskStatus.CANCELLED]: '已取消',
    };

    const haystackParts: string[] = [];
    haystackParts.push(task.params?.prompt ?? '');
    haystackParts.push(task.params?.model ?? '');
    haystackParts.push(task.id ?? '');
    haystackParts.push(
      statusLabelMap[task.status as TaskStatus] ?? String(task.status)
    );
    if (task.params?.batchId) haystackParts.push(String(task.params.batchId));
    if (task.params?.batchIndex)
      haystackParts.push(String(task.params.batchIndex));
    if (task.params?.batchTotal)
      haystackParts.push(String(task.params.batchTotal));
    if (task.result?.format) haystackParts.push(String(task.result.format));
    if (task.result?.width && task.result?.height) {
      haystackParts.push(`${task.result.width}x${task.result.height}`);
    } else if (task.params?.width && task.params?.height) {
      haystackParts.push(`${task.params.width}x${task.params.height}`);
    }

    const haystack = haystackParts.join(' ').toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  };

  // Filter tasks by IDs and search text (type filtering is now done via RPC)
  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    // 如果指定了 taskIds，进行过滤
    if (taskIds && taskIds.length > 0) {
      filtered = filtered.filter((task) => taskIds.includes(task.id));
    }

    // 本地搜索过滤
    if (searchText.trim()) {
      filtered = filtered.filter((t) => taskMatchesQuery(t, searchText));
    }

    // Sort by creation time - newest first
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [tasks, taskIds, searchText]);

  // Task action handlers
  const handleRetry = (taskId: string) => {
    retryTask(taskId);
  };

  const handleDelete = (taskId: string) => {
    setTaskToDelete(taskId);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (taskToDelete) {
      deleteTask(taskToDelete);
    }
    setShowDeleteConfirm(false);
    setTaskToDelete(null);
  };

  const handleDownload = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task?.result?.url && !task?.result?.urls?.length) return;

    const urls = task.result.urls?.length
      ? task.result.urls
      : [task.result.url];

    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const filename = `${sanitizeFilename(task.params.prompt) || task.type}${
          urls.length > 1 ? `-${i + 1}` : ''
        }.${task.result.format}`;
        const cachedBlob = await unifiedCacheService.getCachedBlob(url);
        if (cachedBlob) {
          downloadFromBlob(cachedBlob, filename);
          continue;
        }
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
      MessagePlugin.success(urls.length > 1 ? '多图已开始下载' : '下载成功');
    } catch (error) {
      console.error('Download failed:', error);
      MessagePlugin.error('下载失败，请稍后重试');
    }
  };

  const handleInsert = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if ((!task?.result?.url && !task?.result?.urls?.length) || !board) {
      console.warn('Cannot insert: task result or board not available');
      MessagePlugin.warning('无法插入：白板未就绪');
      return;
    }

    try {
      if (task.type === TaskType.IMAGE) {
        const urls = task.result.urls?.length
          ? task.result.urls
          : [task.result.url];
        for (const url of urls) {
          await insertImageFromUrl(board, url);
        }
        MessagePlugin.success(
          urls.length > 1 ? '多图已插入到白板' : '图片已插入到白板'
        );
      } else if (task.type === TaskType.VIDEO) {
        await insertVideoFromUrl(board, task.result.url);
        MessagePlugin.success('视频已插入到白板');
      }
    } catch (error) {
      console.error('Failed to insert to board:', error);
      MessagePlugin.error(
        `插入失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  };

  const handleEdit = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      console.warn('Cannot edit: task not found');
      return;
    }

    // 如果有 onEditTask 回调（从弹窗内部调用），直接更新父组件表单
    if (onEditTask) {
      onEditTask(task);
      return;
    }

    // 否则打开新的对话框（从任务队列面板调用）
    if (task.type === TaskType.IMAGE) {
      // 准备图片生成初始数据
      const initialData = {
        initialPrompt: task.params.prompt,
        initialWidth: task.params.width,
        initialHeight: task.params.height,
        initialImages: task.params.uploadedImages, // 传递上传的参考图片(数组)
        initialResultUrl: task.result?.url, // 传递结果URL用于预览
        initialResultUrls: task.result?.urls, // 多图结果
      };
      openDialog(DialogType.aiImageGeneration, initialData);
    } else if (task.type === TaskType.VIDEO) {
      // 准备视频生成初始数据
      const initialData = {
        initialPrompt: task.params.prompt,
        initialDuration:
          typeof task.params.seconds === 'string'
            ? parseInt(task.params.seconds, 10)
            : task.params.seconds, // 确保转换为数字
        initialModel: task.params.model, // 传递模型
        initialSize: task.params.size, // 传递尺寸
        initialImages: task.params.uploadedImages, // 传递上传的图片（多图片格式）
        initialResultUrl: task.result?.url, // 传递结果URL用于预览
        initialResultUrls: task.result?.urls, // 多图/多视频结果
      };
      // console.log('DialogTaskList - handleEdit VIDEO task:', {
      //   taskId,
      //   taskParams: task.params,
      //   initialData
      // });
      openDialog(DialogType.aiVideoGeneration, initialData);
    }
  };

  // Handle extract character action
  const handleExtractCharacter = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setCharacterDialogTask(task);
    }
  };

  // Get completed tasks with results for navigation (deduplicated by ID)
  const completedTasksWithResults = useMemo(() => {
    const seen = new Set<string>();
    return filteredTasks.filter((t) => {
      if (t.status !== TaskStatus.COMPLETED) return false;
      if (!t.result?.url && !t.result?.urls?.length) return false;
      if (seen.has(t.id)) return false;
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
      const mediaType =
        task.type === TaskType.VIDEO ? ('video' as const) : ('image' as const);
      const title = task.params.prompt?.substring(0, 50);

      // 记录该任务第一张图在列表中的索引
      indexMap.set(task.id, items.length);

      for (let i = 0; i < urls.length; i++) {
        items.push({
          id: urls.length > 1 ? `${task.id}-${i}` : task.id,
          url: urls[i],
          type: mediaType,
          title: urls.length > 1 ? `${title} (${i + 1}/${urls.length})` : title,
        });
      }
    }

    return { previewMediaItems: items, taskIdToPreviewIndex: indexMap };
  }, [completedTasksWithResults]);

  // Preview handlers - 使用 Map 精确查找索引
  const handlePreviewOpen = useCallback(
    (taskId: string) => {
      const index = taskIdToPreviewIndex.get(taskId);
      if (index !== undefined) {
        setPreviewInitialIndex(index);
        setPreviewVisible(true);
      }
    },
    [taskIdToPreviewIndex]
  );

  const handlePreviewClose = useCallback(() => {
    setPreviewVisible(false);
  }, []);

  // 判断是否有搜索但无匹配
  const hasSearchNoMatch =
    searchText.trim() && filteredTasks.length === 0 && tasks.length > 0;

  // 显示的总数（优先使用 RPC 返回的总数）
  const displayTotalCount = totalCount > 0 ? totalCount : tasks.length;

  return (
    <>
      <div className="dialog-task-list">
        <div className="dialog-task-list__header">
          <div className="dialog-task-list__header-main">
            <h4>生成任务 ({displayTotalCount})</h4>
            <div className="dialog-task-list__header-actions">
              {failedTaskCount > 0 && (
                <Tooltip
                  content={`清除全部失败任务 (${failedTaskCount})`}
                  theme="light"
                >
                  <Button
                    size="small"
                    variant="text"
                    icon={<DeleteIcon />}
                    onClick={() => setShowClearFailedConfirm(true)}
                  />
                </Tooltip>
              )}
            </div>
          </div>
          <div className="dialog-task-list__search">
            <Input
              value={searchText}
              onChange={(v) => setSearchText(v)}
              placeholder="搜索任务（提示词/模型/...）"
              clearable
              prefixIcon={<SearchIcon />}
              size="small"
            />
          </div>
        </div>
        <VirtualTaskList
          tasks={filteredTasks}
          onRetry={handleRetry}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onInsert={handleInsert}
          onEdit={handleEdit}
          onPreviewOpen={handlePreviewOpen}
          onExtractCharacter={handleExtractCharacter}
          hasMore={hasMore && !searchText.trim()}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMore}
          totalCount={displayTotalCount}
          loadedCount={loadedCount}
          className="dialog-task-list__content"
          emptyContent={
            <div className="dialog-task-list__empty">
              {isLoading ? (
                <p>加载中...</p>
              ) : hasSearchNoMatch ? (
                <p>未找到匹配的任务</p>
              ) : (
                <p>暂无生成任务</p>
              )}
            </div>
          }
        />
      </div>

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

      {/* Clear Failed Tasks Confirmation Dialog */}
      <Dialog
        visible={showClearFailedConfirm}
        header="清除失败任务"
        onClose={() => setShowClearFailedConfirm(false)}
        onConfirm={handleClearFailed}
        onCancel={() => setShowClearFailedConfirm(false)}
      >
        确定要清除全部 {failedTaskCount} 个失败任务吗？此操作无法撤销。
      </Dialog>

      {/* Unified Preview */}
      <UnifiedMediaViewer
        visible={previewVisible}
        items={previewMediaItems}
        initialIndex={previewInitialIndex}
        onClose={handlePreviewClose}
        showThumbnails={true}
      />

      {/* Character Create Dialog */}
      <CharacterCreateDialog
        visible={!!characterDialogTask}
        task={characterDialogTask}
        onClose={() => setCharacterDialogTask(null)}
        onCreateComplete={(characterId) => {
          // console.log('Character created:', characterId);
          setCharacterDialogTask(null);
        }}
      />
    </>
  );
};
