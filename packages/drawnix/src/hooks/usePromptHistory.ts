/**
 * usePromptHistory Hook
 *
 * 管理历史提示词的 React Hook
 * 提供历史记录的增删查改能力
 * 支持与预设提示词去重
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  promptStorageService,
  type PromptHistoryItem,
} from '../services/prompt-storage-service';
import { AI_COLD_START_SUGGESTIONS } from '../constants/prompts';

export interface UsePromptHistoryOptions {
  /** 语言，用于预设提示词去重 */
  language?: 'zh' | 'en';
  /** 是否与预设提示词去重，默认 true */
  deduplicateWithPresets?: boolean;
  /** 自定义预设内容集合（用于自定义去重逻辑） */
  customPresetContents?: string[];
}

export interface UsePromptHistoryReturn {
  /** 历史提示词列表（已去重） */
  history: PromptHistoryItem[];
  /** 添加历史记录 */
  addHistory: (content: string, hasSelection?: boolean, modelType?: 'image' | 'video' | 'audio' | 'agent') => void;
  /** 删除指定历史记录 */
  removeHistory: (id: string) => void;
  /** 清空所有历史记录 */
  clearHistory: () => void;
  /** 刷新历史记录 */
  refreshHistory: () => void;
  /** 切换置顶状态 */
  togglePinHistory: (id: string) => void;
}

/**
 * 历史提示词管理 Hook
 * @param options 可选配置，支持语言和预设去重
 */
export function usePromptHistory(options: UsePromptHistoryOptions = {}): UsePromptHistoryReturn {
  const { language = 'zh', deduplicateWithPresets = true, customPresetContents } = options;
  const [rawHistory, setRawHistory] = useState<PromptHistoryItem[]>([]);

  // 构建预设提示词内容集合（用于去重）
  const presetContents = useMemo(() => {
    if (!deduplicateWithPresets) {
      return new Set<string>();
    }
    // 优先使用自定义预设内容
    if (customPresetContents && customPresetContents.length > 0) {
      return new Set(customPresetContents.map(c => c.trim().toLowerCase()));
    }
    // 默认使用冷启动建议（用于 AI 输入框）
    const suggestions = AI_COLD_START_SUGGESTIONS[language] || [];
    return new Set(suggestions.map(s => s.content.trim().toLowerCase()));
  }, [language, deduplicateWithPresets, customPresetContents]);

  // 过滤掉与预设重复的历史记录
  const history = useMemo(() => {
    if (!deduplicateWithPresets || presetContents.size === 0) {
      return rawHistory;
    }
    return rawHistory.filter(
      item => !presetContents.has(item.content.trim().toLowerCase())
    );
  }, [rawHistory, presetContents, deduplicateWithPresets]);

  // 刷新历史记录
  const refreshHistory = useCallback(() => {
    const data = promptStorageService.getHistory();
    setRawHistory(data);
  }, []);

  // 初始化加载 - 等待缓存初始化完成
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // 等待缓存初始化完成
      await promptStorageService.waitForInit();
      if (mounted) {
        refreshHistory();
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [refreshHistory]);

  // 添加历史记录
  const addHistory = useCallback((content: string, hasSelection?: boolean, modelType?: 'image' | 'video' | 'audio' | 'agent') => {
    promptStorageService.addHistory(content, hasSelection, modelType);
    refreshHistory();
  }, [refreshHistory]);

  // 删除指定历史记录
  const removeHistory = useCallback((id: string) => {
    promptStorageService.removeHistory(id);
    refreshHistory();
  }, [refreshHistory]);

  // 清空所有历史记录
  const clearHistory = useCallback(() => {
    promptStorageService.clearHistory();
    refreshHistory();
  }, [refreshHistory]);

  // 切换置顶状态
  const togglePinHistory = useCallback((id: string) => {
    promptStorageService.togglePin(id);
    refreshHistory();
  }, [refreshHistory]);

  return {
    history,
    addHistory,
    removeHistory,
    clearHistory,
    refreshHistory,
    togglePinHistory,
  };
}

export default usePromptHistory;
