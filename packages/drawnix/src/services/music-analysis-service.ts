import type { MCPResult } from '../mcp/types';
import {
  type ModelRef,
} from '../utils/settings-manager';
import { callGoogleGenerateContentWithLog } from '../utils/gemini-api/logged-calls';
import type { GeminiMessage } from '../utils/gemini-api/types';
import { buildGenerateContentConfig, extractJsonObjects } from './analysis-core';

export interface MusicAnalysisData {
  summary: string;
  language: string;
  mood: string;
  genreTags: string[];
  structure: string[];
  hook?: string;
  lyricRewriteBrief: string;
  titleSuggestions: string[];
  sunoTitle: string;
  sunoStyleTags: string[];
  sunoLyricsDraft: string;
}

export interface MusicAnalyzeParams {
  audioData?: string;
  mimeType?: string;
  prompt?: string;
  model?: string;
  modelRef?: ModelRef | null;
  taskLabel?: string;
  musicAnalyzerSource?: 'upload';
  musicAnalyzerSourceLabel?: string;
  musicAnalyzerSourceSnapshot?: Record<string, unknown>;
}

export const MAX_AUDIO_ANALYZE_FILE_SIZE = 20 * 1024 * 1024;

export const SUNO_METATAG_GUIDE = [
  'Suno 元标签规则（按官方 Using Metatags 说明整理，作为生成约束使用）：',
  '1. 将结构标签单独放在方括号中，例如 [Intro]、[Verse]、[Pre-Chorus]、[Chorus]、[Bridge]、[Outro]。',
  '2. 风格或演唱提示也使用方括号包裹，并独立成行，例如 [Female Vocal]、[Rap]、[Drop]、[Instrumental]、[Guitar Solo]。',
  '3. 标签只用于结构、编排、演唱方式、乐器或情绪提示，不要把完整句子伪装成标签。',
  '4. 正文歌词与标签分开写：标签单独一行，歌词正文正常换行。',
  '5. 标签保持简洁、英文优先、可复用，避免堆砌重复标签。',
  '6. 输出既要可读，也要可直接复制到 Suno 作为歌词输入。',
].join('\n');

export const DEFAULT_MUSIC_ANALYSIS_PROMPT = `请分析这段音频，并输出一个 JSON 对象。

你需要同时理解音乐情绪、结构、语言、适合的 Suno 风格标签与后续歌词改写方向。

${SUNO_METATAG_GUIDE}

输出字段要求：
- summary: 这段音频的核心特点摘要，2-4 句
- language: 主要语言，例如 中文、英文、日文
- mood: 情绪与氛围总结
- genreTags: 适合 Suno 的风格标签数组，元素为字符串，尽量精炼
- structure: 适合这首歌的结构标签数组，元素示例可包含 [Intro]、[Verse]、[Chorus]、[Bridge]、[Outro]
- hook: 最抓人的 hook 或记忆点，没有则给空字符串
- lyricRewriteBrief: 一段用于后续歌词改写的说明，描述应该保留什么、强化什么、规避什么
- titleSuggestions: 3-5 个歌名建议
- sunoTitle: 一个最适合直接用于 Suno 的歌曲标题
- sunoStyleTags: 一组最适合直接用于 Suno 的风格标签数组，元素为字符串
- sunoLyricsDraft: 一份可直接粘贴到 Suno 的歌词草稿，必须包含合适的结构标签，并且标签独立成行

输出要求：
1. 只返回合法 JSON，不要 markdown。
2. genreTags 与 structure 都必须是字符串数组。
3. structure 中的元素必须符合 Suno 可读的元标签格式，即单个标签用 [] 包裹。
4. sunoLyricsDraft 必须是接近最终可用版本，而不只是提纲。
5. 如果无法确定，也要给出最合理的推断，不要留空对象。`;

function normalizeStringArray(value: unknown, wrapMetaTags = false): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => {
      if (!wrapMetaTags) {
        return item;
      }

      if (item.startsWith('[') && item.endsWith(']')) {
        return item;
      }
      return `[${item.replace(/^\[|\]$/g, '').trim()}]`;
    });
}

export function normalizeMusicAnalysisData(raw: unknown): MusicAnalysisData {
  const data =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  return {
    summary: String(data.summary || '').trim(),
    language: String(data.language || '').trim(),
    mood: String(data.mood || '').trim(),
    genreTags: normalizeStringArray(data.genreTags),
    structure: normalizeStringArray(data.structure, true),
    hook: String(data.hook || '').trim() || undefined,
    lyricRewriteBrief: String(data.lyricRewriteBrief || '').trim(),
    titleSuggestions: normalizeStringArray(data.titleSuggestions),
    sunoTitle: String(data.sunoTitle || '').trim(),
    sunoStyleTags: normalizeStringArray(data.sunoStyleTags),
    sunoLyricsDraft: String(data.sunoLyricsDraft || '').trim(),
  };
}

export async function executeMusicAnalysis(
  params: MusicAnalyzeParams
): Promise<MCPResult> {
  const { audioData, mimeType, prompt, model, modelRef } = params;

  if (!audioData) {
    return {
      success: false,
      error: '需要提供 audioData',
      type: 'error',
    };
  }

  try {
    const analysisPrompt = prompt || DEFAULT_MUSIC_ANALYSIS_PROMPT;
    const messages: GeminiMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
          {
            type: 'inline_data',
            mimeType: mimeType || 'audio/mpeg',
            data: audioData,
          },
        ],
      },
    ];

    const config = await buildGenerateContentConfig(model, modelRef);
    const response = await callGoogleGenerateContentWithLog(
      config,
      messages,
      { stream: false },
      { taskType: 'audio', prompt: analysisPrompt }
    );

    const text = response.choices?.[0]?.message?.content;
    if (!text) {
      return { success: false, error: 'API 未返回有效响应', type: 'error' };
    }

    const jsonObjects = extractJsonObjects(text);
    if (jsonObjects.length === 0) {
      return { success: false, error: '响应中未找到有效 JSON', type: 'error' };
    }

    for (const jsonStr of jsonObjects) {
      try {
        const parsed = normalizeMusicAnalysisData(JSON.parse(jsonStr));
        if (
          parsed.summary ||
          parsed.genreTags.length > 0 ||
          parsed.titleSuggestions.length > 0 ||
          parsed.sunoTitle ||
          parsed.sunoLyricsDraft
        ) {
          return {
            success: true,
            data: { analysis: parsed },
            type: 'text',
          };
        }
      } catch {
        // noop
      }
    }

    return {
      success: false,
      error: '响应中未找到有效的分析数据',
      type: 'error',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '音频分析失败',
      type: 'error',
    };
  }
}
