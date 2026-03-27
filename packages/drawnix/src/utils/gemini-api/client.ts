/**
 * Gemini API 客户端类
 */

import {
  GeminiConfig,
  ImageInput,
  VideoGenerationOptions,
  GeminiMessage,
} from './types';
import { DEFAULT_CONFIG, VIDEO_DEFAULT_CONFIG } from './config';
import {
  generateImageWithGemini,
  generateVideoWithGemini,
  chatWithGemini,
  sendChatWithGemini,
} from './services';
import { geminiSettings, type ModelRef } from '../settings-manager';

/**
 * Gemini API 客户端
 */
export class GeminiClient {
  private isVideoClient: boolean;

  constructor(isVideoClient = false) {
    this.isVideoClient = isVideoClient;
  }

  /**
   * 获取当前有效配置（直接从 localStorage 实时读取）
   */
  private getEffectiveConfig(): GeminiConfig {
    const globalSettings = geminiSettings.get();

    if (this.isVideoClient) {
      return {
        ...VIDEO_DEFAULT_CONFIG,
        ...globalSettings,
        modelName:
          globalSettings.videoModelName || VIDEO_DEFAULT_CONFIG.modelName,
      };
    } else {
      return {
        ...DEFAULT_CONFIG,
        ...globalSettings,
        modelName: globalSettings.imageModelName || DEFAULT_CONFIG.modelName,
      };
    }
  }

  /**
   * 生成图片
   */
  async generateImage(
    prompt: string,
    options: {
      size?: string;
      image?: string | string[];
      response_format?: 'url' | 'b64_json';
      quality?: '1k' | '2k' | '4k';
      count?: number;
      model?: string; // 支持指定模型
      modelRef?: ModelRef | null;
    } = {}
  ) {
    return generateImageWithGemini(prompt, options);
  }

  /**
   * 生成视频
   */
  async generateVideo(
    prompt: string,
    image: ImageInput | null,
    options: VideoGenerationOptions = {}
  ) {
    return generateVideoWithGemini(prompt, image, options);
  }

  /**
   * 聊天对话（支持图片输入）
   */
  async chat(
    prompt: string,
    images: ImageInput[] = [],
    onChunk?: (content: string) => void
  ) {
    return chatWithGemini(prompt, images, onChunk);
  }

  /**
   * 发送多轮对话消息
   * @param messages 消息列表
   * @param onChunk 流式回调
   * @param signal 取消信号
   * @param temporaryModel 临时模型（仅在当前会话中使用，不影响全局设置）
   */
  async sendChat(
    messages: GeminiMessage[],
    onChunk?: (content: string) => void,
    signal?: AbortSignal,
    temporaryModel?: string | ModelRef | null
  ) {
    return sendChatWithGemini(messages, onChunk, signal, temporaryModel);
  }

  /**
   * 获取当前配置
   */
  getConfig(): GeminiConfig {
    return this.getEffectiveConfig();
  }
}

/**
 * 创建默认的 Gemini 客户端实例（用于图片生成和聊天）
 */
export const defaultGeminiClient = new GeminiClient(false);

/**
 * 创建视频生成专用的 Gemini 客户端实例
 */
export const videoGeminiClient = new GeminiClient(true);
