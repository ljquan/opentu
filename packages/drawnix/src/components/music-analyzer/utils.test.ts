import { describe, expect, it } from 'vitest';
import {
  buildLyricsRewritePrompt,
  collectLyricsDraftModels,
  isSunoLyricsModel,
  parseLyricsRewriteResult,
} from './utils';

describe('music-analyzer utils', () => {
  it('embeds Suno metatag guidance in rewrite prompts', () => {
    const prompt = buildLyricsRewritePrompt({
      analysis: {
        summary: '副歌抓耳',
        language: '中文',
        mood: '热血',
        genreTags: ['edm'],
        structure: ['[Intro]', '[Chorus]'],
        hook: '副歌上扬',
        lyricRewriteBrief: '强化副歌',
        titleSuggestions: ['燃夜'],
      },
      userPrompt: '改成更适合短视频传播的版本',
    });

    expect(prompt).toContain('Suno 元标签规则');
    expect(prompt).toContain('[Intro]');
    expect(prompt).toContain('只返回合法 JSON');
  });

  it('builds Suno-ready create prompts for text lyric drafting', () => {
    const prompt = buildLyricsRewritePrompt({
      userPrompt: '写一首适合夏夜海边的中文女声流行歌',
      mode: 'create',
    });

    expect(prompt).toContain('用户创作要求');
    expect(prompt).toContain('直接用于 Suno 音乐生成');
    expect(prompt).toContain('title: 适合歌曲发布与生成的标题');
    expect(prompt).toContain('主动补全合理的歌曲结构');
  });

  it('includes the first-step creation prompt in rewrite context', () => {
    const prompt = buildLyricsRewritePrompt({
      userPrompt: '保留情绪核心，但副歌更抓耳',
      originalPrompt: '写一首关于深夜城市奔跑感的热血流行歌',
      currentLyrics: '[Verse]\n霓虹在背后流动',
    });

    expect(prompt).toContain('第一步创作提示词');
    expect(prompt).toContain('深夜城市奔跑感');
    expect(prompt).toContain('当前已有歌词草稿');
  });

  it('extracts lyrics rewrite payload from JSON text', () => {
    const result = parseLyricsRewriteResult(`说明文字
{
  "title": "燃夜",
  "styleTags": ["edm pop", "female vocal"],
  "lyricsDraft": "[Verse]\\n我们迎着光奔跑"
}
后缀`);

    expect(result).toEqual({
      title: '燃夜',
      styleTags: ['edm pop', 'female vocal'],
      lyricsDraft: '[Verse]\n我们迎着光奔跑',
    });
  });

  it('merges text models and Suno models without duplicates', () => {
    const models = collectLyricsDraftModels(
      [
        { id: 'gemini-2.5-pro', selectionKey: 'text:g2p' } as any,
        { id: 'gpt-4.1-mini', selectionKey: 'text:gpt' } as any,
      ],
      [
        { id: 'suno_lyric', selectionKey: 'audio:suno-lyric' } as any,
        { id: 'suno_lyric', selectionKey: 'audio:suno-lyric' } as any,
        { id: 'suno-music', selectionKey: 'audio:suno-music' } as any,
      ]
    );

    expect(models.map((item) => item.id)).toEqual([
      'gemini-2.5-pro',
      'gpt-4.1-mini',
      'suno_lyric',
      'suno-music',
    ]);
  });

  it('detects Suno lyric models', () => {
    expect(isSunoLyricsModel('suno_lyric')).toBe(true);
    expect(isSunoLyricsModel('gemini-2.5-pro')).toBe(false);
  });
});
