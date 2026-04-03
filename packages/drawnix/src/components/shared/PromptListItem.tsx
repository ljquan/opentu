/**
 * PromptListItem 组件
 *
 * 可复用的提示词列表项组件
 * - 支持置顶/取消置顶
 * - 支持删除
 * - 悬停时显示操作按钮
 * - 支持预设标识
 */

import React from 'react';
import { Pin, PinOff, X, Lightbulb } from 'lucide-react';
import './prompt-list-item.scss';

export interface PromptListItemProps {
  /** 提示词内容 */
  content: string;
  /** 是否已置顶 */
  pinned?: boolean;
  /** 是否是预设提示词 */
  isPreset?: boolean;
  /** 生成类型：image(直接生图)、video(直接生视频)、audio(直接生成音频)、agent(需要Agent分析) */
  modelType?: 'image' | 'video' | 'audio' | 'agent';
  /** 场景描述（用于显示标签） */
  scene?: string;
  /** 点击提示词的回调 */
  onClick?: () => void;
  /** 置顶/取消置顶的回调 */
  onTogglePin?: () => void;
  /** 删除的回调 */
  onDelete?: () => void;
  /** 语言 */
  language?: 'zh' | 'en';
  /** 是否禁用 */
  disabled?: boolean;
}

// 生成类型对应的标签样式
const MODEL_TYPE_STYLES: Record<string, string> = {
  'image': 'prompt-list-item__tag--image',
  'video': 'prompt-list-item__tag--video',
  'audio': 'prompt-list-item__tag--audio',
  'agent': 'prompt-list-item__tag--agent',
};

export const PromptListItem: React.FC<PromptListItemProps> = ({
  content,
  pinned = false,
  isPreset = false,
  modelType,
  scene,
  onClick,
  onTogglePin,
  onDelete,
  language = 'zh',
  disabled = false,
}) => {
  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin?.();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  return (
    <div
      className={`prompt-list-item ${pinned ? 'prompt-list-item--pinned' : ''} ${isPreset ? 'prompt-list-item--preset' : ''} ${disabled ? 'prompt-list-item--disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      title={content}
    >
      {/* 置顶标识 */}
      {pinned && (
        <div className="prompt-list-item__pin-badge">
          <Pin size={10} />
        </div>
      )}

      {/* 预设标识 */}
      {isPreset && (
        <div className="prompt-list-item__preset-badge">
          <Lightbulb size={10} />
        </div>
      )}
      
      {/* 场景标签（使用 scene 显示，modelType 决定样式） */}
      {scene && (
        <span className={`prompt-list-item__tag ${modelType ? MODEL_TYPE_STYLES[modelType] || '' : ''}`}>
          {scene}
        </span>
      )}
      
      {/* 提示词内容 */}
      <span className="prompt-list-item__text">
        {content}
      </span>
      
      {/* 操作按钮 */}
      <div className="prompt-list-item__actions">
        {/* 置顶/取消置顶按钮 */}
        {onTogglePin && (
          <button
            type="button"
            className="prompt-list-item__action"
            onClick={handleTogglePin}
            title={pinned
              ? (language === 'zh' ? '取消置顶' : 'Unpin')
              : (language === 'zh' ? '置顶' : 'Pin')
            }
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        )}
        
        {/* 删除按钮 */}
        {onDelete && (
          <button
            type="button"
            className="prompt-list-item__action prompt-list-item__action--delete"
            onClick={handleDelete}
            title={language === 'zh' ? '删除' : 'Delete'}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

export default PromptListItem;
