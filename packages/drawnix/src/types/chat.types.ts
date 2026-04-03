/**
 * Chat Drawer Type Definitions
 *
 * TypeScript interfaces for the Chat Drawer feature.
 */

// ============================================================================
// Enums
// ============================================================================

/** 消息状态枚举 */
export enum MessageStatus {
  SENDING = 'sending',
  STREAMING = 'streaming',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/** 消息角色枚举 */
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

// ============================================================================
// Entities
// ============================================================================

/** 附件接口 */
export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;
  isBlob: boolean;
}

/** Agent 执行日志条目类型 */
export type AgentLogEntry =
  | {
      type: 'thinking';
      timestamp: number;
      /** AI 正在思考的内容（流式累积） */
      content: string;
    }
  | {
      type: 'tool_call';
      timestamp: number;
      /** 工具名称 */
      toolName: string;
      /** 工具参数 */
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      timestamp: number;
      /** 工具名称 */
      toolName: string;
      /** 是否成功 */
      success: boolean;
      /** 结果数据 */
      data?: unknown;
      /** 错误信息 */
      error?: string;
      /** 结果类型 */
      resultType?: 'image' | 'video' | 'audio' | 'text' | 'canvas' | 'error';
    }
  | {
      type: 'retry';
      timestamp: number;
      /** 重试原因 */
      reason: string;
      /** 第几次重试 */
      attempt: number;
    };

/** 工作流步骤选项（批量参数等） */
export interface WorkflowStepOptions {
  /** 执行模式 */
  mode?: 'async' | 'queue';
  /** 批次 ID */
  batchId?: string;
  /** 批次索引（1-based） */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引 */
  globalIndex?: number;
}

/** 工作流步骤接口 */
export interface WorkflowStepData {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  mcp: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration?: number;
  /** 步骤选项（用于重试） */
  options?: WorkflowStepOptions;
}

/** 工作流重试上下文 */
export interface WorkflowRetryContext {
  /** AI 输入上下文 */
  aiContext: AIInputContext;
  /** 参考图片 URL 列表 */
  referenceImages: string[];
  /** 文本模型（用于 Agent 流程） */
  textModel?: string;
}

/** 后处理状态（图片拆分、插入画布等） */
export type PostProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** 工作流数据接口（用于消息中嵌入工作流） */
export interface WorkflowMessageData {
  /** 工作流 ID */
  id: string;
  /** 工作流名称 */
  name: string;
  /** 生成类型 */
  generationType: 'image' | 'video' | 'audio' | 'text';
  /** 原始提示词 */
  prompt: string;
  /** AI 分析内容（AI 对用户请求的理解和执行计划） */
  aiAnalysis?: string;
  /** 生成数量 */
  count: number;
  /** 工作流状态 */
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 创建时间戳（用于判断是否是新创建的工作流） */
  createdAt?: number;
  /** 步骤列表 */
  steps: WorkflowStepData[];
  /** Agent 执行日志（详细的执行过程） */
  logs?: AgentLogEntry[];
  /** 重试上下文（保存用于重试的必要信息） */
  retryContext?: WorkflowRetryContext;
  /** 后处理状态（图片拆分、插入画布等） */
  postProcessingStatus?: PostProcessingStatus;
  /** 插入到画布的元素数量 */
  insertedCount?: number;
  /** 错误信息 */
  error?: string;
}

/** 对话消息接口 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  status: MessageStatus;
  attachments?: Attachment[];
  error?: string;
  /** 工作流数据（当消息包含工作流时） */
  workflow?: WorkflowMessageData;
  /** AI 输入上下文（用于用户消息展示） */
  aiContext?: AIInputContext;
}

/** 对话会话接口 */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** 抽屉状态接口 */
export interface DrawerState {
  isOpen: boolean;
  width: number;
  activeSessionId: string | null;
}

// ============================================================================
// Service Interfaces
// ============================================================================

