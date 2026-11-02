import type { Task } from '../types/task.types';

export interface TaskQueueFilters {
  searchText?: string;
  /** Inclusive start of the creation-date range. */
  createdAtFrom?: number;
  /** Exclusive end of the creation-date range. */
  createdAtTo?: number;
}

export type TaskDateRange = [] | [string, string];

function localDay(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
    return date;
  return undefined;
}

export function buildTaskQueueFilters(
  searchText: string,
  dateRange: TaskDateRange
): TaskQueueFilters {
  const start = localDay(dateRange[0]);
  const end = localDay(dateRange[1]);
  // Use the next local midnight, including days affected by daylight saving.
  if (end) end.setDate(end.getDate() + 1);
  return {
    searchText: searchText.trim(),
    createdAtFrom: start?.getTime(),
    createdAtTo: end?.getTime(),
  };
}

/** Keep current and archived task searches consistent. */
export function matchesTaskQueueFilters(
  task: Task,
  filters: TaskQueueFilters
): boolean {
  if (
    (filters.createdAtFrom !== undefined &&
      task.createdAt < filters.createdAtFrom) ||
    (filters.createdAtTo !== undefined && task.createdAt >= filters.createdAtTo)
  )
    return false;
  const query = filters.searchText?.trim().toLowerCase();
  if (!query) return true;
  return [
    task.params.prompt,
    task.result?.title,
    task.result?.lyricsTitle,
    task.result?.lyricsText,
    task.result?.chatResponse,
    ...(task.result?.lyricsTags || []),
  ].some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(query)
  );
}
