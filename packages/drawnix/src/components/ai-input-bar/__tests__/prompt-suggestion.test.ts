import { describe, expect, it } from 'vitest';
import {
  formatPromptSuggestionPlaceholder,
  resolvePromptSuggestionAction,
} from '../prompt-suggestion';

describe('prompt suggestion', () => {
  it('空输入按空格或回车时只复用候选提示词', () => {
    expect(
      resolvePromptSuggestionAction({
        suggestion: '兔子',
        prompt: '',
        key: ' ',
        code: 'Space',
      })
    ).toBe('reuse');
    expect(
      resolvePromptSuggestionAction({
        suggestion: '兔子',
        prompt: '',
        key: 'Enter',
      })
    ).toBe('reuse');
  });

  it('直接输入、已有正文或其他按键都会丢弃候选', () => {
    expect(
      resolvePromptSuggestionAction({
        suggestion: '兔子',
        prompt: '',
        key: 'a',
      })
    ).toBe('dismiss');
    expect(
      resolvePromptSuggestionAction({
        suggestion: '兔子',
        prompt: '已有内容',
        key: 'Enter',
      })
    ).toBe('dismiss');
  });

  it('输入法组合期间不采纳候选', () => {
    expect(
      resolvePromptSuggestionAction({
        suggestion: '兔子',
        prompt: '',
        key: 'Enter',
        isComposing: true,
      })
    ).toBe('none');
  });

  it('提示文案明确说明空格和回车复用', () => {
    expect(formatPromptSuggestionPlaceholder('兔子', 'zh')).toBe(
      '按空格或回车复用提示词：兔子'
    );
  });
});
