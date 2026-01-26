/**
 * Media Library Inspector
 * 素材库详情面板组件
 */

import { useState, useCallback, useMemo } from 'react';
import { Button, Input, Dialog, MessagePlugin } from 'tdesign-react';
import {
  Download,
  Trash2,
  Edit2,
  CheckCircle,
  Copy,
} from 'lucide-react';
import { formatDate, formatFileSize } from '../../utils/asset-utils';
import { useAssetSize } from '../../hooks/useAssetSize';
import { isCacheUrl, countElementsByAssetUrl } from '../../utils/asset-cleanup';
import { useDrawnix } from '../../hooks/use-drawnix';
import type { MediaLibraryInspectorProps } from '../../types/asset.types';
import './MediaLibraryInspector.scss';

/**
 * 获取预览图 URL（通过添加查询参数）
 * @param originalUrl 原始 URL
 * @param size 预览图尺寸（默认 small）
 */
function getThumbnailUrl(originalUrl: string, size: 'small' | 'large' = 'small'): string {
  try {
    const url = new URL(originalUrl, window.location.origin);
    url.searchParams.set('thumbnail', size);
    return url.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接参数
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}thumbnail=${size}`;
  }
}

export function MediaLibraryInspector({
  asset,
  onRename,
  onDelete,
  onDownload,
  onSelect,
  showSelectButton,
  selectButtonText = '使用',
}: MediaLibraryInspectorProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const { board } = useDrawnix();

  // 获取实际文件大小（支持从缓存获取）
  const displaySize = useAssetSize(asset?.id, asset?.url, asset?.size);

  // 检查素材是否为缓存类型（合并图片/视频），并统计画布中使用该素材的元素数量
  const { isCacheAsset, canvasElementCount } = useMemo(() => {
    if (!asset || !board) {
      return { isCacheAsset: false, canvasElementCount: 0 };
    }
    const isCache = isCacheUrl(asset.url);
    const count = isCache ? countElementsByAssetUrl(board, asset.url) : 0;
    return { isCacheAsset: isCache, canvasElementCount: count };
  }, [asset, board]);

  // 开始重命名
  const handleStartRename = useCallback(() => {
    if (asset) {
      setNewName(asset.name);
      setIsRenaming(true);
    }
  }, [asset]);

  // 确认重命名（blur 或 Enter 时触发）
  const handleConfirmRename = useCallback(async () => {
    if (!asset) {
      setIsRenaming(false);
      return;
    }
    
    const trimmedName = newName.trim();
    // 如果名称为空或没有变化，取消编辑
    if (!trimmedName || trimmedName === asset.name) {
      setIsRenaming(false);
      setNewName('');
      return;
    }

    try {
      await onRename(asset.id, trimmedName);
      setIsRenaming(false);
      // Toast 已在 Context 中显示，这里不重复
    } catch (error) {
      // 错误已在Context中处理
      setIsRenaming(false);
    }
  }, [asset, newName, onRename]);

  // 处理键盘事件（Escape 取消）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsRenaming(false);
      setNewName('');
    }
  }, []);

  // 打开删除确认对话框
  const handleOpenDeleteDialog = useCallback(() => {
    setDeleteDialogVisible(true);
  }, []);

  // 确认删除
  const handleConfirmDelete = useCallback(async () => {
    if (!asset) return;

    try {
      await onDelete(asset.id);
      setDeleteDialogVisible(false);
      MessagePlugin.success('删除成功');
    } catch (error) {
      // 错误已在Context中处理
    }
  }, [asset, onDelete]);

  // 下载素材
  const handleDownload = useCallback(() => {
    if (asset) {
      onDownload(asset);
      MessagePlugin.success('开始下载');
    }
  }, [asset, onDownload]);

  // 使用到画板
  const handleSelect = useCallback(() => {
    if (asset && onSelect) {
      onSelect(asset);
    }
  }, [asset, onSelect]);

  // 复制提示词
  const handleCopyPrompt = useCallback(async () => {
    if (asset?.prompt) {
      try {
        await navigator.clipboard.writeText(asset.prompt);
        MessagePlugin.success('提示词已复制');
      } catch {
        MessagePlugin.error('复制失败');
      }
    }
  }, [asset?.prompt]);

  if (!asset) {
    return (
      <div className="media-library-inspector media-library-inspector--empty">
        <p>选择素材查看详情</p>
      </div>
    );
  }

  return (
    <div className="media-library-inspector">
      {/* 预览 */}
      <div className="media-library-inspector__preview">
        {asset.type === 'IMAGE' ? (
          <img
            src={getThumbnailUrl(asset.url, 'large')}
            alt={asset.name}
            className="media-library-inspector__image"
            onError={(e) => {
              // 预览图加载失败，回退到原图
              (e.target as HTMLImageElement).src = asset.url;
            }}
          />
        ) : (
          <video
            src={asset.url}
            controls
            className="media-library-inspector__video"
            poster={getThumbnailUrl(asset.url, 'large')}
          />
        )}
      </div>

      {/* 名称编辑 */}
      <div className="media-library-inspector__name-section">
        {isRenaming ? (
          <div className="media-library-inspector__name-edit">
            <Input
              value={newName}
              onChange={(value) => setNewName(value as string)}
              autofocus
              onBlur={handleConfirmRename}
              onEnter={handleConfirmRename}
              onKeydown={handleKeyDown}
              placeholder="输入名称，按 Enter 或点击外部保存"
            />
          </div>
        ) : (
          <div className="media-library-inspector__name-display">
            <h3 className="media-library-inspector__name" title={asset.name}>
              {asset.name}
            </h3>
            <Button
              size="small"
              variant="text"
              icon={<Edit2 size={14} />}
              onClick={handleStartRename}
              data-track="inspector_rename_start"
            />
          </div>
        )}
      </div>

      {/* 元数据 */}
      <div className="media-library-inspector__metadata">
        <div className="media-library-inspector__meta-item">
          <span className="media-library-inspector__meta-label">类型</span>
          <span className="media-library-inspector__meta-value">
            {asset.type === 'IMAGE' ? '图片' : '视频'}
          </span>
        </div>
        <div className="media-library-inspector__meta-item">
          <span className="media-library-inspector__meta-label">来源</span>
          <span className="media-library-inspector__meta-value">
            {asset.source === 'AI_GENERATED' ? 'AI生成' : '本地上传'}
          </span>
        </div>
        <div className="media-library-inspector__meta-item">
          <span className="media-library-inspector__meta-label">创建时间</span>
          <span className="media-library-inspector__meta-value">
            {formatDate(asset.createdAt)}
          </span>
        </div>
        {displaySize && (
          <div className="media-library-inspector__meta-item">
            <span className="media-library-inspector__meta-label">文件大小</span>
            <span className="media-library-inspector__meta-value">
              {formatFileSize(displaySize)}
            </span>
          </div>
        )}
      </div>

      {/* 提示词区域 - 仅 AI 生成的素材显示 */}
      {asset.prompt && (
        <div className="media-library-inspector__prompt-section">
          <div className="media-library-inspector__prompt-header">
            <span className="media-library-inspector__prompt-label">提示词</span>
            <Button
              size="small"
              variant="text"
              icon={<Copy size={12} />}
              onClick={handleCopyPrompt}
              data-track="inspector_copy_prompt"
            >
              复制
            </Button>
          </div>
          <div className="media-library-inspector__prompt-content">
            {asset.prompt}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className={`media-library-inspector__actions ${showSelectButton && onSelect ? 'media-library-inspector__actions--with-select' : 'media-library-inspector__actions--no-select'}`}>
        {showSelectButton && onSelect && (
          <Button
            theme="primary"
            block
            icon={<CheckCircle size={16} />}
            onClick={handleSelect}
            data-track="inspector_use_asset"
            className="inspector-btn-select"
          >
            {selectButtonText}
          </Button>
        )}
        <Button
          variant="outline"
          block
          icon={<Download size={16} />}
          onClick={handleDownload}
          data-track="inspector_download"
          className="inspector-btn-download"
        >
          下载
        </Button>
        <Button
          theme="danger"
          variant="outline"
          block
          icon={<Trash2 size={16} />}
          onClick={handleOpenDeleteDialog}
          data-track="inspector_delete"
          className="inspector-btn-delete"
        >
          删除
        </Button>
      </div>

      {/* 删除确认对话框 */}
      <Dialog
        visible={deleteDialogVisible}
        onClose={() => setDeleteDialogVisible(false)}
        header="确认删除"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteDialogVisible(false)}
        confirmBtn="删除"
        cancelBtn="取消"
      >
        <p>删除后无法恢复，确认删除该素材？</p>
        <p style={{ marginTop: '8px', color: 'var(--td-text-color-secondary)' }}>
          素材名称: <strong>{asset.name}</strong>
        </p>
        {isCacheAsset && canvasElementCount > 0 && (
          <p style={{ marginTop: '8px', color: 'var(--td-error-color)' }}>
            ⚠️ 画布中有 <strong>{canvasElementCount}</strong> 个元素正在使用此素材，删除后这些元素也将被移除！
          </p>
        )}
      </Dialog>
    </div>
  );
}
