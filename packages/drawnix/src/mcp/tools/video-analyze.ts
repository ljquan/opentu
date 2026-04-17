/**
 * 视频分析 MCP 工具
 *
 * 通过 Gemini generateContent 端点分析视频内容，
 * 返回结构化的镜头拆解、脚本提取、风格分析等数据。
 *
 * 支持两种输入方式：
 * - base64 视频数据（inline_data，≤20MB）
 * - YouTube URL（file_uri）
 */

import type { MCPTool, MCPResult, MCPExecuteOptions } from '../types';
import { TaskType } from '../../types/task.types';
import { taskQueueService } from '../../services/task-queue';
import {
  DEFAULT_ANALYSIS_PROMPT,
  executeVideoAnalysis,
  type VideoAnalyzeParams,
} from '../../services/video-analysis-service';
export type {
  VideoAnalyzeParams,
  VideoAnalysisData,
  VideoShot,
  VideoShotType,
  TransitionHint,
} from '../../services/video-analysis-service';

function executeQueue(params: VideoAnalyzeParams): MCPResult & { taskId?: string; task?: unknown } {
  const prompt = params.prompt || DEFAULT_ANALYSIS_PROMPT;
  if (!params.videoData && !params.youtubeUrl && !params.videoCacheUrl) {
    return {
      success: false,
      error: '需要提供 videoData、videoCacheUrl 或 youtubeUrl',
      type: 'error',
    };
  }

  const task = taskQueueService.createTask(
    {
      prompt: params.taskLabel || '视频分析',
      model: params.model,
      modelRef: params.modelRef || null,
      mimeType: params.mimeType || 'video/mp4',
      youtubeUrl: params.youtubeUrl,
      videoData: params.videoData,
      videoCacheUrl: params.videoCacheUrl,
      videoAnalyzerAction: 'analyze',
      videoAnalyzerPrompt: prompt,
      videoAnalyzerSource: params.videoAnalyzerSource,
      videoAnalyzerSourceLabel: params.videoAnalyzerSourceLabel,
      videoAnalyzerSourceSnapshot: params.videoAnalyzerSourceSnapshot,
      autoInsertToCanvas: false,
    },
    TaskType.CHAT
  );

  return {
    success: true,
    data: {
      taskId: task.id,
      prompt: params.taskLabel || '视频分析',
      model: params.model,
    },
    type: 'text',
    taskId: task.id,
    task,
  };
}

// ============================================================================
// MCP 工具定义
// ============================================================================

export const videoAnalyzeTool: MCPTool = {
  name: 'video_analyze',
  description: '分析视频内容，返回结构化的镜头拆解、脚本提取、风格分析等数据',
  supportedModes: ['async', 'queue'],

  inputSchema: {
    type: 'object',
    properties: {
      videoData: {
        type: 'string',
        description: 'base64 编码的视频数据（不含 data: 前缀），≤20MB',
      },
      mimeType: {
        type: 'string',
        description: '视频 MIME 类型，默认 video/mp4',
        default: 'video/mp4',
      },
      youtubeUrl: {
        type: 'string',
        description: 'YouTube 视频 URL',
      },
      videoCacheUrl: {
        type: 'string',
        description: '本地缓存的视频 URL（队列模式）',
      },
      prompt: {
        type: 'string',
        description: '自定义分析 prompt（可选，有内置默认值）',
      },
      model: {
        type: 'string',
        description: '模型 ID，默认使用当前文本模型',
      },
    },
    required: [],
  },

  execute: async (
    params: Record<string, unknown>,
    options?: MCPExecuteOptions
  ): Promise<MCPResult> => {
    if (options?.mode === 'queue') {
      return executeQueue(params as unknown as VideoAnalyzeParams);
    }
    return executeVideoAnalysis(params as unknown as VideoAnalyzeParams);
  },
};
