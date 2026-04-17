import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeMusicAnalysis,
  normalizeMusicAnalysisData,
} from '../music-analysis-service';

vi.mock('../../utils/settings-manager', () => ({
  settingsManager: {
    waitForInitialization: vi.fn().mockResolvedValue(undefined),
  },
  resolveInvocationRoute: vi.fn().mockReturnValue({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    modelId: 'gemini-2.5-pro',
  }),
}));

vi.mock('../provider-routing', () => ({
  resolveInvocationPlanFromRoute: vi.fn().mockReturnValue({
    provider: {
      authType: 'bearer',
      providerType: 'custom',
      extraHeaders: undefined,
    },
    binding: {
      protocol: 'google.generateContent',
    },
  }),
}));

vi.mock('../../utils/gemini-api/auth', () => ({
  validateAndEnsureConfig: vi.fn(async (config) => config),
}));

const callGoogleGenerateContentRaw = vi.fn();

vi.mock('../../utils/gemini-api/apiCalls', () => ({
  callGoogleGenerateContentRaw: (...args: unknown[]) =>
    callGoogleGenerateContentRaw(...args),
}));

describe('music-analysis-service', () => {
  beforeEach(() => {
    callGoogleGenerateContentRaw.mockReset();
  });

  it('parses structured music analysis JSON from Gemini response', async () => {
    callGoogleGenerateContentRaw.mockResolvedValue({
      choices: [
        {
          message: {
            content: `前言说明
{
  "summary": "情绪逐步堆高，副歌很抓耳。",
  "language": "中文",
  "mood": "热血、激昂",
  "genreTags": ["edm pop", "female vocal"],
  "structure": ["Intro", "[Verse]", "Chorus"],
  "hook": "高能副歌",
  "lyricRewriteBrief": "保留高能副歌，强化开场记忆点。",
  "titleSuggestions": ["燃夜", "逆光冲刺", "火力全开"],
  "sunoTitle": "燃夜",
  "sunoStyleTags": ["edm pop", "female vocal", "uplifting"],
  "sunoLyricsDraft": "[Verse]\\n我们迎着风奔跑\\n[Chorus]\\n今夜彻底燃烧"
}
尾注`,
          },
        },
      ],
    });

    const result = await executeMusicAnalysis({
      audioData: 'ZmFrZQ==',
      mimeType: 'audio/mpeg',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      analysis: {
        language: '中文',
        mood: '热血、激昂',
        genreTags: ['edm pop', 'female vocal'],
        structure: ['[Intro]', '[Verse]', '[Chorus]'],
        hook: '高能副歌',
        sunoTitle: '燃夜',
        sunoStyleTags: ['edm pop', 'female vocal', 'uplifting'],
        sunoLyricsDraft: '[Verse]\n我们迎着风奔跑\n[Chorus]\n今夜彻底燃烧',
      },
    });
  });

  it('fails gracefully when Gemini response contains no valid JSON', async () => {
    callGoogleGenerateContentRaw.mockResolvedValue({
      choices: [{ message: { content: 'not-json-response' } }],
    });

    const result = await executeMusicAnalysis({
      audioData: 'ZmFrZQ==',
      mimeType: 'audio/mpeg',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('JSON');
  });

  it('normalizes legacy analysis payloads with missing array fields', () => {
    expect(
      normalizeMusicAnalysisData({
        summary: '老数据',
        structure: ['Verse', '[Chorus]'],
        titleSuggestions: undefined,
        sunoStyleTags: undefined,
      })
    ).toEqual({
      summary: '老数据',
      language: '',
      mood: '',
      genreTags: [],
      structure: ['[Verse]', '[Chorus]'],
      hook: undefined,
      lyricRewriteBrief: '',
      titleSuggestions: [],
      sunoTitle: '',
      sunoStyleTags: [],
      sunoLyricsDraft: '',
    });
  });
});
