/**
 * 知识提取服务
 * 调用 AI（sendChatWithGemini）从正文中提取知识点
 */

import type {
  ExtractedKnowledge,
  KnowledgeExtractionResult,
  KnowledgeType,
} from './types';
import {
  EXTRACTION_SYSTEM_PROMPT,
  generateExtractionPrompt,
  parseExtractionResponse,
} from './prompt-template';
import { sendChatWithGemini } from '../../utils/gemini-api/services';
import type { GeminiMessage } from '../../utils/gemini-api/types';
import type { ModelRef } from '../../utils/settings-manager';

function generateId(): string {
  return `kp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 提取知识点（非流式）
 */
export async function extractKnowledge(
  content: string,
  options?: {
    title?: string;
    sourceUrl?: string;
    model?: string | ModelRef | null;
  }
): Promise<KnowledgeExtractionResult> {
  const { title, sourceUrl, model } = options || {};

  const messages: GeminiMessage[] = [
    {
      role: 'system',
      content: [{ type: 'text', text: EXTRACTION_SYSTEM_PROMPT }],
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: generateExtractionPrompt(content, title) },
      ],
    },
  ];

  const response = await sendChatWithGemini(
    messages,
    undefined,
    undefined,
    model
  );
  const responseText = response.choices?.[0]?.message?.content || '';

  const parsed = parseExtractionResponse(responseText);
  if (!parsed || parsed.knowledgePoints.length === 0) {
    throw new Error('无法从内容中提取知识点，请确保内容包含有价值的信息');
  }

  const knowledgePoints: ExtractedKnowledge[] = parsed.knowledgePoints.map(
    (p) => ({
      id: generateId(),
      title: p.title,
      content: p.content,
      sourceContext: p.sourceContext,
      tags: p.tags,
      type: p.type as KnowledgeType,
      selected: true,
    })
  );

  return {
    knowledgePoints,
    rawResponse: responseText,
    sourceUrl,
    sourceTitle: title,
    extractedAt: Date.now(),
  };
}

/**
 * 流式对话提取知识点
 */
export async function chatWithKnowledgeStream(
  history: GeminiMessage[],
  options: {
    model?: string | ModelRef | null;
    onProgress?: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<string> {
  const { model, onProgress, signal } = options;

  const response = await sendChatWithGemini(
    history,
    (accumulatedContent) => onProgress?.(accumulatedContent),
    signal,
    model
  );

  return response.choices?.[0]?.message?.content || '';
}

/**
 * 流式提取知识点
 */
export async function extractKnowledgeStream(
  content: string,
  options: {
    title?: string;
    sourceUrl?: string;
    model?: string | ModelRef | null;
    onProgress?: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<KnowledgeExtractionResult> {
  const { title, sourceUrl, model, onProgress, signal } = options;

  const messages: GeminiMessage[] = [
    {
      role: 'system',
      content: [{ type: 'text', text: EXTRACTION_SYSTEM_PROMPT }],
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: generateExtractionPrompt(content, title) },
      ],
    },
  ];

  const response = await sendChatWithGemini(
    messages,
    (accumulatedContent) => onProgress?.(accumulatedContent),
    signal,
    model
  );
  const responseText = response.choices?.[0]?.message?.content || '';

  const parsed = parseExtractionResponse(responseText);
  if (!parsed || parsed.knowledgePoints.length === 0) {
    throw new Error('无法从内容中提取知识点，请确保内容包含有价值的信息');
  }

  const knowledgePoints: ExtractedKnowledge[] = parsed.knowledgePoints.map(
    (p) => ({
      id: generateId(),
      title: p.title,
      content: p.content,
      sourceContext: p.sourceContext,
      tags: p.tags,
      type: p.type as KnowledgeType,
      selected: true,
    })
  );

  return {
    knowledgePoints,
    rawResponse: responseText,
    sourceUrl,
    sourceTitle: title,
    extractedAt: Date.now(),
  };
}
