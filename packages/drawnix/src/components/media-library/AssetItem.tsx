/**
 * Asset Item
 * 统一素材项组件 - 支持网格、紧凑、列表三种视图模式
 * 切换视图模式时组件不销毁，只更新样式，避免图片重新加载
 */

import { memo, useCallback, useState } from 'react';
import { Image as ImageIcon, Video as VideoIcon, Plus } from 'lucide-react';
import { Checkbox, Tooltip } from 'tdesign-react';
import { formatDate, formatFileSize } from '../../utils/asset-utils';
import { useAssetSize } from '../../hooks/useAssetSize';
import { LazyImage } from '../lazy-image';
import { useThumbnailUrl } from '../../hooks/useThumbnailUrl';
import type { Asset, ViewMode } from '../../types/asset.types';
import './AssetItem.scss';

export interface AssetItemProps {
  asset: Asset;
  viewMode: ViewMode;
  isSelected: boolean;
  onSelect: (assetId: string, event?: React.MouseEvent) => void;
  onDoubleClick?: (asset: Asset) => void;
  onPreview?: (asset: Asset) => void;
  isInSelectionMode?: boolean;
}

export const AssetItem = memo<AssetItemProps>(
  ({ asset, viewMode, isSelected, onSelect, onDoubleClick, onPreview, isInSelectionMode }) => {
    // 获取实际文件大小（支持从缓存获取）
    const displaySize = useAssetSize(asset.id, asset.url, asset.size);
    const [isHovered, setIsHovered] = useState(false);
    
    // 根据视图模式选择预览图尺寸
    // 网格视图（120-180px）使用大尺寸预览图，紧凑/列表视图（60-80px）使用小尺寸预览图
    const thumbnailSize = viewMode === 'grid' ? 'large' : 'small';
    const thumbnailUrl = useThumbnailUrl(
      asset.url,
      asset.type === 'IMAGE' ? 'image' : 'video',
      thumbnailSize
    );

    const handleClick = useCallback((e: React.MouseEvent) => {
      onSelect(asset.id, e);
    }, [asset.id, onSelect]);

    const handleDoubleClick = useCallback(() => {
      // 双击预览
      if (onPreview && !isInSelectionMode) {
        onPreview(asset);
      }
    }, [asset, onPreview, isInSelectionMode]);

    const handleCheckboxChange = useCallback(() => {
      onSelect(asset.id);
    }, [asset.id, onSelect]);

    const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
    }, []);

    // 插入功能（原来的双击功能）
    const handleInsertClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onDoubleClick?.(asset);
    }, [asset, onDoubleClick]);

    const handleMouseEnter = useCallback(() => {
      setIsHovered(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
      setIsHovered(false);
    }, []);

    const itemClassName = [
      'asset-item',
      `asset-item--${viewMode}`,
      isSelected ? 'asset-item--selected' : '',
      isInSelectionMode ? 'asset-item--selection-mode' : '',
    ].filter(Boolean).join(' ');

    const isListMode = viewMode === 'list';
    const isCompactMode = viewMode === 'compact';

    return (
      <div
        className={itemClassName}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={0}
        data-track={`asset_item_click_${viewMode}`}
      >
        {/* 列表模式：左侧复选框 */}
        {isListMode && isInSelectionMode && (
          <div className="asset-item__checkbox asset-item__checkbox--left" onClick={handleCheckboxClick}>
            <Checkbox
              checked={isSelected}
              onChange={handleCheckboxChange}
              data-track="asset_item_checkbox"
            />
          </div>
        )}

        {/* 缩略图容器 - 所有模式共享，切换时不销毁 */}
        <div className="asset-item__thumbnail">
          {asset.type === 'IMAGE' ? (
            <LazyImage
              src={thumbnailUrl || asset.url}
              alt={asset.name}
              className="asset-item__image"
              rootMargin="100px"
            />
          ) : (
            <video
              src={asset.url}
              className="asset-item__video"
              muted
              preload="metadata"
              poster={thumbnailUrl || undefined}
            />
          )}

          {/* 网格/紧凑模式：徽章 */}
          {!isListMode && !isCompactMode && (
            <div className="asset-item__badges">
              <div className="asset-item__type-badge">
                {asset.type === 'IMAGE' ? <ImageIcon /> : <VideoIcon />}
              </div>
              {asset.source === 'AI_GENERATED' && (
                <div className="asset-item__ai-badge">AI</div>
              )}
            </div>
          )}

          {/* 网格模式：选择复选框 */}
          {!isListMode && isInSelectionMode && (
            <div className="asset-item__checkbox asset-item__checkbox--overlay" onClick={handleCheckboxClick}>
              <Checkbox
                checked={isSelected}
                onChange={handleCheckboxChange}
                data-track="asset_item_checkbox"
              />
            </div>
          )}

          {/* 插入按钮 - hover 时显示（非列表模式） */}
          {!isListMode && isHovered && !isInSelectionMode && onDoubleClick && (
            <Tooltip content="插入到画布" theme="light" showArrow={false}>
              <button
                className="asset-item__preview-btn"
                onClick={handleInsertClick}
                data-track="asset_item_insert"
              >
                <Plus size={16} />
              </button>
            </Tooltip>
          )}

          {/* 网格模式：渐变遮罩和名称 */}
          {!isListMode && !isCompactMode && (
            <>
              <div className="asset-item__overlay" />
              <div className="asset-item__name-overlay" title={asset.name}>
                {asset.name}
              </div>
            </>
          )}
        </div>

        {/* 列表模式：信息区域 */}
        {isListMode && (
          <div className="asset-item__info">
            <div className="asset-item__name" title={asset.name}>
              {asset.name}
            </div>
            <div className="asset-item__meta">
              <span className="asset-item__type">
                {asset.type === 'IMAGE' ? <ImageIcon size={12} /> : <VideoIcon size={12} />}
                {asset.type === 'IMAGE' ? '图片' : '视频'}
              </span>
              {displaySize && (
                <span className="asset-item__size">{formatFileSize(displaySize)}</span>
              )}
              <span className="asset-item__date">{formatDate(asset.createdAt)}</span>
            </div>
          </div>
        )}

        {/* 列表模式：AI 标识 */}
        {isListMode && asset.source === 'AI_GENERATED' && (
          <div className="asset-item__ai-badge asset-item__ai-badge--list">AI</div>
        )}

        {/* 列表模式：插入按钮 */}
        {isListMode && isHovered && !isInSelectionMode && onDoubleClick && (
          <Tooltip content="插入到画布" theme="light" showArrow={false}>
            <button
              className="asset-item__preview-btn"
              onClick={handleInsertClick}
              data-track="asset_item_insert"
            >
              <Plus size={16} />
            </button>
          </Tooltip>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数：只有关键属性变化时才重新渲染
    return (
      prevProps.asset.id === nextProps.asset.id &&
      prevProps.asset.name === nextProps.asset.name && // 检查名称变化（重命名后更新）
      prevProps.viewMode === nextProps.viewMode &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isInSelectionMode === nextProps.isInSelectionMode &&
      prevProps.onDoubleClick === nextProps.onDoubleClick
    );
  },
);

AssetItem.displayName = 'AssetItem';
