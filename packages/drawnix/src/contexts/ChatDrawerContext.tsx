/**
 * ChatDrawer Context
 *
 * 提供 ChatDrawer 的 ref 访问，使其他组件可以控制 ChatDrawer
 */

import React, { createContext, useContext, useRef, useCallback, useState, type MutableRefObject } from 'react';
import type { ChatDrawerRef, WorkflowMessageData, WorkflowMessageParams, AgentLogEntry } from '../types/chat.types';

/** 选中内容类型 */
export type SelectedContentType = 'image' | 'video' | 'graphics' | 'text';

/** 选中内容项 */
export interface SelectedContentItem {
  type: SelectedContentType;
  url?: string;
  text?: string;
  name: string;
  width?: number;
  height?: number;
}

/** 重试处理器类型 */
export type RetryHandler = (workflow: WorkflowMessageData, startStepIndex: number, workZoneId?: string) => Promise<void>;

interface ChatDrawerContextValue {
  chatDrawerRef: MutableRefObject<ChatDrawerRef | null>;
  /** 注册重试处理器 */
  registerRetryHandler: (handler: RetryHandler) => void;
  /** 执行重试 */
  executeRetry: (workflow: WorkflowMessageData, startStepIndex: number) => Promise<void>;
  /** 选中内容 */
  selectedContent: SelectedContentItem[];
  /** 设置选中内容 */
  setSelectedContent: (content: SelectedContentItem[]) => void;
  /** 抽屉是否打开（响应式状态） */
  isDrawerOpen: boolean;
  /** 设置抽屉打开状态 */
  setIsDrawerOpen: (open: boolean) => void;
  /** 抽屉宽度 */
  drawerWidth: number;
  /** 设置抽屉宽度 */
  setDrawerWidth: (width: number) => void;
}

const ChatDrawerContext = createContext<ChatDrawerContextValue | null>(null);

export interface ChatDrawerProviderProps {
  children: React.ReactNode;
}

// 默认抽屉宽度
const DEFAULT_DRAWER_WIDTH = typeof window !== 'undefined' 
  ? Math.max(375, window.innerWidth * 0.5) 
  : 600;

/**
 * ChatDrawer Provider
 * 提供 ChatDrawer ref 的访问
 */
export const ChatDrawerProvider: React.FC<ChatDrawerProviderProps> = ({ children }) => {
  const chatDrawerRef = useRef<ChatDrawerRef>(null);
  const retryHandlerRef = useRef<RetryHandler | null>(null);
  const [selectedContent, setSelectedContent] = useState<SelectedContentItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_DRAWER_WIDTH);

  const registerRetryHandler = useCallback((handler: RetryHandler) => {
    retryHandlerRef.current = handler;
  }, []);

  const executeRetry = useCallback(async (workflow: WorkflowMessageData, startStepIndex: number) => {
    if (retryHandlerRef.current) {
      await retryHandlerRef.current(workflow, startStepIndex);
    } else {
      console.warn('[ChatDrawerContext] No retry handler registered');
    }
  }, []);

  return (
    <ChatDrawerContext.Provider value={{ 
      chatDrawerRef, 
      registerRetryHandler, 
      executeRetry, 
      selectedContent, 
      setSelectedContent,
      isDrawerOpen,
      setIsDrawerOpen,
      drawerWidth,
      setDrawerWidth,
    }}>
      {children}
    </ChatDrawerContext.Provider>
  );
};

/**
 * Hook to access ChatDrawer ref
 */
export function useChatDrawer(): ChatDrawerContextValue {
  const context = useContext(ChatDrawerContext);
  if (!context) {
    throw new Error('useChatDrawer must be used within a ChatDrawerProvider');
  }
  return context;
}

/**
 * Hook to get ChatDrawer control methods
 * 提供便捷的方法来控制 ChatDrawer
 */
export function useChatDrawerControl() {
  const { 
    chatDrawerRef, 
    registerRetryHandler, 
    executeRetry, 
    selectedContent, 
    setSelectedContent,
    isDrawerOpen,
    setIsDrawerOpen,
    drawerWidth,
    setDrawerWidth,
  } = useChatDrawer();

  return {
    /** 打开 ChatDrawer */
    openChatDrawer: () => {
      chatDrawerRef.current?.open();
    },
    /** 关闭 ChatDrawer */
    closeChatDrawer: () => {
      chatDrawerRef.current?.close();
    },
    /** 切换 ChatDrawer 状态 */
    toggleChatDrawer: () => {
      chatDrawerRef.current?.toggle();
    },
    /** 打开 ChatDrawer 并发送消息 */
    sendMessageToChatDrawer: async (content: string) => {
      await chatDrawerRef.current?.sendMessage(content);
    },
    /** 打开 ChatDrawer 并发送工作流消息（创建新对话） */
    sendWorkflowMessage: async (params: WorkflowMessageParams) => {
      await chatDrawerRef.current?.sendWorkflowMessage(params);
    },
    /** 更新当前工作流消息 */
    updateWorkflowMessage: (workflow: WorkflowMessageData) => {
      chatDrawerRef.current?.updateWorkflowMessage(workflow);
    },
    /** 追加 Agent 执行日志 */
    appendAgentLog: (log: AgentLogEntry) => {
      chatDrawerRef.current?.appendAgentLog(log);
    },
    /** 更新 AI 思考内容（流式追加） */
    updateThinkingContent: (content: string) => {
      chatDrawerRef.current?.updateThinkingContent(content);
    },
    /** 获取 ChatDrawer 是否打开 */
    isChatDrawerOpen: () => {
      return chatDrawerRef.current?.isOpen() ?? false;
    },
    /** 抽屉是否打开（响应式状态） */
    isDrawerOpen,
    /** 设置抽屉打开状态 */
    setIsDrawerOpen,
    /** 抽屉宽度 */
    drawerWidth,
    /** 设置抽屉宽度 */
    setDrawerWidth,
    /** 注册重试处理器 */
    registerRetryHandler,
    /** 从失败步骤重试工作流 */
    retryWorkflowFromStep: async (workflow: WorkflowMessageData, stepIndex: number) => {
      await executeRetry(workflow, stepIndex);
    },
    /** 选中内容 */
    selectedContent,
    /** 设置选中内容 */
    setSelectedContent,
  };
}

export default ChatDrawerContext;
