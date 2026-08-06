import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb } from 'lucide-react';
import { getPromptExample } from './ai-generation-utils';
import { CharacterMentionPopup } from '../../character/CharacterMentionPopup';
import { useMention } from '../../../hooks/useMention';
import { useGenerationHistory } from '../../../hooks/useGenerationHistory';
import { Z_INDEX } from '../../../constants/z-index';
import { promptStorageService } from '../../../services/prompt-storage-service';
import {
  PromptListPanel,
  PromptOptimizeButton,
  type PromptItem,
} from '../../shared';
import { resolvePresetPromptItems } from './prompt-utils';
import './PromptInput.scss';

interface PromptInputProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  presetPrompts: string[];
  language: 'zh' | 'en';
  type: 'image' | 'video';
  disabled?: boolean;
  onError?: (error: string | null) => void;
  /** Whether to enable character @ mention feature */
  enableMention?: boolean;
  /** Video model provider (sora, veo, etc.) - used to determine if @ mention should be enabled */
  videoProvider?: 'sora' | 'veo' | string;
  /** Optional ref for the prompt field root */
  rootRef?: React.Ref<HTMLDivElement>;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  prompt,
  onPromptChange,
  presetPrompts,
  language,
  type,
  disabled = false,
  onError,
  enableMention = true,
  videoProvider,
  rootRef,
}) => {
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    bottom: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  const [updateTrigger, setUpdateTrigger] = useState(0); // 用于触发重新渲染
  const { imageHistory, videoHistory } = useGenerationHistory();

  useEffect(() => {
    if (typeof promptStorageService.subscribeChanges !== 'function') {
      return undefined;
    }

    return promptStorageService.subscribeChanges(() => {
      setUpdateTrigger((prev) => prev + 1);
    });
  }, []);

  // 处理后的提示词列表（排序和过滤，转换为 PromptItem 格式）
  const promptItems: PromptItem[] = useMemo(() => {
    return resolvePresetPromptItems({
      generationType: type,
      language,
      promptContents: presetPrompts,
      imageHistory,
      videoHistory,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    imageHistory,
    language,
    type,
    presetPrompts,
    updateTrigger,
    videoHistory,
  ]);

  // Use mention hook for @ functionality
  // Only enable for video type with Sora provider (@ mention is a Sora-specific feature)
  const isMentionEnabled =
    enableMention && type === 'video' && videoProvider === 'sora';
  const {
    mentionState,
    textareaRef,
    handleTextChange,
    handleKeyDown,
    handleCharacterSelect,
    closeMentionPopup,
  } = useMention({
    enabled: isMentionEnabled,
    onPromptChange,
    prompt,
  });

  // 计算 tooltip 位置（使用 bottom + right 定位，避免窄屏溢出）
  const updateTooltipPosition = useCallback(() => {
    if (buttonRef.current && isPresetOpen) {
      const rect = buttonRef.current.getBoundingClientRect();
      const MARGIN = 8;
      const PANEL_MAX_WIDTH = 320;
      const PANEL_DEFAULT_MAX_HEIGHT = 400;

      // bottom: 弹窗底边到视口底部的距离（弹窗在按钮上方 4px）
      const bottom = window.innerHeight - rect.top + 4;
      // 面板实际宽度（窄屏时自适应）
      const panelWidth = Math.min(
        PANEL_MAX_WIDTH,
        window.innerWidth - MARGIN * 2
      );
      // right: 弹窗右边缘到视口右边缘的距离（与按钮右边对齐，但不能溢出左边缘）
      const rightFromButton = window.innerWidth - rect.right;
      const maxRight = window.innerWidth - panelWidth - MARGIN;
      const right = Math.max(Math.min(rightFromButton, maxRight), MARGIN);
      // maxHeight: 限制面板高度（取默认值、按钮上方可用空间、视口45%三者最小值）
      const maxHeight = Math.min(
        PANEL_DEFAULT_MAX_HEIGHT,
        rect.top - MARGIN,
        window.innerHeight * 0.45
      );

      setTooltipPosition({ bottom, right, maxHeight });
    }
  }, [isPresetOpen]);

  // 打开时计算位置
  useEffect(() => {
    if (isPresetOpen) {
      updateTooltipPosition();
      // 监听滚动和窗口变化
      window.addEventListener('scroll', updateTooltipPosition, true);
      window.addEventListener('resize', updateTooltipPosition);
      return () => {
        window.removeEventListener('scroll', updateTooltipPosition, true);
        window.removeEventListener('resize', updateTooltipPosition);
      };
    }
    return undefined;
  }, [isPresetOpen, updateTooltipPosition]);

  // 点击外部关闭弹窗
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // 检查点击是否在按钮或 tooltip 内
      if (containerRef.current && !containerRef.current.contains(target)) {
        // 还需要检查是否点击了 portal 中的 tooltip
        const tooltipElement = document.querySelector(
          '.preset-prompt-panel-portal'
        );
        if (!tooltipElement?.contains(target)) {
          setIsPresetOpen(false);
        }
      }
    };

    if (isPresetOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [isPresetOpen]);

  // 选择提示词 - 接收 PromptItem 对象或字符串
  const handleSelect = useCallback(
    (item: PromptItem | string) => {
      const content = typeof item === 'string' ? item : item.content;
      onPromptChange(content);
      onError?.(null);
      setIsPresetOpen(false);
    },
    [onPromptChange, onError]
  );

  // 置顶/取消置顶提示词
  const handleTogglePin = useCallback(
    (id: string) => {
      const item = promptItems.find((p) => p.id === id);
      if (!item) return;

      if (item.pinned) {
        promptStorageService.unpinPrompt(type, item.content);
      } else {
        promptStorageService.pinPrompt(type, item.content);
      }
      setUpdateTrigger((prev) => prev + 1);
    },
    [type, promptItems]
  );

  // 删除提示词
  const handleDelete = useCallback(
    (id: string) => {
      const item = promptItems.find((p) => p.id === id);
      if (!item) return;

      promptStorageService.deletePrompt(type, item.content);
      setUpdateTrigger((prev) => prev + 1);
    },
    [type, promptItems]
  );

  // Handle textarea change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPos = e.target.selectionStart || 0;
      handleTextChange(value, cursorPos);
      onError?.(null);
    },
    [handleTextChange, onError]
  );

  // Close mention popup when type changes
  useEffect(() => {
    if (type !== 'video') {
      closeMentionPopup();
    }
  }, [type, closeMentionPopup]);

  // 渲染 tooltip 内容
  const renderTooltipContent = () => {
    if (!isPresetOpen || !tooltipPosition) return null;

    const title =
      language === 'zh'
        ? `${type === 'image' ? '图片' : '视频'}描述预设`
        : `${type === 'image' ? 'Image' : 'Video'} Description Presets`;

    const tooltipContent = (
      <div
        className="preset-prompt-panel-portal"
        style={
          {
            position: 'fixed',
            bottom: tooltipPosition.bottom,
            right: tooltipPosition.right,
            zIndex: Z_INDEX.DIALOG_POPOVER,
            // 通过 CSS 变量传递约束值，因为子元素 max-height: 100% 无法继承父元素的 maxHeight
            ['--panel-max-width' as string]: 'calc(100vw - 16px)',
            ['--panel-max-height' as string]: `${tooltipPosition.maxHeight}px`,
          } as React.CSSProperties
        }
      >
        <PromptListPanel
          title={title}
          items={promptItems}
          onSelect={handleSelect}
          onTogglePin={handleTogglePin}
          onDelete={handleDelete}
          language={language}
          disabled={disabled}
          showCount={true}
        />
      </div>
    );

    return createPortal(tooltipContent, document.body);
  };

  return (
    <div ref={rootRef} className="form-field form-field--prompt">
      <div className="form-label-with-icon">
        <label className="form-label">
          {language === 'zh'
            ? `${type === 'image' ? '图片' : '视频'}描述`
            : `${type === 'image' ? 'Image' : 'Video'} Description`}
        </label>
        <div className="textarea-with-preset">
          <div className="preset-tooltip-container" ref={containerRef}>
            <button
              ref={buttonRef}
              type="button"
              className="preset-icon-button"
              disabled={disabled}
              onClick={() => setIsPresetOpen(!isPresetOpen)}
            >
              <Lightbulb size={16} />
            </button>
            {renderTooltipContent()}
          </div>
        </div>
      </div>
      <div className="prompt-textarea-wrapper">
        <textarea
          ref={textareaRef}
          className="form-textarea"
          value={prompt}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={getPromptExample(language, type, videoProvider)}
          rows={4}
          disabled={disabled}
        />
        <PromptOptimizeButton
          className="prompt-optimize-button"
          originalPrompt={prompt}
          language={language}
          scenarioId={type === 'image' ? 'tool.image' : 'tool.video'}
          disabled={disabled}
          tooltipPlacement="top"
          allowStructuredMode={true}
          onApply={(optimizedPrompt) => {
            onPromptChange(optimizedPrompt);
            onError?.(null);
          }}
        />
      </div>

      {/* Character mention popup - rendered in portal style with fixed position */}
      {isMentionEnabled && (
        <CharacterMentionPopup
          visible={mentionState.visible}
          query={mentionState.query}
          position={mentionState.position}
          showBelow={mentionState.showBelow}
          selectedIndex={mentionState.selectedIndex}
          onSelect={handleCharacterSelect}
          onClose={closeMentionPopup}
        />
      )}
    </div>
  );
};
