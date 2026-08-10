import type {
  ParsedGenerationParams,
  GenerationType,
  SelectionInfo,
} from '../../utils/ai-input-parser';
import type { ModelRef } from '../../utils/settings-types';
import type { KnowledgeContextRef } from '../../types/task.types';
import type { CanvasAssociationRef } from '../../types/shared/core.types';

/**
 * 工作流步骤执行选项（批量参数等）
 */
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

/**
 * 工作流步骤定义
 */
export interface WorkflowStep {
  /** 步骤 ID */
  id: string;
  /** MCP 工具名称 */
  mcp: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 执行选项（批量参数等） */
  options?: WorkflowStepOptions;
  /** 步骤描述 */
  description: string;
  /** 步骤状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration?: number;
}

/**
 * 工作流定义
 */
export interface WorkflowDefinition {
  /** 工作流 ID */
  id: string;
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description: string;
  /** 场景类型 */
  scenarioType: 'direct_generation' | 'agent_flow' | 'skill_flow';
  /** 选中的 Skill ID（skill_flow 时有值） */
  skillId?: string;
  /** 生成类型 */
  generationType: GenerationType;
  /** 工作流状态 */
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** AI 分析内容（AI 对用户请求的理解和计划） */
  aiAnalysis?: string;
  /** 步骤列表 */
  steps: WorkflowStep[];
  /** 元数据 */
  metadata: {
    /** 最终生成用的提示词 */
    prompt: string;
    /** 用户输入的指令（可能包含额外要求） */
    userInstruction: string;
    /** 原始输入文本 */
    rawInput: string;
    /** 模型 ID */
    modelId: string;
    /** 模型来源引用 */
    modelRef?: ModelRef | null;
    /** Agent/Skill 后续媒体生成默认模型 */
    defaultModels?: ParsedGenerationParams['defaultModels'];
    /** Agent/Skill 后续媒体生成默认模型来源 */
    defaultModelRefs?: ParsedGenerationParams['defaultModelRefs'];
    /** 是否为用户显式选择的模型 */
    isModelExplicit: boolean;
    /** 生成数量 */
    count: number;
    /** 尺寸参数（如 '16x9', '1x1'） */
    size?: string;
    /** 时长（视频） */
    duration?: string;
    /** 参考图片（图片 + 图形） */
    referenceImages?: string[];
    /** 选中元素的分类信息 */
    selection: SelectionInfo;
    /** 本次生成使用的知识库笔记轻量引用 */
    knowledgeContextRefs?: KnowledgeContextRef[];
    /** 本次生成显式提及的画布元素轻量引用 */
    canvasAssociations?: CanvasAssociationRef[];
    /** 解析方式标记（用于调试和数据分析） */
    parseMethod?: 'regex' | 'llm' | 'agent_fallback';
  };
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt?: number;
  /** 上下文信息（从 SW 恢复时使用） */
  context?: {
    userInput?: string;
    model?: string;
    modelRef?: ModelRef | null;
    referenceImages?: string[];
    canvasAssociations?: CanvasAssociationRef[];
  };
  /** 错误信息（失败时） */
  error?: string;
}
