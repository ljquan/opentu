/**
 * 提示词按钮组件
 * 
 * 在文本元素的 popup-toolbar 上显示提示词选择按钮
 * 点击后展开提示词选择面板，选择后将提示词填入文本内容
 * 
 * 整合多个来源的历史记录：
 * - AI输入框历史 (ai-input)
 * - 图片描述历史 (image)
 * - 视频描述历史 (video)
 * - 预设提示词 (preset)
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Lightbulb, History, X, Image, Video, MessageSquare } from 'lucide-react';
import { PlaitBoard, getSelectedElements, Transforms, ATTACHED_ELEMENT_CLASS_NAME, Point } from '@plait/core';
import { MindElement } from '@plait/mind';
import { PlaitDrawElement, isDrawElementsIncludeText } from '@plait/draw';
import { Popover, PopoverTrigger, PopoverContent } from '../../popover/popover';
import { useConfirmDialog } from '../../dialog/ConfirmDialog';
import { ToolButton } from '../../tool-button';
import { AI_IMAGE_PROMPTS } from '../../../constants/prompts';
import { usePromptHistory } from '../../../hooks/usePromptHistory';
import {
  getImagePromptHistory,
  getVideoPromptHistory,
  type ImagePromptHistoryItem,
  type VideoPromptHistoryItem,
} from '../../../services/prompt-storage-service';
import './prompt-button.scss';

// 文本尺寸计算常量
const TEXT_PADDING = 8; // 文本框内边距
const TEXT_MIN_WIDTH = 60; // 最小宽度
const TEXT_MAX_WIDTH = 600; // 最大宽度
const TEXT_LINE_HEIGHT = 24; // 行高
const DEFAULT_FONT = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// 缓存 canvas context 用于文本测量
let measureCanvas: HTMLCanvasElement | null = null;
let measureContext: CanvasRenderingContext2D | null = null;

/**
 * 获取用于测量文本的 Canvas Context
 */
function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
    measureContext = measureCanvas.getContext('2d');
  }
  if (!measureContext) {
    throw new Error('Failed to get canvas context');
  }
  measureContext.font = DEFAULT_FONT;
  return measureContext;
}

/**
 * 使用 Canvas API 精确测量文本宽度
 * @param text 文本内容
 * @returns 文本宽度（像素）
 */
function measureTextWidth(text: string): number {
  const ctx = getMeasureContext();
  return ctx.measureText(text).width;
}

/**
 * 计算文本内容所需的宽度和高度
 * 使用 Canvas API 精确测量，确保与实际渲染一致
 * @param text 文本内容
 * @returns 计算的宽度和高度
 */
function calculateTextDimensions(text: string): { width: number; height: number } {
  // 按换行符分割
  const lines = text.split('\n');
  
  // 测量每行的实际宽度，找出最宽的行
  let maxLineWidth = 0;
  for (const line of lines) {
    const lineWidth = measureTextWidth(line);
    maxLineWidth = Math.max(maxLineWidth, lineWidth);
  }
  
  // 添加内边距，并限制在最小和最大宽度之间
  const contentWidth = Math.min(
    TEXT_MAX_WIDTH - TEXT_PADDING * 2,
    Math.max(TEXT_MIN_WIDTH - TEXT_PADDING * 2, maxLineWidth)
  );
  const width = contentWidth + TEXT_PADDING * 2;
  
  // 如果宽度被限制到最大宽度，需要重新计算换行后的行数
  let totalLines = 0;
  for (const line of lines) {
    if (line.length === 0) {
      totalLines += 1; // 空行
      continue;
    }
    
    const lineWidth = measureTextWidth(line);
    if (lineWidth <= contentWidth) {
      totalLines += 1;
    } else {
      // 需要换行，逐字符计算
      let currentLineWidth = 0;
      let lineCount = 1;
      for (const char of line) {
        const charWidth = measureTextWidth(char);
        if (currentLineWidth + charWidth > contentWidth) {
          lineCount++;
          currentLineWidth = charWidth;
        } else {
          currentLineWidth += charWidth;
        }
      }
      totalLines += lineCount;
    }
  }
  
  // 计算高度：行数 * 行高 + 内边距
  const height = Math.max(TEXT_LINE_HEIGHT + TEXT_PADDING * 2, totalLines * TEXT_LINE_HEIGHT + TEXT_PADDING * 2);
  
  return { width, height };
}

interface PopupPromptButtonProps {
  board: PlaitBoard;
  language: 'zh' | 'en';
  title?: string;
}

