/**
 * 文本生成 MCP 工具
 *
 * 复用现有文本模型执行链，为 AI 输入栏文本模式提供统一工具入口。
 */

import type {
  MCPExecuteOptions,
  MCPResult,
  MCPTool,
} from '../types';
import { executorFactory } from '../../services/media-executor';
import type { ExecutionOptions } from '../../services/media-executor/types';
import { TaskType } from '../../types/task.types';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import { getDefaultTextModel } from '../../constants/model-config';
import { createQueueTask, validatePrompt } from './shared/queue-utils';

export interface TextGenerationParams {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  referenceImages?: string[];
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  globalIndex?: number;
  autoInsertToCanvas?: boolean;
  params?: Record<string, unknown>;
}

export function getCurrentTextModel(): string {
  const settings = geminiSettings.get();
  return settings?.textModelName || getDefaultTextModel();
}

function toExecutionOptions(_options?: MCPExecuteOptions): ExecutionOptions | undefined {
  return undefined;
}

function isTextGenerationParams(params: unknown): params is TextGenerationParams {
  return (
    typeof params === 'object'
    && params !== null
    && typeof (params as { prompt?: unknown }).prompt === 'string'
  );
}

async function executeAsync(
  params: TextGenerationParams,
  options: MCPExecuteOptions = {}
): Promise<MCPResult> {
  const promptError = validatePrompt(params.prompt);
  if (promptError) return promptError;

  try {
    const fallbackExecutor = executorFactory.getFallbackExecutor();
    const result = await fallbackExecutor.generateText(
      {
        prompt: params.prompt,
        model: params.model || getCurrentTextModel(),
        modelRef: params.modelRef || null,
        referenceImages: params.referenceImages,
        params: params.params,
      },
      toExecutionOptions(options)
    );

    return {
      success: true,
      data: result,
      type: 'text',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '文本生成失败',
      type: 'error',
    };
  }
}

/** 文本任务队列配置 */
function getTextQueueConfig(params: TextGenerationParams) {
  return {
    taskType: TaskType.CHAT,
    resultType: 'text' as const,
    getDefaultModel: getCurrentTextModel,
    maxCount: 1,
    buildTaskPayload: () => ({
      prompt: params.prompt,
      model: params.model || getCurrentTextModel(),
      modelRef: params.modelRef || null,
      referenceImages: params.referenceImages,
      ...(params.params ? { params: params.params } : {}),
    }),
  };
}

export async function generateText(
  params: TextGenerationParams,
  options: MCPExecuteOptions = {}
): Promise<MCPResult> {
  const mode = options.mode || 'async';
  if (mode === 'queue') {
    return createQueueTask(params, options, getTextQueueConfig(params));
  }
  return executeAsync(params, options);
}

export const textGenerationTool: MCPTool = {
  name: 'generate_text',
  description: '生成纯文本内容，可用于文章、摘要、说明、Markdown 等文本直出场景',
  supportedModes: ['async', 'queue'],
  execute: async (
    params: Record<string, unknown>,
    options?: MCPExecuteOptions
  ) => {
    if (!isTextGenerationParams(params)) {
      return {
        success: false,
        error: '缺少必填参数 prompt',
        type: 'error',
      };
    }
    return generateText(params, options);
  },
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '文本生成提示词',
      },
      model: {
        type: 'string',
        description: '文本模型 ID，默认使用当前文本路由模型',
      },
      referenceImages: {
        type: 'array',
        description: '参考图片 URL 列表，用于图像理解后输出文本',
        items: {
          type: 'string',
        },
      },
      params: {
        type: 'object',
        description: '文本模型额外参数，如 temperature、top_p、max_tokens',
      },
    },
    required: ['prompt'],
  },
};
