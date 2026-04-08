/**
 * MCP (Model Context Protocol) 类型定义
 * 
 * 基于 JSON-RPC 2.0 协议，定义 MCP 工具的标准接口
 */

// 从公共配置导入模型相关定义
export type { ModelType, ModelConfig } from '../constants/model-config';
export {
  IMAGE_MODELS,
  VIDEO_MODELS,
  ALL_MODELS,
  getModelsByType,
  getModelConfig,
  getModelType,
  getModelIds,
  supportsTools,
} from '../constants/model-config';
import type { ModelRef } from '../utils/settings-manager';
import type { GeminiMessagePart } from '../utils/gemini-api/types';

/**
 * JSON Schema 类型定义
 */
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  description?: string;
  items?: JSONSchemaProperty;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * MCP 工具执行模式
 */
export type MCPExecuteMode = 'async' | 'queue';

/**
 * 工作流步骤信息（用于回调）
 */
export interface WorkflowStepInfo {
  id: string;
  mcp: string;
  args: Record<string, unknown>;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  options?: MCPExecuteOptions;
}

/**
 * MCP 工具执行回调（标准回调，所有工具都可使用）
 */
export interface MCPExecuteCallbacks {
  /** 流式输出回调（用于 AI 思考过程） */
  onChunk?: (content: string) => void;
  /** 动态添加工作流步骤回调 */
  onAddSteps?: (steps: WorkflowStepInfo[]) => void;
  /** 更新步骤状态回调 */
  onUpdateStep?: (stepId: string, status: WorkflowStepInfo['status'], result?: unknown, error?: string, duration?: number) => void;
}

/**
 * MCP 工具执行选项
 */
export interface MCPExecuteOptions extends MCPExecuteCallbacks {
  /** 执行模式：async（等待API返回）或 queue（加入任务队列） */
  mode?: MCPExecuteMode;
  /** 批次 ID（用于批量任务去重） */
  batchId?: string;
  /** 批次索引（1-based） */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引（用于批量任务排序） */
  globalIndex?: number;
  /** 重试任务 ID（重试时复用原有任务） */
  retryTaskId?: string;
}

/**
 * 队列模式返回的任务信息
 */
export interface MCPTaskResult extends MCPResult {
  /** 创建的任务 ID（队列模式） */
  taskId?: string;
  /** 创建的任务对象（队列模式） */
  task?: unknown;
}

/**
 * 工具使用示例
 */
export interface ToolExample {
  /** 用户输入描述 */
  input: string;
  /** 工具调用参数 */
  args: Record<string, unknown>;
  /** 说明（可选） */
  explanation?: string;
}

/**
 * 工具 Prompt 指导信息
 * 用于指导文本模型如何更好地生成工具调用参数
 */
export interface ToolPromptGuidance {
  /** 使用场景说明 */
  whenToUse?: string;
  /** 参数生成指导 */
  parameterGuidance?: Record<string, string>;
  /** 最佳实践 */
  bestPractices?: string[];
  /** 示例调用 */
  examples?: ToolExample[];
  /** 注意事项 */
  warnings?: string[];
}

/**
 * MCP 工具定义
 */
export interface MCPTool {
  /** 工具唯一名称 */
  name: string;
  /** 工具描述，用于 LLM 理解工具用途 */
  description: string;
  /** 输入参数 Schema */
  inputSchema: JSONSchema;
  /** 工具执行函数（默认 async 模式） */
  execute: (params: Record<string, unknown>, options?: MCPExecuteOptions) => Promise<MCPResult>;
  /** 支持的执行模式（默认只支持 async） */
  supportedModes?: MCPExecuteMode[];
  /** Prompt 指导信息，帮助文本模型更好地生成参数 */
  promptGuidance?: ToolPromptGuidance;
}

/**
 * MCP 工具执行结果
 */
export interface MCPResult {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** 结果类型标识 */
  type?: 'image' | 'video' | 'audio' | 'text' | 'canvas' | 'error';
}

/**
 * 工具调用请求（从 LLM 响应中解析）
 */
export interface ToolCall {
  /** 工具名称 */
  name: string;
  /** 调用参数 */
  arguments: Record<string, unknown>;
  /** 调用 ID（用于关联响应） */
  id?: string;
}

/**
 * JSON-RPC 2.0 请求
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number;
}

/**
 * JSON-RPC 2.0 响应
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number;
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  /** 是否成功 */
  success: boolean;
  /** 最终响应文本 */
  response?: string;
  /** 工具调用结果列表 */
  toolResults?: MCPResult[];
  /** 错误信息 */
  error?: string;
  /** 使用的模型 */
  model?: string;
}

/**
 * 图片尺寸信息
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Agent 执行上下文 - 完整的用户输入信息
 */
export interface AgentExecutionContext {
  /** 用户在输入框输入的指令（去除模型/参数/数量后的纯文本） */
  userInstruction: string;
  /** 原始输入文本（包含 #模型 -参数 +数量 等） */
  rawInput: string;

  /** 模型配置 */
  model: {
    /** 模型 ID */
    id: string;
    /** 生成类型: text = agent 模式, image = 图片模式, video = 视频模式, audio = 音频模式 */
    type: 'text' | 'image' | 'video' | 'audio';
    /** 是否为用户显式选择 */
    isExplicit: boolean;
  };

  /** 系统配置的默认模型（用于 AI 分析时参考） */
  defaultModels?: {
    /** 默认图片模型 */
    image: string;
    /** 默认视频模型 */
    video: string;
    /** 默认音频模型 */
    audio?: string;
  };

  /** 参数配置 */
  params: {
    /** 生成数量 */
    count: number;
    /** 尺寸（如 '16x9', '1x1'） */
    size?: string;
    /** 时长（视频） */
    duration?: string;
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
    /** 图片尺寸信息（按顺序对应 images + graphics） */
    imageDimensions?: ImageDimensions[];
  };

  /** 最终生成用的 prompt */
  finalPrompt: string;
}

/**
 * Agent 执行选项
 */
export interface AgentExecuteOptions {
  /** 指定使用的模型 */
  model?: string;
  /** 指定使用的供应商模型来源 */
  modelRef?: ModelRef | null;
  /** 流式输出回调 */
  onChunk?: (content: string) => void;
  /** 工具调用回调 */
  onToolCall?: (toolCall: ToolCall) => void;
  /** 工具结果回调 */
  onToolResult?: (result: MCPResult) => void;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 最大工具调用轮数 */
  maxIterations?: number;
  /**
   * 预构建的消息数组（优先级高于内部生成的 messages）
   * 传入时直接使用，跳过 generateSystemPrompt() 的调用
   * 用于 Skill 路径 B（Agent 精准注入）和路径 C（角色扮演）
   */
  messages?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | GeminiMessagePart[];
  }>;
}
