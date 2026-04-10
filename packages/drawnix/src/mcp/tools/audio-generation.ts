/**
 * 音频生成 MCP 工具
 *
 * 封装 Suno 音频生成能力，支持 async 与 queue 两种执行模式。
 */

import type { MCPExecuteOptions, MCPResult, MCPTool } from '../types';
import { TaskType } from '../../types/task.types';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import { getDefaultAudioModel } from '../../constants/model-config';
import {
  audioAPIService,
  extractAudioGenerationResult,
} from '../../services/audio-api-service';
import { createQueueTask, validatePrompt } from './shared/queue-utils';

export interface AudioGenerationParams {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  sunoAction?: 'music' | 'lyrics';
  notifyHook?: string;
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
  autoInsertToCanvas?: boolean;
  params?: Record<string, unknown>;
}

export function getCurrentAudioModel(): string {
  const settings = geminiSettings.get();
  return settings?.audioModelName || getDefaultAudioModel();
}

async function executeAsync(params: AudioGenerationParams): Promise<MCPResult> {
  const promptError = validatePrompt(params.prompt);
  if (promptError) return promptError;

  try {
    const response = await audioAPIService.generateAudioWithPolling({
      model: params.model || getCurrentAudioModel(),
      modelRef: params.modelRef || null,
      prompt: params.prompt,
      sunoAction: params.sunoAction,
      notifyHook: params.notifyHook,
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
        resultKind: result.resultKind,
        title: result.title,
        lyricsText: result.lyricsText,
        lyricsTitle: result.lyricsTitle,
        lyricsTags: result.lyricsTags,
        duration: result.duration,
        imageUrl: result.imageUrl,
        format: result.format || (result.resultKind === 'lyrics' ? 'lyrics' : 'mp3'),
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

/** 音频任务队列配置 */
function getAudioQueueConfig(params: AudioGenerationParams) {
  return {
    taskType: TaskType.AUDIO,
    resultType: 'audio' as const,
    getDefaultModel: getCurrentAudioModel,
    maxCount: 1,
    buildTaskPayload: () => ({
      prompt: params.prompt,
      model: params.model || getCurrentAudioModel(),
      modelRef: params.modelRef || null,
      sunoAction: params.sunoAction,
      notifyHook: params.notifyHook,
      title: params.title,
      tags: params.tags,
      mv: params.mv,
      continueClipId: params.continueClipId,
      continueAt: params.continueAt,
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
    }),
    buildResultData: () => ({
      mv: params.mv,
    }),
  };
}

export async function generateAudio(
  params: AudioGenerationParams,
  options: MCPExecuteOptions = {}
): Promise<MCPResult> {
  const mode = options.mode || 'async';
  if (mode === 'queue') {
    return createQueueTask(params, options, getAudioQueueConfig(params));
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
      sunoAction: {
        type: 'string',
        description: 'Suno 动作类型，music 或 lyrics',
      },
      notifyHook: {
        type: 'string',
        description: '歌词生成完成后的回调地址',
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
