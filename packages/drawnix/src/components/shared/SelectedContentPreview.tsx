/**
 * SelectedContentPreview Component
 *
 * 选中内容预览组件，用于显示选中的图片、视频、图形、文字等内容
 * 支持悬停预览大图功能
 *
 * 使用场景：
 * - AIInputBar 中显示选中的画布元素
 * - EnhancedChatInput 中显示选中的内容
 */

import React, { useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Video, Play, Type, X } from 'lucide-react';
import type { SelectedContentItem } from '../../types/chat.types';
import { HoverTip } from './hover';
import { RetryImage } from '../retry-image';
import './selected-content-preview.scss';

export interface SelectedContentPreviewProps {
  /** 选中的内容列表 */
  items: SelectedContentItem[];
  /** 语言 */
  language?: 'zh' | 'en' | string;
  /** 是否启用悬停预览 */
  enableHoverPreview?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 删除回调（传入索引），如果提供则显示删除按钮 */
  onRemove?: (index: number) => void;
  /** 可删除的索引范围起始位置（默认 0，用于区分上传内容和选中内容） */
  removableStartIndex?: number;
}

interface HoveredContent {
  type: SelectedContentItem['type'];
  url?: string;
  maskImage?: string;
  width?: number;
  height?: number;
  text?: string;
  x: number;
  y: number;
}

function renderImageWithMask(
  item: Pick<SelectedContentItem, 'url' | 'maskImage' | 'name' | 'width' | 'height'>,
  className: string
) {
  if (!item.url) {
    return null;
  }

  if (!item.maskImage) {
    return <RetryImage src={item.url} alt={item.name} showSkeleton={false} />;
  }
  const mediaPairStyle =
    item.width && item.height && item.width > 0 && item.height > 0
      ? ({
          '--mask-pair-aspect': String((item.width * 2) / item.height),
        } as React.CSSProperties)
      : undefined;

  return (
    <div className={`${className}__media-pair`} style={mediaPairStyle}>
      <RetryImage src={item.url} alt={item.name} showSkeleton={false} />
      <div className={`${className}__mask-thumb`}>
        <RetryImage src={item.maskImage} alt={`${item.name} mask`} showSkeleton={false} />
      </div>
    </div>
  );
}

export const SelectedContentPreview: React.FC<SelectedContentPreviewProps> = ({
  items,
  language = 'zh',
  enableHoverPreview = true,
  className,
  onRemove,
  removableStartIndex = 0,
}) => {
  const [hoveredContent, setHoveredContent] = useState<HoveredContent | null>(null);

  // Handle content hover for preview
  const handleContentMouseEnter = useCallback((item: SelectedContentItem, e: React.MouseEvent<HTMLDivElement>) => {
    if (!enableHoverPreview) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const topY = rect.top - 10;
    setHoveredContent({
      type: item.type,
      url: item.url,
      maskImage: item.maskImage,
      width: item.width,
      height: item.height,
      text: item.text,
      x: centerX,
      y: topY,
    });
  }, [enableHoverPreview]);

  const handleContentMouseLeave = useCallback(() => {
    setHoveredContent(null);
  }, []);

  if (items.length === 0) return null;

  return (
    <>
      {/* Hover preview - large content (rendered to body via portal) */}
      {enableHoverPreview && hoveredContent && ReactDOM.createPortal(
        <div
          className={`selected-content-preview__hover selected-content-preview__hover--${hoveredContent.type}`}
          style={{
            left: `${hoveredContent.x}px`,
            top: `${hoveredContent.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {/* Image or graphics preview */}
          {(hoveredContent.type === 'image' || hoveredContent.type === 'graphics') && hoveredContent.url && (
            renderImageWithMask(
              {
                url: hoveredContent.url,
                maskImage: hoveredContent.maskImage,
                width: hoveredContent.width,
                height: hoveredContent.height,
                name: 'Preview',
              },
              'selected-content-preview'
            )
          )}

          {/* Video preview */}
          {hoveredContent.type === 'video' && hoveredContent.url && (
            <div className="selected-content-preview__hover-video">
              <video
                src={hoveredContent.url}
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            </div>
          )}

          {/* Text preview */}
          {hoveredContent.type === 'text' && hoveredContent.text && (
            <div className="selected-content-preview__hover-text">
              <div className="selected-content-preview__hover-text-header">
                <Type size={16} />
                <span>{language === 'zh' ? '文字内容' : 'Text Content'}</span>
              </div>
              <div className="selected-content-preview__hover-text-content">
                {hoveredContent.text}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Content preview grid */}
      <div className={`selected-content-preview ${className || ''}`}>
        {items.map((item, index) => {
          // 判断是否可删除（只有上传的内容可删除，index < removableStartIndex 表示上传内容）
          const canRemove = onRemove && index < removableStartIndex;

          return (
            <div
              key={`${item.type}-${index}`}
              className={`selected-content-preview__item selected-content-preview__item--${item.type}`}
              onMouseEnter={(e) => handleContentMouseEnter(item, e)}
              onMouseLeave={handleContentMouseLeave}
            >
              {/* Render based on content type */}
              {item.type === 'text' ? (
                // Text content preview
                <div className="selected-content-preview__text">
                  <Type size={14} className="selected-content-preview__text-icon" />
                  <span className="selected-content-preview__text-content">
                    {item.text && item.text.length > 20
                      ? `${item.text.substring(0, 20)}...`
                      : item.text}
                  </span>
                </div>
              ) : item.type === 'video' ? (
                // Video preview with icon placeholder
                <>
                  <div className="selected-content-preview__video-placeholder">
                    <Video size={20} />
                  </div>
                  <div className="selected-content-preview__video-overlay">
                    <Play size={16} fill="white" />
                  </div>
                </>
              ) : (
                // Image or graphics preview
                renderImageWithMask(item, 'selected-content-preview')
              )}

              {item.type === 'image' && item.maskImage && (
                <span className="selected-content-preview__label selected-content-preview__label--mask">
                  Mask
                </span>
              )}

              {/* Type label for graphics */}
              {item.type === 'graphics' && (
                <span className="selected-content-preview__label">
                  {language === 'zh' ? '图形' : 'Graphics'}
                </span>
              )}

              {/* Type label for video */}
              {item.type === 'video' && (
                <span className="selected-content-preview__label selected-content-preview__label--video">
                  {language === 'zh' ? '视频' : 'Video'}
                </span>
              )}

              {/* 删除按钮（仅上传内容显示） */}
              {canRemove && (
                <HoverTip
                  content={language === 'zh' ? '移除' : 'Remove'}
                  showArrow={false}
                >
                  <button
                    className="selected-content-preview__remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(index);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <X size={12} />
                  </button>
                </HoverTip>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default SelectedContentPreview;
