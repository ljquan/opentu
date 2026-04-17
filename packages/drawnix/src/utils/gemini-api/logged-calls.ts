/**
 * 带 LLM API 日志的 callGoogleGenerateContentRaw 包装
 *
 * 供直接调用 callGoogleGenerateContentRaw 的分析服务使用。
 * 不修改 callGoogleGenerateContentRaw 本身，避免与已有手动日志产生双重记录。
 */

import type { GeminiConfig, GeminiMessage, GeminiResponse } from './types';
import { callGoogleGenerateContentRaw } from './apiCalls';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  type LLMApiLog,
} from '../../services/media-executor/llm-api-logger';
import { truncate } from '@aitu/utils';

export async function callGoogleGenerateContentWithLog(
  config: GeminiConfig,
  messages: GeminiMessage[],
  options: {
    stream: boolean;
    onChunk?: (content: string) => void;
    signal?: AbortSignal;
    generationConfig?: Record<string, unknown>;
  },
  logMeta: {
    taskType: LLMApiLog['taskType'];
    prompt?: string;
    taskId?: string;
  }
): Promise<GeminiResponse> {
  const model = config.modelName || 'unknown';
  const logId = startLLMApiLog({
    endpoint: `generateContent${options.stream ? '?alt=sse' : ''}`,
    model,
    taskType: logMeta.taskType,
    prompt: logMeta.prompt,
    taskId: logMeta.taskId,
  });

  const startTime = Date.now();
  try {
    const response = await callGoogleGenerateContentRaw(config, messages, options);
    const resultText = response.choices?.[0]?.message?.content;
    completeLLMApiLog(logId, {
      httpStatus: 200,
      duration: Date.now() - startTime,
      resultType: 'text',
      resultText: resultText ? truncate(resultText, 1000) : undefined,
    });
    return response;
  } catch (error: any) {
    failLLMApiLog(logId, {
      duration: Date.now() - startTime,
      errorMessage: error.message || String(error),
    });
    throw error;
  }
}
