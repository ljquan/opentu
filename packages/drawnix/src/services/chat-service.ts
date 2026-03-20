/**
 * Chat Service
 *
 * Handles AI chat API communication with streaming support using the unified Gemini API client.
 * Supports generic OpenAI-compatible APIs via the client configuration.
 */

import { defaultGeminiClient } from '../utils/gemini-api';
import type { GeminiMessage } from '../utils/gemini-api/types';
import {
  buildImagePartsFromAttachmentInputs,
  buildImagePartsFromChatAttachments,
  countImageAttachmentInputs,
  countImageParts,
} from '../utils/gemini-api/message-utils';
import type { Attachment, ChatMessage, StreamEvent } from '../types/chat.types';
import { MessageRole } from '../types/chat.types';
import { analytics } from '../utils/posthog-analytics';
import type { ModelRef } from '../utils/settings-manager';
import {
  getTextBindingMaxImageCount,
  resolveInvocationPlanFromRoute,
  supportsTextBindingImageInput,
} from './provider-routing';

// Current abort controller for cancellation
let currentAbortController: AbortController | null = null;

// 媒体 URL 映射，用于在响应中替换回原始 URL
interface MediaUrlMap {
  [placeholder: string]: string;
}

/**
 * 替换消息中的图片/视频 URL 为带索引的占位符，并返回映射表
 * 用于发送给文本模型时减少 token 消耗，响应后可替换回原始 URL
 */
