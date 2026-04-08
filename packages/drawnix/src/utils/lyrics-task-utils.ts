import { Task, TaskResult, TaskType } from '../types/task.types';

function trimString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isLyricsResult(
  result?: Pick<TaskResult, 'resultKind' | 'format' | 'lyricsText' | 'lyricsTitle'> | null
): boolean {
  if (!result) {
    return false;
  }

  return (
    result.resultKind === 'lyrics' ||
    result.format === 'lyrics' ||
    !!trimString(result.lyricsText) ||
    !!trimString(result.lyricsTitle)
  );
}

export function isLyricsTask(task?: Task | null): boolean {
  return !!task && task.type === TaskType.AUDIO && isLyricsResult(task.result);
}

export function getLyricsText(result?: TaskResult | null): string | undefined {
  return trimString(result?.lyricsText);
}

export function getLyricsTitle(
  result?: Pick<TaskResult, 'lyricsTitle' | 'title'> | null,
  fallback?: string
): string | undefined {
  return trimString(result?.lyricsTitle) || trimString(result?.title) || trimString(fallback);
}

export function getLyricsTags(
  result?: Pick<TaskResult, 'lyricsTags'> | null
): string[] {
  return Array.isArray(result?.lyricsTags)
    ? result.lyricsTags.filter((tag): tag is string => !!trimString(tag))
    : [];
}

export function getLyricsPreview(
  text?: string,
  maxLength = 140
): string | undefined {
  const normalized = trimString(text);
  if (!normalized) {
    return undefined;
  }

  const singleLine = normalized.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function formatLyricsForCanvas(task: Task): string {
  const title = getLyricsTitle(task.result, task.params.title || task.params.prompt);
  const tags = getLyricsTags(task.result);
  const text = getLyricsText(task.result);
  const lines = [
    title ? `# ${title}` : '# 歌词',
    tags.length > 0 ? `标签：${tags.join(' / ')}` : '',
    text || task.params.prompt,
  ].filter(Boolean);

  return lines.join('\n\n');
}
