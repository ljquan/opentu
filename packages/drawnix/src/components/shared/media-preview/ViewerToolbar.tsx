/**
 * 统一媒体预览系统 - 工具栏组件
 */

import React, { useCallback } from 'react';
import {
  X,
  Columns,
  Rows,
  Grid2x2,
  Link,
  Unlink,
  RotateCcw,
  Maximize2,
  ChevronLeft,
  Pencil,
  Check,
} from 'lucide-react';
import type { ViewerToolbarProps, ViewerMode, CompareLayout } from './types';
import { HoverPopover } from './HoverPopover';
import './ViewerToolbar.scss';

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  mode,
  currentIndex,
  totalCount,
  slotCount,
  compareLayout,
  syncMode,
  onModeChange,
  onSlotCountChange,
  onLayoutChange,
  onSyncToggle,
  onResetView,
  onClose,
  onFullscreen,
  isImage = false,
  showEditButton = false,
  onBackToPreview,
  onResetEdit,
  onSaveEdit,
}) => {
  // 处理布局切换，田字格自动切换到4分屏
  const handleLayoutChange = useCallback(
    (layout: CompareLayout) => {
      onLayoutChange(layout);
      // 选择田字格布局时，自动切换到4分屏
      if (layout === 'grid' && slotCount < 4) {
        onSlotCountChange(4);
      }
    },
    [onLayoutChange, onSlotCountChange, slotCount]
  );

  // 单图模式工具栏
  const renderSingleModeTools = () => (
    <>
      {/* 索引指示器 */}
      <div className="viewer-toolbar__indicator">
        <span className="viewer-toolbar__current">{currentIndex + 1}</span>
        <span className="viewer-toolbar__separator">/</span>
        <span className="viewer-toolbar__total">{totalCount}</span>
      </div>

      {/* 切换到对比模式 */}
      {totalCount > 1 && (
        <HoverPopover content="对比模式" placement="bottom" contentClassName="viewer-popover">
          <button
            className="viewer-toolbar__btn"
            onClick={() => onModeChange('compare')}
            aria-label="对比模式"
          >
            <Columns size={18} />
          </button>
        </HoverPopover>
      )}

      {/* 编辑按钮（仅图片可编辑） */}
      {showEditButton && isImage && (
        <>
          <div className="viewer-toolbar__divider" />
          <HoverPopover content="编辑图片" placement="bottom" contentClassName="viewer-popover">
            <button
              className="viewer-toolbar__btn"
              onClick={() => onModeChange('edit')}
              aria-label="编辑图片"
            >
              <Pencil size={18} />
            </button>
          </HoverPopover>
        </>
      )}
    </>
  );

  // 编辑模式工具栏
  const renderEditModeTools = () => (
    <>
      {/* 返回预览 */}
      <HoverPopover content="返回预览" placement="bottom" contentClassName="viewer-popover">
        <button
          className="viewer-toolbar__btn"
          onClick={onBackToPreview}
          aria-label="返回预览"
        >
          <ChevronLeft size={18} />
          <span className="viewer-toolbar__btn-text">返回</span>
        </button>
      </HoverPopover>

      <div className="viewer-toolbar__divider" />

      {/* 编辑标题 */}
      <div className="viewer-toolbar__title">编辑图片</div>
    </>
  );

  // 对比模式工具栏
  const renderCompareModeTools = () => (
    <>
      {/* 切换到单图模式 */}
      <HoverPopover content="单图模式" placement="bottom" contentClassName="viewer-popover">
        <button
          className="viewer-toolbar__btn"
          onClick={() => onModeChange('single')}
          aria-label="单图模式"
        >
          <ChevronLeft size={18} />
          <span className="viewer-toolbar__btn-text">单图</span>
        </button>
      </HoverPopover>

      <div className="viewer-toolbar__divider" />

      {/* 分屏数量 */}
      <div className="viewer-toolbar__group">
        <span className="viewer-toolbar__label">分屏</span>
        {[2, 3, 4].map((count) => (
          <React.Fragment key={count}>
            <HoverPopover content={`${count}分屏`} placement="bottom" contentClassName="viewer-popover">
              <button
                className={`viewer-toolbar__btn viewer-toolbar__btn--small ${
                  slotCount === count ? 'viewer-toolbar__btn--active' : ''
                }`}
                onClick={() => onSlotCountChange(count as 2 | 3 | 4)}
                aria-label={`${count}分屏`}
              >
                {count}
              </button>
            </HoverPopover>
          </React.Fragment>
        ))}
      </div>

      <div className="viewer-toolbar__divider" />

      {/* 布局切换 */}
      <div className="viewer-toolbar__group">
        <HoverPopover content="水平布局" placement="bottom" contentClassName="viewer-popover">
          <button
            className={`viewer-toolbar__btn ${
              compareLayout === 'horizontal' ? 'viewer-toolbar__btn--active' : ''
            }`}
            onClick={() => handleLayoutChange('horizontal')}
            aria-label="水平布局"
          >
            <Columns size={18} />
          </button>
        </HoverPopover>
        <HoverPopover content="垂直布局" placement="bottom" contentClassName="viewer-popover">
          <button
            className={`viewer-toolbar__btn ${
              compareLayout === 'vertical' ? 'viewer-toolbar__btn--active' : ''
            }`}
            onClick={() => handleLayoutChange('vertical')}
            aria-label="垂直布局"
          >
            <Rows size={18} />
          </button>
        </HoverPopover>
        <HoverPopover content="网格布局" placement="bottom" contentClassName="viewer-popover">
          <button
            className={`viewer-toolbar__btn ${
              compareLayout === 'grid' ? 'viewer-toolbar__btn--active' : ''
            }`}
            onClick={() => handleLayoutChange('grid')}
            aria-label="网格布局"
          >
            <Grid2x2 size={18} />
          </button>
        </HoverPopover>
      </div>

      <div className="viewer-toolbar__divider" />

      {/* 同步模式 */}
      <HoverPopover
        content={syncMode ? '取消联动（快捷键 S）' : '联动缩放/拖拽（快捷键 S）'}
        placement="bottom"
        contentClassName="viewer-popover"
      >
        <button
          className={`viewer-toolbar__btn ${
            syncMode ? 'viewer-toolbar__btn--active' : ''
          }`}
          onClick={onSyncToggle}
          aria-label={syncMode ? '取消联动' : '联动缩放/拖拽'}
        >
          {syncMode ? <Link size={18} /> : <Unlink size={18} />}
        </button>
      </HoverPopover>

      {/* 重置视图 - 仅在联动模式下显示 */}
      {syncMode && (
        <HoverPopover content="重置视图" placement="bottom" contentClassName="viewer-popover">
          <button className="viewer-toolbar__btn" onClick={onResetView}>
            <RotateCcw size={18} />
          </button>
        </HoverPopover>
      )}
    </>
  );

  // 渲染左侧工具栏
  const renderLeftTools = () => {
    switch (mode) {
      case 'edit':
        return renderEditModeTools();
      case 'compare':
        return renderCompareModeTools();
      default:
        return renderSingleModeTools();
    }
  };

  // 渲染右侧工具栏
  const renderRightTools = () => {
    if (mode === 'edit') {
      return (
        <>
          {/* 重置编辑 */}
          <HoverPopover content="重置" placement="bottom" contentClassName="viewer-popover">
            <button className="viewer-toolbar__btn" onClick={onResetEdit}>
              <RotateCcw size={18} />
            </button>
          </HoverPopover>

          {/* 保存 */}
          <HoverPopover content="保存" placement="bottom" contentClassName="viewer-popover">
            <button
              className="viewer-toolbar__btn viewer-toolbar__btn--primary"
              onClick={onSaveEdit}
              aria-label="保存"
            >
              <Check size={18} />
            </button>
          </HoverPopover>

          {/* 关闭 */}
          <HoverPopover content="关闭（Esc）" placement="bottom" contentClassName="viewer-popover">
            <button
              className="viewer-toolbar__btn viewer-toolbar__btn--close"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={20} />
            </button>
          </HoverPopover>
        </>
      );
    }

    return (
      <>
        {/* 全屏 */}
        {onFullscreen && (
          <HoverPopover content="全屏" placement="bottom" contentClassName="viewer-popover">
            <button className="viewer-toolbar__btn" onClick={onFullscreen}>
              <Maximize2 size={18} />
            </button>
          </HoverPopover>
        )}

        {/* 关闭 */}
        <HoverPopover content="关闭（Esc）" placement="bottom" contentClassName="viewer-popover">
          <button
            className="viewer-toolbar__btn viewer-toolbar__btn--close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </HoverPopover>
      </>
    );
  };

  // 编辑模式使用简化布局：左上角返回，右上角关闭
  if (mode === 'edit') {
    return (
      <div className="viewer-toolbar viewer-toolbar--edit-simplified">
        {/* 左上角返回按钮 */}
        <HoverPopover content="返回预览" placement="bottom" contentClassName="viewer-popover">
          <button
            className="viewer-toolbar__corner-btn viewer-toolbar__corner-btn--left"
            onClick={onBackToPreview}
            aria-label="返回预览"
          >
            <ChevronLeft size={20} />
            <span>返回</span>
          </button>
        </HoverPopover>

        {/* 右上角关闭按钮 */}
        <HoverPopover content="关闭（Esc）" placement="bottom" contentClassName="viewer-popover">
          <button
            className="viewer-toolbar__corner-btn viewer-toolbar__corner-btn--right"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </HoverPopover>
      </div>
    );
  }

  return (
    <div className="viewer-toolbar">
      <div className="viewer-toolbar__left">
        {renderLeftTools()}
      </div>

      <div className="viewer-toolbar__right">
        {renderRightTools()}
      </div>
    </div>
  );
};

export default ViewerToolbar;
