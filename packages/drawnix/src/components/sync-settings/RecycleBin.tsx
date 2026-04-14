/**
 * 回收站组件
 * 显示已删除的画板、提示词、任务，支持恢复和永久删除
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button, MessagePlugin, Loading, Input } from 'tdesign-react';
import {
  DeleteIcon,
  RefreshIcon,
  RollbackIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  LinkIcon,
} from 'tdesign-icons-react';
import { syncEngine } from '../../services/github-sync';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import type { DeletedItems } from '../../services/github-sync/types';

/** 构建画板文件的 Gist URL */
function getBoardGistUrl(gistId: string, boardId: string): string {
  return `https://gist.github.com/${gistId}#file-board_${boardId.replace(/-/g, '-')}-json`;
}

interface RecycleBinProps {
  isConnected: boolean;
  onRefresh?: () => void;
}

/**
 * 格式化时间为相对时间
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 30) return `${diffDays} 天前`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * 回收站组件
 */
export function RecycleBin({ isConnected, onRefresh }: RecycleBinProps) {
  const [expanded, setExpanded] = useState(false);
  const [deletedItems, setDeletedItems] = useState<DeletedItems | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [gistId, setGistId] = useState<string | null>(null);
  
  // 确认对话框状态
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<{
    type: 'board' | 'prompt' | 'task';
    id: string;
    name: string;
  } | null>(null);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [emptyConfirmText, setEmptyConfirmText] = useState('');
  const [isEmptying, setIsEmptying] = useState(false);

  // 加载回收站数据
  const loadDeletedItems = useCallback(async () => {
    if (!isConnected) return;
    
    setIsLoading(true);
    try {
      const [items, config] = await Promise.all([
        syncEngine.getDeletedItems(),
        syncEngine.getConfig(),
      ]);
      setDeletedItems(items);
      setGistId(config.gistId || null);
    } catch (err) {
      console.error('[RecycleBin] Failed to load deleted items:', err);
      MessagePlugin.error('加载回收站失败');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

  // 展开时加载数据
  useEffect(() => {
    if (expanded && isConnected) {
      loadDeletedItems();
    }
  }, [expanded, isConnected, loadDeletedItems]);

  // 恢复项目
  const handleRestore = useCallback(async (type: 'board' | 'prompt' | 'task', id: string) => {
    setRestoringId(id);
    try {
      const result = await syncEngine.restoreItem(type, id);
      if (result.success) {
        MessagePlugin.success('已恢复');
        loadDeletedItems();
        onRefresh?.();
      } else {
        MessagePlugin.error(result.error || '恢复失败');
      }
    } catch (err) {
      MessagePlugin.error('恢复失败');
    } finally {
      setRestoringId(null);
    }
  }, [loadDeletedItems, onRefresh]);

  // 永久删除项目
  const handlePermanentDelete = useCallback(async () => {
    if (!deleteConfirmItem) return;
    
    setDeletingId(deleteConfirmItem.id);
    try {
      const result = await syncEngine.permanentlyDelete(
        deleteConfirmItem.type, 
        deleteConfirmItem.id
      );
      if (result.success) {
        MessagePlugin.success('已永久删除');
        loadDeletedItems();
      } else {
        MessagePlugin.error(result.error || '删除失败');
      }
    } catch (err) {
      MessagePlugin.error('删除失败');
    } finally {
      setDeletingId(null);
      setDeleteConfirmItem(null);
    }
  }, [deleteConfirmItem, loadDeletedItems]);

  // 清空回收站
  const handleEmptyRecycleBin = useCallback(async () => {
    if (emptyConfirmText !== '确认清空') {
      MessagePlugin.warning('请输入"确认清空"以继续');
      return;
    }
    
    setIsEmptying(true);
    try {
      const result = await syncEngine.emptyRecycleBin();
      if (result.success) {
        const total = result.deletedBoards + result.deletedPrompts + result.deletedTasks;
        MessagePlugin.success(`已清空回收站 (${total} 项)`);
        loadDeletedItems();
      } else {
        MessagePlugin.error(result.error || '清空失败');
      }
    } catch (err) {
      MessagePlugin.error('清空失败');
    } finally {
      setIsEmptying(false);
      setShowEmptyConfirm(false);
      setEmptyConfirmText('');
    }
  }, [emptyConfirmText, loadDeletedItems]);

  // 计算总项目数
  const totalItems = deletedItems 
    ? deletedItems.boards.length + deletedItems.prompts.length + deletedItems.tasks.length
    : 0;

  const isEmpty = totalItems === 0;

  if (!isConnected) {
    return null;
  }

  return (
    <>
      <div className="sync-settings__recycle-bin">
        <div 
          className="sync-settings__recycle-bin-header"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <span>回收站</span>
          {!expanded && totalItems > 0 && (
            <span className="sync-settings__recycle-bin-count">
              {totalItems} 项
            </span>
          )}
        </div>
        
        {expanded && (
          <div className="sync-settings__recycle-bin-content">
            {isLoading ? (
              <div className="sync-settings__recycle-bin-loading">
                <Loading size="small" />
                <span>加载中...</span>
              </div>
            ) : isEmpty ? (
              <div className="sync-settings__recycle-bin-empty">
                回收站是空的
              </div>
            ) : (
              <>
                {/* 画板列表 */}
                {deletedItems?.boards && deletedItems.boards.length > 0 && (
                  <div className="sync-settings__recycle-group">
                    <div className="sync-settings__recycle-group-header">
                      画板 ({deletedItems.boards.length})
                    </div>
                    {deletedItems.boards.map(board => (
                      <div key={board.id} className="sync-settings__recycle-item">
                        <div className="sync-settings__recycle-item-info">
                          <span className="sync-settings__recycle-item-name">
                            {board.name}
                          </span>
                          <span className="sync-settings__recycle-item-time">
                            {formatRelativeTime(board.deletedAt)}
                          </span>
                        </div>
                        <div className="sync-settings__recycle-item-actions">
                          {gistId && (
                            <Button
                              variant="text"
                              size="small"
                              icon={<LinkIcon />}
                              onClick={() => window.open(getBoardGistUrl(gistId, board.id), '_blank')}
                              title="在 GitHub 查看文件"
                            >
                              查看
                            </Button>
                          )}
                          <Button
                            variant="text"
                            size="small"
                            icon={restoringId === board.id ? <Loading /> : <RollbackIcon />}
                            disabled={restoringId === board.id}
                            onClick={() => handleRestore('board', board.id)}
                          >
                            恢复
                          </Button>
                          <Button
                            variant="text"
                            size="small"
                            className="sync-settings__delete-btn"
                            icon={deletingId === board.id ? <Loading /> : <DeleteIcon />}
                            disabled={deletingId === board.id}
                            onClick={() => setDeleteConfirmItem({
                              type: 'board',
                              id: board.id,
                              name: board.name,
                            })}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 提示词列表 */}
                {deletedItems?.prompts && deletedItems.prompts.length > 0 && (
                  <div className="sync-settings__recycle-group">
                    <div className="sync-settings__recycle-group-header">
                      提示词 ({deletedItems.prompts.length})
                    </div>
                    {deletedItems.prompts.map(prompt => (
                      <div key={prompt.id} className="sync-settings__recycle-item">
                        <div className="sync-settings__recycle-item-info">
                          <span className="sync-settings__recycle-item-name">
                            {prompt.content || prompt.id}
                          </span>
                          <span className="sync-settings__recycle-item-time">
                            {formatRelativeTime(prompt.deletedAt)}
                          </span>
                        </div>
                        <div className="sync-settings__recycle-item-actions">
                          <Button
                            variant="text"
                            size="small"
                            disabled
                          >
                            暂不支持
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 任务列表 */}
                {deletedItems?.tasks && deletedItems.tasks.length > 0 && (
                  <div className="sync-settings__recycle-group">
                    <div className="sync-settings__recycle-group-header">
                      任务 ({deletedItems.tasks.length})
                    </div>
                    {deletedItems.tasks.map(task => (
                      <div key={task.taskId} className="sync-settings__recycle-item">
                        <div className="sync-settings__recycle-item-info">
                          <span className="sync-settings__recycle-item-name">
                            {task.name || task.taskId}
                          </span>
                          <span className="sync-settings__recycle-item-time">
                            {formatRelativeTime(task.deletedAt)}
                          </span>
                        </div>
                        <div className="sync-settings__recycle-item-actions">
                          <Button
                            variant="text"
                            size="small"
                            disabled
                          >
                            暂不支持
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="sync-settings__recycle-actions">
                  <Button
                    variant="outline"
                    size="small"
                    theme="danger"
                    onClick={() => setShowEmptyConfirm(true)}
                    disabled={isEmpty}
                  >
                    清空回收站
                  </Button>
                  <Button
                    variant="text"
                    size="small"
                    icon={<RefreshIcon />}
                    onClick={loadDeletedItems}
                    disabled={isLoading}
                  >
                    刷新
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 永久删除确认对话框 */}
      <ConfirmDialog
        open={!!deleteConfirmItem}
        title="永久删除"
        confirmText="确认删除"
        cancelText="取消"
        danger
        confirmLoading={!!deletingId}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmItem(null);
          }
        }}
        onConfirm={handlePermanentDelete}
      >
        <p>确定要永久删除 "{deleteConfirmItem?.name}" 吗？</p>
        <p style={{ color: '#e34d59' }}>
          此操作不可撤销，数据将从云端永久删除。
        </p>
      </ConfirmDialog>

      {/* 清空回收站确认对话框 */}
      <ConfirmDialog
        open={showEmptyConfirm}
        title="清空回收站"
        confirmText="永久删除全部"
        cancelText="取消"
        danger
        confirmLoading={isEmptying}
        confirmDisabled={emptyConfirmText !== '确认清空'}
        onOpenChange={(open) => {
          if (!open) {
            setShowEmptyConfirm(false);
            setEmptyConfirmText('');
          }
        }}
        onConfirm={handleEmptyRecycleBin}
      >
        <p>此操作将永久删除回收站中的所有数据：</p>
        <ul style={{ margin: '12px 0', paddingLeft: '20px' }}>
          {deletedItems?.boards && deletedItems.boards.length > 0 && (
            <li>{deletedItems.boards.length} 个画板</li>
          )}
          {deletedItems?.prompts && deletedItems.prompts.length > 0 && (
            <li>{deletedItems.prompts.length} 条提示词</li>
          )}
          {deletedItems?.tasks && deletedItems.tasks.length > 0 && (
            <li>{deletedItems.tasks.length} 个任务</li>
          )}
        </ul>
        <p style={{ marginBottom: '12px' }}>
          请输入 <strong>确认清空</strong> 以继续：
        </p>
        <Input
          value={emptyConfirmText}
          onChange={(val) => setEmptyConfirmText(val as string)}
          placeholder='输入"确认清空"'
        />
      </ConfirmDialog>
    </>
  );
}
