/**
 * 音频生成 MCP 工具
 *
 * 封装 Suno 音频生成能力，支持 async 与 queue 两种执行模式。
 */

import type { MCPExecuteOptions, MCPResult, MCPTaskResult, MCPTool } from '../types';
import { taskQueueService } from '../../services/task-queue';
import { TaskType } from '../../types/task.types';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import { getDefaultAudioModel } from '../../constants/model-config';
import {
  audioAPIService,
  extractAudioGenerationResult,
} from '../../services/audio-api-service';

export interface AudioGenerationParams {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  title?: string;
  tags?: string;
  mv?: string;
  continueSource?: 'clip' | 'upload';
  continueClipId?: string;
  continueAt?: number;
  count?: number;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  globalIndex?: number;
  params?: Record<string, unknown>;
}

export function getCurrentAudioModel(): string {
  const settings = geminiSettings.get();
  return settings?.audioModelName || getDefaultAudioModel();
}

async function executeAsync(params: AudioGenerationParams): Promise<MCPResult> {
  if (!params.prompt || typeof params.prompt !== 'string') {
    return {
      success: false,
      error: '缺少必填参数 prompt',
      type: 'error',
    };
  }

  try {
    const response = await audioAPIService.generateAudioWithPolling({
      model: params.model || getCurrentAudioModel(),
      modelRef: params.modelRef || null,
      prompt: params.prompt,
      title: params.title,
      tags: params.tags,
      mv: params.mv,
      continueClipId: params.continueClipId,
      continueAt: params.continueAt,
      params: {
        ...(params.params || {}),
        ...(params.continueSource
          ? { continueSource: params.continueSource }
          : {}),
      },
    });
    const result = extractAudioGenerationResult(response);

    return {
      success: true,
      data: {
        url: result.url,
        urls: result.urls,
        title: result.title,
        duration: result.duration,
        imageUrl: result.imageUrl,
        format: result.format || 'mp3',
        providerTaskId: result.providerTaskId,
        primaryClipId: result.primaryClipId,
        clipIds: result.clipIds,
        clips: result.clips,
      },
      type: 'audio',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '音频生成失败',
      type: 'error',
    };
  }
}

function executeQueue(
  params: AudioGenerationParams,
  options: MCPExecuteOptions
): MCPTaskResult {
  if (!params.prompt || typeof params.prompt !== 'string') {
    return {
      success: false,
      error: '缺少必填参数 prompt',
      type: 'error',
    };
  }

  try {
    const actualCount = 1;
    const batchId = params.batchId || options.batchId;
    const batchIndex = params.batchIndex ?? 1;
    const batchTotal = params.batchTotal ?? actualCount;
    const globalIndex = params.globalIndex ?? options.globalIndex ?? 1;

    const task = taskQueueService.createTask(
      {
        prompt: params.prompt,
        model: params.model || getCurrentAudioModel(),
        modelRef: params.modelRef || null,
        title: params.title,
        tags: params.tags,
        mv: params.mv,
        continueClipId: params.continueClipId,
        continueAt: params.continueAt,
        batchId,
        batchIndex,
        batchTotal,
        globalIndex,
        autoInsertToCanvas: false,
        ...((params.params || params.continueSource)
          ? {
              params: {
                ...(params.params || {}),
                ...(params.continueSource
                  ? { continueSource: params.continueSource }
                  : {}),
              },
            }
          : {}),
      },
      TaskType.AUDIO
    );

    return {
      success: true,
      data: {
        taskId: task.id,
        prompt: params.prompt,
        model: params.model || getCurrentAudioModel(),
        mv: params.mv,
      },
      type: 'audio',
      taskId: task.id,
      task,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '音频任务创建失败',
      type: 'error',
    };
  }
}

export async function generateAudio(
  params: AudioGenerationParams,
  options: MCPExecuteOptions = {}
): Promise<MCPResult | MCPTaskResult> {
  const mode = options.mode || 'async';
  if (mode === 'queue') {
    return executeQueue(params, options);
  }
  return executeAsync(params);
}

export const audioGenerationTool: MCPTool = {
  name: 'generate_audio',
  description: '生成音频或音乐，可用于 Suno 音乐生成与续写',
  supportedModes: ['async', 'queue'],
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '音乐描述或歌词内容',
      },
      model: {
        type: 'string',
        description: '音频能力模型 ID，默认 suno_music',
      },
      title: {
        type: 'string',
        description: '歌曲标题',
      },
      tags: {
        type: 'string',
        description: '风格标签，逗号分隔',
      },
      mv: {
        type: 'string',
        description: 'Suno 版本字段，如 chirp-v5-5、chirp-v5、chirp-v4-5、chirp-v4、chirp-v3-5',
      },
      continueClipId: {
        type: 'string',
        description: '续写目标 clip ID',
      },
      continueSource: {
        type: 'string',
        description: '续写来源，clip 或 upload；upload 会自动拼接 -upload 版本',
      },
      continueAt: {
        type: 'number',
        description: '从第几秒开始续写',
      },
    },
    required: ['prompt'],
  },
  async execute(params, options) {
    return generateAudio(params as unknown as AudioGenerationParams, options);
  },
};
