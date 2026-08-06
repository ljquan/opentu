import { describe, expect, it } from 'vitest';
import {
  collectJsonObjects,
  extractJsonArray,
  extractJsonObject,
  extractJsonSource,
  extractJsonValue,
  normalizeLlmTextContent,
} from './llm-json-extractor';

describe('llm-json-extractor', () => {
  it('normalizes text content arrays from chat completion responses', () => {
    expect(
      normalizeLlmTextContent([
        { type: 'text', text: '{"title":"漫画"' },
        { type: 'text', text: ',"pages":[]}' },
      ])
    ).toBe('{"title":"漫画"\n,"pages":[]}');
  });

  it('skips mismatched JSON in think blocks with a predicate', () => {
    const result = extractJsonObject<{ shots: unknown[] }>(
      `<think>**Considering c** {"draft": true, "shots": "not array"}</think>
最终 JSON：
{
  "video_style": "原创卡通",
  "shots": []
}`,
      (value) => Array.isArray((value as { shots?: unknown }).shots)
    );

    expect(result.shots).toEqual([]);
  });

  it('extracts fenced JSON', () => {
    expect(extractJsonObject('```json\n{"ok":true}\n```')).toEqual({
      ok: true,
    });
  });

  it('extracts JSON wrapped by natural language', () => {
    expect(extractJsonObject('说明文字 {"title":"水滴"} 后缀')).toEqual({
      title: '水滴',
    });
  });

  it('uses predicate to select among multiple JSON candidates', () => {
    const result = extractJsonObject<{ pages: unknown[] }>(
      '{"draft":true}\n{"pages":[{"title":"p1"}]}',
      (value) => Array.isArray((value as { pages?: unknown }).pages)
    );

    expect(result.pages).toHaveLength(1);
  });

  it('extracts JSON from chat completion message content envelopes', () => {
    const result = extractJsonObject<{ shots: unknown[] }>(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                video_style: '原创卡通',
                shots: [{ id: 'shot_1' }],
              }),
            },
          },
        ],
      }),
      (value) => Array.isArray((value as { shots?: unknown }).shots)
    );

    expect(result.shots).toEqual([{ id: 'shot_1' }]);
  });

  it('extracts JSON from google generateContent candidate envelopes', () => {
    const result = extractJsonObject<{ pages: unknown[] }>(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: '深圳文旅',
                    pages: [{ title: '封面' }],
                  }),
                },
              ],
            },
          },
        ],
      }),
      (value) => Array.isArray((value as { pages?: unknown }).pages)
    );

    expect(result.pages).toEqual([{ title: '封面' }]);
  });

  it('extracts JSON from array message content envelopes', () => {
    const result = extractJsonObject<{ pages: unknown[] }>(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: '{"title":"深圳文旅","pages":[{"title":"封面"}]}',
                },
              ],
            },
          },
        ],
      }),
      (value) => Array.isArray((value as { pages?: unknown }).pages)
    );

    expect(result.pages).toEqual([{ title: '封面' }]);
  });

  it('keeps brackets inside JSON strings from breaking balance', () => {
    const result = extractJsonObject<{ text: string }>(
      'prefix {"text":"literal { brace } and [ bracket ]"} suffix'
    );

    expect(result.text).toBe('literal { brace } and [ bracket ]');
  });

  it('parses array contracts', () => {
    expect(extractJsonArray<{ id: string }>('[{"id":"shot_1"}]')).toEqual([
      { id: 'shot_1' },
    ]);
  });

  it('collects matching object candidates', () => {
    const objects = collectJsonObjects<{ id: string }>(
      '{"id":"a"} prose {"skip":true} {"id":"b"}',
      (value) => typeof (value as { id?: unknown }).id === 'string'
    );

    expect(objects.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('returns raw source for repair fallbacks when allowed', () => {
    expect(
      extractJsonSource('```json\n{title:"未引号"}\n```', {
        kinds: ['object'],
        allowInvalid: true,
      })
    ).toBe('{title:"未引号"}');
  });

  it('keeps truncated JSON as a failure', () => {
    expect(() =>
      extractJsonValue('前缀 {"title":"未完成"', {
        kinds: ['object'],
      })
    ).toThrow('响应中未找到有效 JSON');
  });
});
