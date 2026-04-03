/**
 * PromptListPanel 组件
 *
 * 可复用的提示词列表面板组件
 * - 包含标题和数量显示
 * - 支持自定义列表项渲染
 */

import React from 'react';
import { PromptListItem, type PromptListItemProps } from './PromptListItem';
import './prompt-list-panel.scss';

export interface PromptItem {
  /** 唯一标识 */
  id: string;
  /** 提示词内容 */
  content: string;
  /** 是否已置顶 */
  pinned?: boolean;
  /** 是否是预设提示词（预设不允许删除和置顶） */
  isPreset?: boolean;
  /** 生成类型：image(直接生图)、video(直接生视频)、audio(直接生成音频)、agent(需要Agent分析) */
  modelType?: 'image' | 'video' | 'audio' | 'agent';
  /** 场景描述（用于显示标签） */
  scene?: string;
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
  /** 自定义类名 */
  className?: string;
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
  className = '',
}) => {
  return (
    <div className={`prompt-list-panel ${className}`}>
      {/* 头部 */}
      <div className="prompt-list-panel__header">
        <span className="prompt-list-panel__title">{title}</span>
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
            pinned={item.pinned}
            isPreset={item.isPreset}
            modelType={item.modelType}
            scene={item.scene}
            onClick={() => onSelect?.(item)}
            onTogglePin={onTogglePin && !item.isPreset ? () => onTogglePin(item.id) : undefined}
            onDelete={onDelete && !item.isPreset ? () => onDelete(item.id) : undefined}
            language={language}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
};

export default PromptListPanel;
