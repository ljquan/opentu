/**
 * PromptHistoryPopover 组件
 *
 * 历史提示词悬浮面板
 * - 三个点图标按钮（始终显示）
 * - 鼠标悬浮时显示历史提示词列表和预设提示词
 * - 支持置顶/取消置顶
 * - 点击提示词回填到输入框
 * - 支持删除历史记录
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { usePromptHistory } from '../../hooks/usePromptHistory';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { PromptListPanel, type PromptItem } from '../shared';
import { AI_COLD_START_SUGGESTIONS } from '../../constants/prompts';
import './prompt-history-popover.scss';

/** 选择提示词回调的参数类型 */
export interface PromptSelectInfo {
  content: string;
  /** 生成类型：image/video/audio/text/agent */
  modelType?: 'image' | 'video' | 'audio' | 'text' | 'agent';
  scene?: string;
}

interface PromptHistoryPopoverProps {
  /** 选择提示词后的回调 */
  onSelectPrompt: (info: PromptSelectInfo) => void;
  /** 语言 */
  language: 'zh' | 'en';
}

export const PromptHistoryPopover: React.FC<PromptHistoryPopoverProps> = ({
  onSelectPrompt,
  language,
}) => {
  // 禁用预设去重，因为我们会在下面自己处理去重
  const { history, removeHistory, togglePinHistory, refreshHistory } = usePromptHistory({
    deduplicateWithPresets: false,
  });
  const { confirm, confirmDialog } = useConfirmDialog();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 获取预设提示词（冷启动建议）
  const presetPrompts = useMemo(() => {
    const suggestions = AI_COLD_START_SUGGESTIONS[language] || [];
    return suggestions.map((s, index) => ({
      id: `preset_${index}`,
      content: s.content,
      isPreset: true,
      modelType: s.modelType,
      scene: s.scene,
    }));
  }, [language]);

  // 历史提示词最大展示数量（数据保留，只限制展示）
  const MAX_HISTORY_DISPLAY = 100;

  // 合并历史记录和预设提示词
  // 规则：预设提示词永久展示，历史提示词最多展示 100 条
  const promptItems: PromptItem[] = useMemo(() => {
    // 获取预设提示词内容集合（用于过滤历史记录中的重复项）
    const presetContents = new Set(presetPrompts.map(p => p.content.trim().toLowerCase()));

    // 历史记录：过滤掉与预设重复的内容，然后限制展示数量
    // 这样可以避免同一条内容同时出现在历史和预设中
    const filteredHistory = history.filter(
      item => !presetContents.has(item.content.trim().toLowerCase())
    );
    const historyItems: PromptItem[] = filteredHistory
      .slice(0, MAX_HISTORY_DISPLAY)
      .map(item => ({
        id: item.id,
        content: item.content,
        pinned: item.pinned,
        modelType: item.modelType,
      }));

    // 预设提示词：永久展示，不受历史记录影响
    const presetItems: PromptItem[] = presetPrompts.map(p => ({
      id: p.id,
      content: p.content,
      pinned: false,
      isPreset: true,
      modelType: p.modelType,
      scene: p.scene,
    }));

    // 历史记录在前（置顶的优先），预设在后
    return [...historyItems, ...presetItems];
  }, [history, presetPrompts]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);

  // 处理鼠标进入
  const handleMouseEnter = useCallback(() => {
    // 清除离开定时器
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    // 延迟显示面板（避免误触）
    hoverTimeoutRef.current = setTimeout(() => {
      // 打开前刷新历史记录，确保显示最新数据
      refreshHistory();
      setIsOpen(true);
    }, 150);
  }, [refreshHistory]);

  // 处理鼠标离开
  const handleMouseLeave = useCallback(() => {
    // 清除进入定时器
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    // 延迟关闭面板（允许鼠标移动到面板上）
    leaveTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 200);
  }, []);

  // 处理选择提示词
  const handleSelectPrompt = useCallback((item: PromptItem) => {
    onSelectPrompt({
      content: item.content,
      modelType: item.modelType,
      scene: item.scene,
    });
    setIsOpen(false);
  }, [onSelectPrompt]);

  // 处理删除（只允许删除历史记录，不允许删除预设）
  const handleDelete = useCallback(async (id: string) => {
    // 预设提示词的 id 以 preset_ 开头，不允许删除
    if (id.startsWith('preset_')) {
      return;
    }
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

  // 处理置顶切换（只允许置顶历史记录）
  const handleTogglePin = useCallback((id: string) => {
    // 预设提示词的 id 以 preset_ 开头，不允许置顶
    if (id.startsWith('preset_')) {
      return;
    }
    togglePinHistory(id);
  }, [togglePinHistory]);

  return (
    <div
      ref={containerRef}
      className="prompt-history-popover"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 提示词按钮 */}
      <button
        className="prompt-history-popover__trigger"
        title={language === 'zh' ? '提示词' : 'Prompts'}
        data-track="ai_input_click_history"
      >
        <MoreHorizontal size={18} />
      </button>

      {/* 提示词面板 */}
      {isOpen && (
        <div className="prompt-history-popover__panel-wrapper">
          <PromptListPanel
            title={language === 'zh' ? '提示词' : 'Prompts'}
            items={promptItems}
            onSelect={handleSelectPrompt}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
            language={language}
            showCount={true}
          />
        </div>
      )}
      {confirmDialog}
    </div>
  );
};

export default PromptHistoryPopover;
