/**
 * useSmartInput Hook
 *
 * 共享的智能输入逻辑，用于 AIInputBar 和 EnhancedChatInput
 * 支持 #模型、-参数、+数量 语法解析和建议面板控制
 */

import { useState, useCallback, useEffect, RefObject } from 'react';
import { useTextSelection } from './useTextSelection';

type TriggerMode = 'model' | 'param' | 'count';

interface PromptItem {
  content: string;
}

const TRIGGER_CHARS = {
  model: '#',
  param: '-',
  count: '+',
} as const;

function useTriggerDetection(input: string, _hasSelection: boolean): {
  mode: TriggerMode | null;
  triggerPosition: number | undefined;
} {
  const triggerEntries = Object.entries(TRIGGER_CHARS).map(([mode, char]) => ({
    mode: mode as TriggerMode,
    index: input.lastIndexOf(char),
  }));
  const activeTrigger = triggerEntries.reduce<{
    mode: TriggerMode | null;
    index: number;
  }>(
    (latest, current) =>
      current.index > latest.index
        ? { mode: current.mode, index: current.index }
        : latest,
    { mode: null, index: -1 }
  );

  return {
    mode: activeTrigger.mode,
    triggerPosition:
      activeTrigger.index >= 0 ? activeTrigger.index : undefined,
  };
}

function insertToInput(
  input: string,
  value: string,
  triggerPosition: number | undefined,
  triggerChar: string
): string {
  if (triggerPosition === undefined) {
    return input.length > 0 ? `${input} ${triggerChar}${value}` : `${triggerChar}${value}`;
  }

  const nextWhitespaceIndex = input
    .slice(triggerPosition)
    .search(/\s/);
  const endIndex =
    nextWhitespaceIndex >= 0
      ? triggerPosition + nextWhitespaceIndex
      : input.length;

  return `${input.slice(0, triggerPosition + 1)}${value}${input.slice(endIndex)}`;
}

export interface UseSmartInputOptions {
  /** 是否有选中内容 */
  hasSelection?: boolean;
  /** 是否只被动触发（用户输入触发字符时才显示面板） */
  passiveOnly?: boolean;
  /** 输入框 ref */
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement>;
  /** 容器 ref（用于点击外部关闭） */
  containerRef?: RefObject<HTMLElement>;
}

export interface UseSmartInputReturn {
  /** 输入值 */
  input: string;
  /** 设置输入值 */
  setInput: (value: string) => void;
  /** 是否显示建议面板 */
  showSuggestion: boolean;
  /** 设置建议面板显示状态 */
  setShowSuggestion: (show: boolean) => void;
  /** 解析结果 */
  parseResult: ReturnType<typeof useTriggerDetection>;
  /** 处理模型选择 */
  handleSelectModel: (modelId: string) => void;
  /** 处理参数选择 */
  handleSelectParam: (paramId: string, value?: string) => void;
  /** 处理数量选择 */
  handleSelectCount: (count: number) => void;
  /** 处理提示词选择 */
  handleSelectPrompt: (prompt: PromptItem) => void;
  /** 关闭建议面板 */
  handleCloseSuggestion: () => void;
}

/**
 * 智能输入 Hook
 */
export function useSmartInput(options: UseSmartInputOptions): UseSmartInputReturn {
  const {
    hasSelection = false,
    passiveOnly = false,
    inputRef,
    containerRef,
  } = options;

  const [input, setInput] = useState('');
  const [showSuggestion, setShowSuggestion] = useState(false);

  // 解析输入
  const parseResult = useTriggerDetection(input, hasSelection);
  const { mode, triggerPosition } = parseResult;

  // 处理文本选择和复制
  useTextSelection(inputRef as RefObject<HTMLTextAreaElement>, {
    enableCopy: true,
    stopPropagation: true,
  });

  // 控制建议面板显示
  useEffect(() => {
    if (passiveOnly) {
      // 被动模式：只有输入触发字符时才显示
      if (mode && triggerPosition !== undefined) {
        setShowSuggestion(true);
      } else {
        setShowSuggestion(false);
      }
    } else {
      // 主动模式：有选中内容时自动提示
      if (mode) {
        setShowSuggestion(true);
      } else if (!hasSelection) {
        setShowSuggestion(false);
      }
    }
  }, [mode, triggerPosition, hasSelection, passiveOnly]);

  // 点击外部关闭建议面板
  useEffect(() => {
    if (!containerRef) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestion(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [containerRef]);

  // 处理模型选择
  const handleSelectModel = useCallback((modelId: string) => {
    const newInput = insertToInput(input, modelId, triggerPosition, TRIGGER_CHARS.model);
    setInput(newInput);
    inputRef.current?.focus();
  }, [input, triggerPosition, inputRef]);

  // 处理参数选择
  const handleSelectParam = useCallback((paramId: string, value?: string) => {
    const paramValue = value ? `${paramId}=${value}` : paramId;
    const newInput = insertToInput(input, paramValue, triggerPosition, TRIGGER_CHARS.param);
    setInput(newInput);
    inputRef.current?.focus();
  }, [input, triggerPosition, inputRef]);

  // 处理数量选择
  const handleSelectCount = useCallback((count: number) => {
    const newInput = insertToInput(input, String(count), triggerPosition, TRIGGER_CHARS.count);
    setInput(newInput);
    inputRef.current?.focus();
  }, [input, triggerPosition, inputRef]);

  // 处理提示词选择
  const handleSelectPrompt = useCallback((prompt: PromptItem) => {
    setInput(prev => prev + prompt.content);
    inputRef.current?.focus();
    setShowSuggestion(false);
  }, [inputRef]);

  // 关闭建议面板
  const handleCloseSuggestion = useCallback(() => {
    setShowSuggestion(false);
  }, []);

  return {
    input,
    setInput,
    showSuggestion,
    setShowSuggestion,
    parseResult,
    handleSelectModel,
    handleSelectParam,
    handleSelectCount,
    handleSelectPrompt,
    handleCloseSuggestion,
  };
}

export default useSmartInput;
