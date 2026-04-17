/**
 * 音频分析 MCP 工具
 *
 * 通过 Gemini generateContent 分析音频内容，
 * 输出结构化的音乐/歌词改写建议。
 */

import type { MCPExecuteOptions, MCPResult, MCPTool } from '../types';
import { TaskType } from '../../types/task.types';
import { taskQueueService } from '../../services/task-queue';
import {
  DEFAULT_MUSIC_ANALYSIS_PROMPT,
  executeMusicAnalysis,
  type MusicAnalyzeParams,
} from '../../services/music-analysis-service';

export type { MusicAnalyzeParams, MusicAnalysisData } from '../../services/music-analysis-service';

function executeQueue(
  params: MusicAnalyzeParams
): MCPResult & { taskId?: string; task?: unknown } {
  const prompt = params.prompt || DEFAULT_MUSIC_ANALYSIS_PROMPT;
  if (!params.audioData && !(params as any).audioCacheUrl) {
    return {
      success: false,
      error: '需要提供 audioData 或 audioCacheUrl',
      type: 'error',
    };
  }

  const task = taskQueueService.createTask(
    {
      prompt: params.taskLabel || '音频分析',
      model: params.model,
      modelRef: params.modelRef || null,
      mimeType: params.mimeType || 'audio/mpeg',
      audioData: params.audioData,
      audioCacheUrl: (params as any).audioCacheUrl,
      musicAnalyzerAction: 'analyze',
      musicAnalyzerPrompt: prompt,
      musicAnalyzerSource: params.musicAnalyzerSource,
      musicAnalyzerSourceLabel: params.musicAnalyzerSourceLabel,
      musicAnalyzerSourceSnapshot: params.musicAnalyzerSourceSnapshot,
      autoInsertToCanvas: false,
    },
    TaskType.CHAT
  );

  return {
    success: true,
    data: {
      taskId: task.id,
      prompt: params.taskLabel || '音频分析',
      model: params.model,
    },
    type: 'text',
    taskId: task.id,
    task,
  };
}

export const audioAnalyzeTool: MCPTool = {
  name: 'audio_analyze',
  description: '分析音频内容，返回结构化的音乐风格、情绪、Suno 标签和歌词改写建议',
  supportedModes: ['async', 'queue'],
  inputSchema: {
    type: 'object',
    properties: {
      audioData: {
        type: 'string',
        description: 'base64 编码的音频数据（不含 data: 前缀）',
      },
      mimeType: {
        type: 'string',
        description: '音频 MIME 类型，默认 audio/mpeg',
        default: 'audio/mpeg',
      },
      audioCacheUrl: {
        type: 'string',
        description: '本地缓存的音频 URL（队列模式）',
      },
      prompt: {
        type: 'string',
        description: '自定义分析 prompt（可选，有内置默认值）',
      },
      model: {
        type: 'string',
        description: 'Gemini 多模态模型 ID，默认使用当前文本模型',
      },
    },
    required: [],
  },
  execute: async (
    params: Record<string, unknown>,
    options?: MCPExecuteOptions
  ): Promise<MCPResult> => {
    if (options?.mode === 'queue') {
      return executeQueue(params as unknown as MusicAnalyzeParams);
    }
    return executeMusicAnalysis(params as unknown as MusicAnalyzeParams);
  },
};