/**
 * 提示词来源类型
 * - ai-input: AI输入框历史
 * - image: 图片描述历史
 * - video: 视频描述历史
 * - preset: 预设提示词
 */
type PromptSource = 'ai-input' | 'image' | 'video' | 'preset';

interface PromptItem {
  id: string;
  content: string;
  scene?: string;
  source: PromptSource;
  timestamp?: number;
}

/**
 * 获取来源对应的图标组件
 */
function getSourceIcon(source: PromptSource): React.ReactNode {
  switch (source) {
    case 'ai-input':
      return <MessageSquare size={12} />;
    case 'image':
      return <Image size={12} />;
    case 'video':
      return <Video size={12} />;
    default:
      return null;
  }
}

/**
 * 获取来源对应的标签文字
 */
function getSourceLabel(source: PromptSource, language: 'zh' | 'en'): string {
  const labels: Record<PromptSource, Record<'zh' | 'en', string>> = {
    'ai-input': { zh: 'AI输入', en: 'AI Input' },
    image: { zh: '图片', en: 'Image' },
    video: { zh: '视频', en: 'Video' },
    preset: { zh: '预设', en: 'Preset' },
  };
  return labels[source][language];
}

export const PopupPromptButton: React.FC<PopupPromptButtonProps> = ({
  board,
  language,
  title,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // 禁用预设去重，因为文本组件内部有自己的去重逻辑
  const { history: aiInputHistory, addHistory, removeHistory } = usePromptHistory({
    deduplicateWithPresets: false,
  });
  const { confirm, confirmDialog } = useConfirmDialog({ container: board?.host ?? null });
  const listRef = useRef<HTMLDivElement>(null);

  // 获取图片和视频描述历史记录
  const [imageHistory, setImageHistory] = useState<ImagePromptHistoryItem[]>([]);
  const [videoHistory, setVideoHistory] = useState<VideoPromptHistoryItem[]>([]);

  // 刷新图片和视频历史记录
  useEffect(() => {
    if (isOpen) {
      setImageHistory(getImagePromptHistory());
      setVideoHistory(getVideoPromptHistory());
    }
  }, [isOpen]);

  // 合并所有来源的历史记录和预设提示词
  const allPrompts = useMemo((): PromptItem[] => {
    // 1. 预设提示词
    const presetPrompts: PromptItem[] = AI_IMAGE_PROMPTS[language].map((content, index) => ({
      id: `preset_${index}`,
      content: content,
      source: 'preset' as const,
    }));

    // 2. AI输入框历史
    const aiInputPrompts: PromptItem[] = aiInputHistory.map(item => ({
      id: item.id,
      content: item.content,
      source: 'ai-input' as const,
      timestamp: item.timestamp,
    }));

    // 3. 图片描述历史
    const imagePrompts: PromptItem[] = imageHistory.map(item => ({
      id: item.id,
      content: item.content,
      source: 'image' as const,
      timestamp: item.timestamp,
    }));

    // 4. 视频描述历史
    const videoPrompts: PromptItem[] = videoHistory.map(item => ({
      id: item.id,
      content: item.content,
      source: 'video' as const,
      timestamp: item.timestamp,
    }));

    // 合并所有历史记录
    const allHistoryPrompts = [...aiInputPrompts, ...imagePrompts, ...videoPrompts];

    // 按时间倒序排序
    allHistoryPrompts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // 去重：同一内容只保留最新的一条（保留时间戳最大的）
    const seenContents = new Set<string>();
    const deduplicatedHistory: PromptItem[] = [];
    for (const prompt of allHistoryPrompts) {
      const normalizedContent = prompt.content.trim();
      if (!seenContents.has(normalizedContent)) {
        seenContents.add(normalizedContent);
        deduplicatedHistory.push(prompt);
      }
    }

    // 预设提示词去重：排除已在历史记录中存在的
    const deduplicatedPresets = presetPrompts.filter(
      preset => !seenContents.has(preset.content.trim())
    );

    return [...deduplicatedHistory, ...deduplicatedPresets];
  }, [language, aiInputHistory, imageHistory, videoHistory]);

  // 分组提示词
  const { historyPrompts, presetPrompts } = useMemo(() => {
    const historyItems = allPrompts.filter(p => p.source !== 'preset');
    const presetItems = allPrompts.filter(p => p.source === 'preset');
    return { historyPrompts: historyItems, presetPrompts: presetItems };
  }, [allPrompts]);

  // 获取全局索引
  const getGlobalIndex = useCallback((source: 'history' | 'preset', localIndex: number) => {
    if (source === 'history') return localIndex;
    return historyPrompts.length + localIndex;
  }, [historyPrompts.length]);

  // 重置高亮索引
  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(0);
    }
  }, [isOpen]);

  // 处理选择提示词 - 将提示词填入到选中的文本元素中
  const handleSelectPrompt = useCallback((prompt: PromptItem) => {
    // 保存到历史记录
    addHistory(prompt.content);
    
    // 关闭弹窗
    setIsOpen(false);
    
    // 获取选中的元素
    const selectedElements = getSelectedElements(board);
    if (selectedElements.length === 0) return;

    // 构建符合 Plait 规范的文本结构
    // Plait 使用 Slate 风格的文本节点，需要包含 type: 'paragraph'
    const buildNewText = (content: string) => ({
      type: 'paragraph',
      children: [{ text: content }],
    });

    // 使用 Canvas API 精确计算新文本的尺寸
    const { width: newWidth, height: newHeight } = calculateTextDimensions(prompt.content);

    // 更新选中元素的文本内容
    for (const element of selectedElements) {
      const path = board.children.findIndex(child => child.id === element.id);
      if (path < 0) continue;

      // 准备更新的属性
      const updates: Record<string, unknown> = {};

      // 1. MindElement - 文本存储在 data 属性中（Slate 节点数组）
      // MindElement 不需要调整宽度，它会自动适应
      if (MindElement.isMindElement(board, element)) {
        const newData = [buildNewText(prompt.content)];
        Transforms.setNode(board, { data: newData }, [path]);
        continue;
      }

      // 2. PlaitText 元素 - 文本存储在 text 属性中，需要调整 points
      if (PlaitDrawElement.isText && PlaitDrawElement.isText(element)) {
        updates.text = buildNewText(prompt.content);
        
        // 调整元素的 points 以适应新的文本宽度
        if ('points' in element && Array.isArray(element.points) && element.points.length >= 2) {
          const points = element.points as Point[];
          const [start] = points;
          // 保持左上角位置不变，调整右下角以适应新的宽度和高度
          const newPoints: Point[] = [
            start,
            [start[0] + newWidth, start[1] + newHeight],
          ];
          updates.points = newPoints;
        }
        
        Transforms.setNode(board, updates, [path]);
        continue;
      }

      // 3. 其他带文本的 Draw 元素
      if (PlaitDrawElement.isDrawElement(element) && isDrawElementsIncludeText([element])) {
        // 如果有 text 属性，更新 text（优先级高于 data）
        if ('text' in element && element.text) {
          updates.text = buildNewText(prompt.content);
          
          // 调整元素的 points
          if ('points' in element && Array.isArray(element.points) && element.points.length >= 2) {
            const points = element.points as Point[];
            const [start] = points;
            const newPoints: Point[] = [
              start,
              [start[0] + newWidth, start[1] + newHeight],
            ];
            updates.points = newPoints;
          }
          
          Transforms.setNode(board, updates, [path]);
          continue;
        }
        // 如果有 data 属性（Slate 节点数组），更新 data
        if ('data' in element && Array.isArray(element.data)) {
          updates.data = [buildNewText(prompt.content)];
          
          // 调整元素的 points
          if ('points' in element && Array.isArray(element.points) && element.points.length >= 2) {
            const points = element.points as Point[];
            const [start] = points;
            const newPoints: Point[] = [
              start,
              [start[0] + newWidth, start[1] + newHeight],
            ];
            updates.points = newPoints;
          }
          
          Transforms.setNode(board, updates, [path]);
          continue;
        }
      }

      // 4. 兜底：检查 text 属性
      if ('text' in element && element.text) {
        updates.text = buildNewText(prompt.content);
        
        // 调整元素的 points
        if ('points' in element && Array.isArray(element.points) && element.points.length >= 2) {
          const points = element.points as Point[];
          const [start] = points;
          const newPoints: Point[] = [
            start,
            [start[0] + newWidth, start[1] + newHeight],
          ];
          updates.points = newPoints;
        }
        
        Transforms.setNode(board, updates, [path]);
        continue;
      }

      // 5. 兜底：检查 textContent 属性
      if ('textContent' in element) {
        Transforms.setNode(board, { textContent: prompt.content }, [path]);
      }
    }
  }, [board, addHistory]);

  // 处理删除历史
  const handleDeleteHistory = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: language === 'zh' ? '确认删除提示词' : 'Delete Prompt',
      description:
        language === 'zh'
          ? '确定要删除这条历史提示词吗？此操作不可撤销。'
          : 'Are you sure you want to delete this prompt history item? This action cannot be undone.',
      confirmText: language === 'zh' ? '删除' : 'Delete',
      cancelText: language === 'zh' ? '取消' : 'Cancel',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    removeHistory(id);
  }, [confirm, language, removeHistory]);

  // 键盘事件处理
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (allPrompts.length === 0) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setIsOpen(false);
        }
        return;
      }

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          setHighlightedIndex(prev =>
            prev <= 0 ? allPrompts.length - 1 : prev - 1
          );
          break;
        case 'ArrowDown':
          event.preventDefault();
          setHighlightedIndex(prev =>
            prev >= allPrompts.length - 1 ? 0 : prev + 1
          );
          break;
        case 'Enter':
          event.preventDefault();
          if (allPrompts[highlightedIndex]) {
            handleSelectPrompt(allPrompts[highlightedIndex]);
          }
          break;
        case 'Escape':
          event.preventDefault();
          setIsOpen(false);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, allPrompts, highlightedIndex, handleSelectPrompt]);

  // 滚动高亮项到可见区域
  useEffect(() => {
    if (!isOpen || allPrompts.length === 0) return;
    
    const highlightedElement = listRef.current?.querySelector(
      '.popup-prompt-panel__item--highlighted'
    );
    if (highlightedElement) {
      highlightedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [highlightedIndex, isOpen, allPrompts.length]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen} placement="top" sideOffset={8}>
      <PopoverTrigger asChild>
        <ToolButton
          className="prompt-button"
          type="icon"
          icon={<Lightbulb size={16} />}
          visible={true}
          title={title || (language === 'zh' ? '提示词' : 'Prompts')}
          aria-label={title || (language === 'zh' ? '提示词' : 'Prompts')}
          onPointerUp={() => setIsOpen(!isOpen)}
        />
      </PopoverTrigger>
      <PopoverContent 
        className={`popup-prompt-panel ${ATTACHED_ELEMENT_CLASS_NAME}`}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div ref={listRef} className="popup-prompt-panel__content">
          {/* 历史提示词 */}
          {historyPrompts.length > 0 && (
            <div className="popup-prompt-panel__section">
              <div className="popup-prompt-panel__section-header">
                <History size={14} />
                <span>{language === 'zh' ? '历史记录' : 'History'}</span>
              </div>
              <div className="popup-prompt-panel__list">
                {historyPrompts.map((item, index) => (
                  <div
                    key={item.id}
                    className={`popup-prompt-panel__item popup-prompt-panel__item--history ${
                      getGlobalIndex('history', index) === highlightedIndex 
                        ? 'popup-prompt-panel__item--highlighted' 
                        : ''
                    }`}
                    onClick={() => handleSelectPrompt(item)}
                    onMouseEnter={() => setHighlightedIndex(getGlobalIndex('history', index))}
                  >
                    <div className="popup-prompt-panel__item-content">
                      <span className="popup-prompt-panel__item-text">
                        {item.content}
                      </span>
                      {/* 显示来源标签 */}
                      <span className={`popup-prompt-panel__item-source popup-prompt-panel__item-source--${item.source}`}>
                        {getSourceIcon(item.source)}
                        <span>{getSourceLabel(item.source, language)}</span>
                      </span>
                    </div>
                    {/* 只有AI输入框的历史可以删除 */}
                    {item.source === 'ai-input' && (
                      <button
                        className="popup-prompt-panel__item-delete"
                        onClick={(e) => handleDeleteHistory(e, item.id)}
                        title={language === 'zh' ? '删除' : 'Delete'}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 预设提示词 */}
          {presetPrompts.length > 0 && (
            <div className="popup-prompt-panel__section">
              <div className="popup-prompt-panel__section-header">
                <Lightbulb size={14} />
                <span>{language === 'zh' ? '推荐提示词' : 'Suggestions'}</span>
              </div>
              <div className="popup-prompt-panel__list">
                {presetPrompts.map((item, index) => (
                  <div
                    key={item.id}
                    className={`popup-prompt-panel__item ${
                      getGlobalIndex('preset', index) === highlightedIndex 
                        ? 'popup-prompt-panel__item--highlighted' 
                        : ''
                    }`}
                    onClick={() => handleSelectPrompt(item)}
                    onMouseEnter={() => setHighlightedIndex(getGlobalIndex('preset', index))}
                  >
                    <span className="popup-prompt-panel__item-text">
                      {item.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
      {confirmDialog}
    </Popover>
  );
};

export default PopupPromptButton;
