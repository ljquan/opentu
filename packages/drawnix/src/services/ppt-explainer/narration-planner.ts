import type { ModelRef } from '../../utils/settings-types';
import { defaultGeminiClient } from '../../utils/gemini-api';
import type { GeminiMessage } from '../../utils/gemini-api/types';
import { extractJsonObject } from '../../utils/llm-json-extractor';
import type {
  PptExplainerPresenterMode,
  PptExplainerSlide,
  PptExplainerSpeaker,
  PptExplainerTurn,
} from './types';
import {
  PptExplainerValidationError,
  validatePptExplainerSlides,
} from './validation';

const NARRATION_BATCH_SIZE = 8;

interface NarrationResponse {
  slides: Array<{
    pageIndex: number;
    turns: Array<{
      speakerId: string;
      text: string;
      estimatedDurationSeconds?: number;
    }>;
  }>;
}

function isDualMode(mode: PptExplainerPresenterMode): boolean {
  return mode === 'dual_voice' || mode === 'dual_avatar';
}

function parseNarrationResponse(
  response: string,
  expectedSlides: readonly PptExplainerSlide[],
  speakers: readonly PptExplainerSpeaker[]
): Map<number, PptExplainerTurn[]> {
  let parsed: NarrationResponse;
  try {
    parsed = extractJsonObject<NarrationResponse>(response, (value) => {
      const candidate = value as Partial<NarrationResponse>;
      return Array.isArray(candidate.slides);
    });
  } catch (error) {
    throw new PptExplainerValidationError(
      `讲稿模型未返回有效 JSON：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const expectedIndexes = new Set(
    expectedSlides.map((slide) => slide.pageIndex)
  );
  const speakerIds = new Set(speakers.map((speaker) => speaker.id));
  const result = new Map<number, PptExplainerTurn[]>();
  for (const item of parsed.slides) {
    if (
      !Number.isSafeInteger(item?.pageIndex) ||
      !expectedIndexes.has(item.pageIndex) ||
      result.has(item.pageIndex) ||
      !Array.isArray(item.turns) ||
      item.turns.length === 0
    ) {
      throw new PptExplainerValidationError('讲稿 JSON 的页面映射无效');
    }
    const turns = item.turns.map((turn) => {
      if (
        !turn ||
        typeof turn.speakerId !== 'string' ||
        !speakerIds.has(turn.speakerId) ||
        typeof turn.text !== 'string' ||
        !turn.text.trim()
      ) {
        throw new PptExplainerValidationError(
          `第 ${item.pageIndex} 页讲稿包含无效 speaker 或空文本`
        );
      }
      const estimatedDurationSeconds = turn.estimatedDurationSeconds;
      if (
        estimatedDurationSeconds !== undefined &&
        (!Number.isFinite(estimatedDurationSeconds) ||
          estimatedDurationSeconds < 0)
      ) {
        throw new PptExplainerValidationError(
          `第 ${item.pageIndex} 页讲稿时长估计无效`
        );
      }
      return {
        speakerId: turn.speakerId,
        text: turn.text.trim(),
        ...(estimatedDurationSeconds === undefined
          ? {}
          : { estimatedDurationSeconds }),
      };
    });
    result.set(item.pageIndex, turns);
  }

  if (result.size !== expectedSlides.length) {
    throw new PptExplainerValidationError('讲稿 JSON 缺少页面');
  }
  return result;
}

function buildNarrationMessages(
  slides: readonly PptExplainerSlide[],
  speakers: readonly PptExplainerSpeaker[],
  presenterMode: PptExplainerPresenterMode
): GeminiMessage[] {
  const dualMode = isDualMode(presenterMode);
  const systemPrompt = [
    '你是 PPT 讲解视频的讲稿编排器。',
    '只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。',
    '输出格式：{"slides":[{"pageIndex":1,"turns":[{"speakerId":"id","text":"...","estimatedDurationSeconds":30}]}]}。',
    '必须保留全部 pageIndex，speakerId 只能使用给定 ID，text 不能为空。',
    '已有 notes 是用户内容，必须作为讲稿主要依据；没有 notes 时根据标题补齐。',
    dualMode
      ? '这是双人对谈：每页使用两个 speaker 交替发言，保持自然问答和衔接。'
      : '这是单人讲解：所有 turns 使用唯一 speaker。',
    '不要因为发言较长而截断，也不要自行设置总时长上限。',
  ].join('\n');
  const payload = {
    presenterMode,
    speakers: speakers.map(({ id, displayName }) => ({ id, displayName })),
    slides: slides.map(({ pageIndex, title, notes }) => ({
      pageIndex,
      title,
      notes,
    })),
  };
  return [
    { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
    {
      role: 'user',
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    },
  ];
}

export interface BuildNarrationPlanOptions {
  presenterMode: PptExplainerPresenterMode;
  speakers: PptExplainerSpeaker[];
  textRoute: ModelRef | string;
  signal?: AbortSignal;
}

export async function buildPptExplainerNarrationPlan(
  sourceSlides: readonly PptExplainerSlide[],
  options: BuildNarrationPlanOptions
): Promise<PptExplainerSlide[]> {
  const dualMode = isDualMode(options.presenterMode);
  const result = sourceSlides.map((slide) => ({
    ...slide,
    turns: slide.turns.map((turn) => ({ ...turn })),
  }));
  if (!dualMode) {
    const speakerId = options.speakers[0]?.id;
    for (const slide of result) {
      if (slide.notes?.trim() && slide.turns.length === 0) {
        slide.turns = [{ speakerId, text: slide.notes.trim() }];
      }
    }
  }

  const needsGeneration = result.filter((slide) => slide.turns.length === 0);

  for (
    let offset = 0;
    offset < needsGeneration.length;
    offset += NARRATION_BATCH_SIZE
  ) {
    options.signal?.throwIfAborted();
    const batch = needsGeneration.slice(offset, offset + NARRATION_BATCH_SIZE);
    const response = await defaultGeminiClient.sendChat(
      buildNarrationMessages(batch, options.speakers, options.presenterMode),
      undefined,
      options.signal,
      options.textRoute
    );
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new PptExplainerValidationError('讲稿模型未返回内容');
    }
    const turnsByPage = parseNarrationResponse(
      content,
      batch,
      options.speakers
    );
    for (const slide of result) {
      const turns = turnsByPage.get(slide.pageIndex);
      if (turns) slide.turns = turns;
    }
  }

  validatePptExplainerSlides(result, options.speakers, {
    requireTurns: true,
  });
  return result;
}

export const narrationPlannerInternals = {
  parseNarrationResponse,
};