/** 发送消息请求 */
export interface SendMessageRequest {
  sessionId: string;
  content: string;
  attachments?: File[];
}

/** 流式响应事件 */
export interface StreamEvent {
  type: 'content' | 'done' | 'error';
  content?: string;
  error?: string;
}

// ============================================================================
// Component Props Interfaces
// ============================================================================

/** ChatDrawer 组件 Props */
export interface ChatDrawerProps {
  defaultOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

/** 选中的内容项 */
export interface SelectedContentItem {
  /** 内容类型 */
  type: 'image' | 'video' | 'graphics' | 'text';
  /** 媒体 URL（图片/视频/图形） */
  url?: string;
  /** 文字内容 */
  text?: string;
  /** 显示名称 */
  name: string;
}

/** AI 输入上下文 - 完整的用户输入信息 */
export interface AIInputContext {
  /** 用户在输入框中输入的原始文本（包含 #模型 -参数 +数量 等） */
  rawInput: string;
  /** 解析后的纯文本（去除模型/参数/数量标记后的用户指令） */
  userInstruction: string;

  /** 选中的模型配置 */
  model: {
    /** 模型 ID */
    id: string;
    /** 生成类型 */
    type: 'image' | 'video' | 'audio' | 'text';
    /** 是否为用户显式选择 */
    isExplicit: boolean;
  };

  /** 选中的参数 */
  params: {
    /** 生成数量 */
    count: number;
    /** 尺寸（如 '16x9', '1x1'） */
    size?: string;
    /** 时长（视频） */
    duration?: string;
    /** 音频版本 */
    mv?: string;
    /** 其他自定义参数 */
    custom?: Record<string, string>;
  };

  /** 选中的画布元素 */
  selection: {
    /** 选中的文本内容（作为生成 prompt） */
    texts: string[];
    /** 选中的图片 URL */
    images: string[];
    /** 选中的视频 URL */
    videos: string[];
    /** 选中的图形转换为的图片 URL */
    graphics: string[];
  };

  /** 合并后的最终 prompt（文本元素 + 默认 prompt） */
  finalPrompt: string;
}

/** 工作流消息参数 */
export interface WorkflowMessageParams {
  /** 完整的 AI 输入上下文 */
  context: AIInputContext;
  /** 工作流数据 */
  workflow: WorkflowMessageData;
  /** 使用的文本模型（用于 Agent 流程） */
  textModel?: string;
  /** 是否自动打开 ChatDrawer，默认 true */
  autoOpen?: boolean;
}

/** ChatDrawer Ref API - 用于外部控制 ChatDrawer */
export interface ChatDrawerRef {
  /** 打开抽屉 */
  open: () => void;
  /** 关闭抽屉 */
  close: () => void;
  /** 切换抽屉状态 */
  toggle: () => void;
  /** 打开抽屉并发送消息 */
  sendMessage: (content: string) => Promise<void>;
  /** 打开抽屉并发送工作流消息（创建新对话） */
  sendWorkflowMessage: (params: WorkflowMessageParams) => Promise<void>;
  /** 更新当前工作流消息 */
  updateWorkflowMessage: (workflow: WorkflowMessageData) => void;
  /** 追加 Agent 执行日志 */
  appendAgentLog: (log: AgentLogEntry) => void;
  /** 更新 AI 思考内容（流式追加） */
  updateThinkingContent: (content: string) => void;
  /** 获取当前打开状态 */
  isOpen: () => boolean;
  /** 从指定步骤重试工作流 */
  retryWorkflowFromStep: (workflow: WorkflowMessageData, stepIndex: number) => Promise<void>;
}


/** SessionList 组件 Props */
export interface SessionListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
}

/** SessionItem 组件 Props */
export interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}

// ============================================================================
// Hook Return Types
// ============================================================================

/** useChatSessions Hook 返回类型 */
export interface UseChatSessionsReturn {
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  isLoading: boolean;
  createSession: () => Promise<ChatSession>;
  selectSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
}
