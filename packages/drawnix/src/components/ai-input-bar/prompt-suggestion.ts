export type PromptSuggestionAction = 'reuse' | 'dismiss' | 'none';

export interface PromptSuggestionKeyInput {
  suggestion?: string | null;
  prompt?: string | null;
  key: string;
  code?: string;
  isComposing?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function resolvePromptSuggestionAction({
  suggestion,
  prompt,
  key,
  code,
  isComposing = false,
  shiftKey = false,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
}: PromptSuggestionKeyInput): PromptSuggestionAction {
  if (isComposing || !suggestion) {
    return 'none';
  }

  if (
    !prompt?.trim() &&
    !shiftKey &&
    !altKey &&
    !ctrlKey &&
    !metaKey &&
    (key === 'Enter' || key === ' ' || code === 'Space')
  ) {
    return 'reuse';
  }

  return 'dismiss';
}

export function formatPromptSuggestionPlaceholder(
  suggestion: string,
  language: 'zh' | 'en'
): string {
  return language === 'zh'
    ? `按空格或回车复用提示词：${suggestion}`
    : `Press Space or Enter to reuse: ${suggestion}`;
}
