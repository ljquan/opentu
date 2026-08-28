/**
 * PromptListPanel 组件
 *
 * 可复用的提示词列表面板组件
 * - 包含标题和数量显示
 * - 支持自定义列表项渲染
 */

import React, { useCallback, useState } from 'react';
import type { PromptPreviewExample } from '../../constants/prompts';
import {
  PromptListItem,
  type PromptPreviewRequest,
  type PromptListResultPreview,
} from './PromptListItem';
import {
  UnifiedMediaViewer,
  type MediaItem as UnifiedMediaItem,
} from './media-preview';
import {
  analytics,
  type PromptAnalyticsType,
} from '../../utils/umami-analytics';
import './prompt-list-panel.scss';

export interface PromptItem {
  /** 唯一标识 */
  id: string;
  /** 提示词内容 */
  content: string;
  /** 列表展示标题，不影响点击回填的 content */
  title?: string;
  /** 实际发送给生成工具的提示词 */
  sentPrompt?: string;
  /** 轻量标签 */
  tags?: string[];
  /** 生成结果预览 */
  resultPreview?: PromptListResultPreview;
  /** 是否已置顶 */
  pinned?: boolean;
  /** 是否是预设提示词（预设不允许删除和置顶） */
  isPreset?: boolean;
  /** 生成类型：image/video/audio/text/agent/ppt-common/ppt-slide */
  modelType?:
    | 'image'
    | 'video'
    | 'audio'
    | 'text'
    | 'agent'
    | 'ppt-common'
    | 'ppt-slide';
  /** 场景描述（用于显示标签） */
  scene?: string;
  /** 悬浮预览示例图 */
  previewExamples?: PromptPreviewExample[];
}

export interface PromptListPanelProps {
  /** 标题 */
  title: string;
  /** 提示词列表 */
  items: PromptItem[];
  /** 点击提示词的回调（传递完整 item 信息） */
  onSelect?: (item: PromptItem) => void;
  /** 置顶/取消置顶的回调 */
  onTogglePin?: (id: string) => void;
  /** 删除的回调 */
  onDelete?: (id: string) => void;
  /** 语言 */
  language?: 'zh' | 'en';
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否显示数量 */
  showCount?: boolean;
  /** 点击标题 */
  onTitleClick?: () => void;
  /** 自定义类名 */
  className?: string;
  /** 埋点来源面板 */
  analyticsSurface?: string;
  /** 埋点提示词类型，默认使用 item.modelType */
  analyticsPromptType?: PromptAnalyticsType;
}

export const PromptListPanel: React.FC<PromptListPanelProps> = ({
  title,
  items,
  onSelect,
  onTogglePin,
  onDelete,
  language = 'zh',
  disabled = false,
  showCount = true,
  onTitleClick,
  className = '',
  analyticsSurface = 'prompt_list',
  analyticsPromptType,
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewItems, setPreviewItems] = useState<UnifiedMediaItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);

  const handlePreviewExample = useCallback(
    (
      itemId: string,
      { content, previewExamples, initialIndex }: PromptPreviewRequest
    ) => {
      setPreviewItems(
        previewExamples.map((example, index) => {
          const shouldPlayVideo =
            example.kind === 'video' && example.playable !== false;

          return {
            id: `${itemId}-preview-${index}`,
            url: shouldPlayVideo
              ? example.src
              : example.kind === 'video'
              ? example.posterSrc || example.src
              : example.src,
            type: shouldPlayVideo ? 'video' : 'image',
            posterUrl: shouldPlayVideo ? example.posterSrc : undefined,
            alt: example.alt,
            title: content,
          } satisfies UnifiedMediaItem;
        })
      );
      setPreviewInitialIndex(initialIndex);
      setPreviewVisible(true);
      analytics.trackPromptAction({
        action: 'preview_example',
        surface: analyticsSurface,
        promptType: analyticsPromptType,
        prompt: content,
        itemCount: previewExamples.length,
      });
    },
    [analyticsPromptType, analyticsSurface]
  );

  const handleSelect = useCallback(
    (item: PromptItem) => {
      analytics.trackPromptAction({
        action: 'select',
        surface: analyticsSurface,
        promptType: analyticsPromptType || item.modelType,
        prompt: item.content,
        source: item.isPreset ? 'preset' : item.pinned ? 'pinned' : 'history',
      });
      onSelect?.(item);
    },
    [analyticsPromptType, analyticsSurface, onSelect]
  );

  const handleTogglePin = useCallback(
    (item: PromptItem) => {
      analytics.trackPromptAction({
        action: item.pinned ? 'unpin' : 'pin',
        surface: analyticsSurface,
        promptType: analyticsPromptType || item.modelType,
        prompt: item.content,
      });
      onTogglePin?.(item.id);
    },
    [analyticsPromptType, analyticsSurface, onTogglePin]
  );

  const handleDelete = useCallback(
    (item: PromptItem) => {
      analytics.trackPromptAction({
        action: 'delete',
        surface: analyticsSurface,
        promptType: analyticsPromptType || item.modelType,
        prompt: item.content,
      });
      onDelete?.(item.id);
    },
    [analyticsPromptType, analyticsSurface, onDelete]
  );

  return (
    <>
      <div className={`prompt-list-panel ${className}`}>
      {/* 头部 */}
        <div className="prompt-list-panel__header">
          {onTitleClick ? (
            <button
              type="button"
              className="prompt-list-panel__title prompt-list-panel__title-button"
              onClick={onTitleClick}
            >
              {title}
            </button>
          ) : (
            <span className="prompt-list-panel__title">{title}</span>
          )}
          {showCount && (
            <span className="prompt-list-panel__count">{items.length}</span>
          )}
        </div>
      
        {/* 列表 */}
        <div className="prompt-list-panel__list">
          {items.map((item) => (
            <PromptListItem
              key={item.id}
              content={item.content}
              title={item.title}
              sentPrompt={item.sentPrompt}
              tags={item.tags}
              resultPreview={item.resultPreview}
              pinned={item.pinned}
              isPreset={item.isPreset}
              modelType={item.modelType}
              scene={item.scene}
              previewExamples={item.previewExamples}
              onClick={() => handleSelect(item)}
              onTogglePin={
                onTogglePin && !item.isPreset
                  ? () => handleTogglePin(item)
                  : undefined
              }
              onDelete={
                onDelete && !item.isPreset
                  ? () => handleDelete(item)
                  : undefined
              }
              onPreviewExample={(request) =>
                handlePreviewExample(item.id, request)
              }
              language={language}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
      <UnifiedMediaViewer
        visible={previewVisible}
        items={previewItems}
        initialIndex={previewInitialIndex}
        onClose={() => setPreviewVisible(false)}
        showThumbnails={previewItems.length > 1}
        videoAutoPlay={true}
      />
    </>
  );
};

export default PromptListPanel;