function extractAndReplaceMediaUrls(content: string): {
  sanitized: string;
  urlMap: MediaUrlMap;
} {
  const urlMap: MediaUrlMap = {};
  let imageIndex = 1;
  let videoIndex = 1;
  let mediaIndex = 1;

  let result = content;

  // 替换 base64 图片
  result = result.replace(
    /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
    (match) => {
      const placeholder = `[图片${imageIndex}]`;
      urlMap[placeholder] = match;
      imageIndex++;
      return placeholder;
    }
  );

  // 替换 base64 视频
  result = result.replace(
    /data:video\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
    (match) => {
      const placeholder = `[视频${videoIndex}]`;
      urlMap[placeholder] = match;
      videoIndex++;
      return placeholder;
    }
  );

  // 替换 blob URL
  result = result.replace(/blob:[^\s"'<>]+/g, (match) => {
    const placeholder = `[媒体${mediaIndex}]`;
    urlMap[placeholder] = match;
    mediaIndex++;
    return placeholder;
  });

  // 替换远程图片 URL (常见图片扩展名)
  result = result.replace(
    /https?:\/\/[^\s"'<>]+\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?[^\s"'<>]*)?/gi,
    (match) => {
      const placeholder = `[图片${imageIndex}]`;
      urlMap[placeholder] = match;
      imageIndex++;
      return placeholder;
    }
  );

  // 替换远程视频 URL (常见视频扩展名)
  result = result.replace(
    /https?:\/\/[^\s"'<>]+\.(mp4|webm|mov|avi|mkv)(\?[^\s"'<>]*)?/gi,
    (match) => {
      const placeholder = `[视频${videoIndex}]`;
      urlMap[placeholder] = match;
      videoIndex++;
      return placeholder;
    }
  );

  return { sanitized: result, urlMap };
}

/**
 * 将响应中的占位符替换回原始 URL
 */
function restoreMediaUrls(content: string, urlMap: MediaUrlMap): string {
  let result = content;
  for (const [placeholder, url] of Object.entries(urlMap)) {
    // 使用全局替换，因为模型可能多次引用同一个占位符
    result = result.split(placeholder).join(url);
  }
  return result;
}

/** Convert ChatMessage to GeminiMessage format */
async function convertToGeminiMessages(
  messages: ChatMessage[],
  options: {
    includeImageAttachments?: boolean;
    maxImageCount?: number;
  } = {}
): Promise<{
  geminiMessages: GeminiMessage[];
  urlMap: MediaUrlMap;
}> {
  const combinedUrlMap: MediaUrlMap = {};
  let remainingImageSlots = options.maxImageCount ?? Number.POSITIVE_INFINITY;

  const geminiMessages = await Promise.all(
    messages
      .filter((m) => m.status === 'success' || m.status === 'streaming')
      .map(async (m) => {
      const { sanitized, urlMap } = extractAndReplaceMediaUrls(m.content);
      // 合并 URL 映射
      Object.assign(combinedUrlMap, urlMap);
      const content: GeminiMessage['content'] = [
        { type: 'text', text: sanitized },
      ];

      if (
        options.includeImageAttachments &&
        m.role === MessageRole.USER &&
        m.attachments &&
        m.attachments.length > 0 &&
        remainingImageSlots > 0
      ) {
        const imageParts = await buildImagePartsFromChatAttachments(
          m.attachments,
          remainingImageSlots
        );
        remainingImageSlots -= imageParts.length;
        content.push(...imageParts);
      }

      return {
        role: m.role === MessageRole.USER ? 'user' : 'assistant',
        content,
      };
      })
  );

  return {
    geminiMessages: geminiMessages as GeminiMessage[],
    urlMap: combinedUrlMap,
  };
}

/** Send message and get streaming response */
export async function sendChatMessage(
  messages: ChatMessage[],
  newContent: string,
  attachments: Array<File | Attachment> = [],
  onStream: (event: StreamEvent) => void,
  temporaryModel?: string | ModelRef | null,
  systemPrompt?: string
): Promise<string> {
  return sendChatMessageDirect(
    messages,
    newContent,
    attachments,
    onStream,
    temporaryModel,
    systemPrompt
  );
}

/** Send chat message directly (legacy mode) */
async function sendChatMessageDirect(
  messages: ChatMessage[],
  newContent: string,
  attachments: Array<File | Attachment> = [],
  onStream: (event: StreamEvent) => void,
  temporaryModel?: string | ModelRef | null,
  systemPrompt?: string
): Promise<string> {
  // Cancel any existing request
  if (currentAbortController) {
    currentAbortController.abort();
  }

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;
  const taskId = Date.now().toString();
  const startTime = Date.now();

  // 确定使用的模型名称（临时模型优先）
  const modelName =
    (typeof temporaryModel === 'string'
      ? temporaryModel
      : temporaryModel?.modelId) ||
    defaultGeminiClient.getConfig().modelName ||
    'unknown';

  try {
    // Track chat start
    analytics.trackModelCall({
      taskId,
      taskType: 'chat',
      model: modelName,
      promptLength: newContent.length,
      hasUploadedImage: attachments.length > 0,
      startTime,
    });

    // Build history with URL extraction
    const textPlan = resolveInvocationPlanFromRoute('text', temporaryModel);
    const supportsImageInput = supportsTextBindingImageInput(textPlan?.binding);
    const maxImageCount = getTextBindingMaxImageCount(textPlan?.binding);
    const currentImageCount = countImageAttachmentInputs(attachments);
    const maxHistoryImageCount = Math.max(maxImageCount - currentImageCount, 0);

    const { geminiMessages: history, urlMap: historyUrlMap } =
      await convertToGeminiMessages(messages, {
        includeImageAttachments: supportsImageInput,
        maxImageCount: maxHistoryImageCount,
      });

    // Process current message content
    const { sanitized: sanitizedContent, urlMap: currentUrlMap } =
      extractAndReplaceMediaUrls(newContent);

    // 合并所有 URL 映射
    const allUrlMap: MediaUrlMap = { ...historyUrlMap, ...currentUrlMap };

    const historyImageCount = countImageParts(history);
    const remainingCurrentImageSlots = Math.max(
      maxImageCount - historyImageCount,
      0
    );

    const currentMessageContent: GeminiMessage['content'] = [
      { type: 'text', text: sanitizedContent },
    ];

    if (supportsImageInput && attachments.length > 0 && remainingCurrentImageSlots > 0) {
      const imageParts = await buildImagePartsFromAttachmentInputs(
        attachments,
        remainingCurrentImageSlots
      );
      currentMessageContent.push(...imageParts);
    }

    // Combine into full message list
    const geminiMessages: GeminiMessage[] = [];

    // 如果有系统提示词，插入到开头
    if (systemPrompt) {
      geminiMessages.push({
        role: 'system',
        content: [{ type: 'text', text: systemPrompt }],
      });
    }

    // 添加历史消息和当前消息
    geminiMessages.push(...history, {
      role: 'user',
      content: currentMessageContent,
    });

    let fullContent = '';

    // Call API using unified client, passing temporaryModel
    await defaultGeminiClient.sendChat(
      geminiMessages,
      (accumulatedContent) => {
        if (signal.aborted) return;
        // accumulatedContent 已经是累积的完整内容，直接替换 URL 并使用
        const restoredContent = restoreMediaUrls(accumulatedContent, allUrlMap);
        fullContent = restoredContent;
        onStream({ type: 'content', content: restoredContent });
      },
      signal,
      temporaryModel || undefined // 传递临时模型
    );

    if (signal.aborted) {
      throw new Error('Request cancelled');
    }

    // Track success
    const duration = Date.now() - startTime;
    analytics.trackModelSuccess({
      taskId,
      taskType: 'chat',
      model: modelName,
      duration,
      resultSize: fullContent.length,
    });

    onStream({ type: 'done' });
    currentAbortController = null;
    return fullContent;
  } catch (error: any) {
    currentAbortController = null;
    const duration = Date.now() - startTime;

    if (
      signal.aborted ||
      error.message === 'Request cancelled' ||
      error.name === 'AbortError'
    ) {
      analytics.trackTaskCancellation({
        taskId,
        taskType: 'chat',
        duration,
      });
      onStream({ type: 'done' });
      throw new Error('Request cancelled');
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    analytics.trackModelFailure({
      taskId,
      taskType: 'chat',
      model: modelName,
      duration,
      error: errorMessage,
    });

    onStream({ type: 'error', error: errorMessage });
    throw error;
  }
}

/** Stop current generation */
export function stopGeneration(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

/** Check if generation is in progress */
export function isGenerating(): boolean {
  return currentAbortController !== null;
}

// Export as service object
export const chatService = {
  sendChatMessage,
  stopGeneration,
  isGenerating,
};
