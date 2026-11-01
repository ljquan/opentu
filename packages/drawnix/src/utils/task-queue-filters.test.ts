import { describe, expect, it } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../types/task.types';
import {
  buildTaskQueueFilters,
  matchesTaskQueueFilters,
} from './task-queue-filters';

function task(createdAt: number, prompt = '秋日森林'): Task {
  return {
    id: 'test',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: { prompt },
    createdAt,
    updatedAt: createdAt,
  };
}

describe('task queue date and text filters', () => {
  it('includes both selected local dates and excludes the following midnight', () => {
    const filters = buildTaskQueueFilters('', ['2026-08-01', '2026-08-03']);
    const start = new Date(2026, 7, 1).getTime();
    const end = new Date(2026, 7, 4).getTime();
    expect(filters).toMatchObject({ createdAtFrom: start, createdAtTo: end });
    expect(matchesTaskQueueFilters(task(start - 1), filters)).toBe(false);
    expect(matchesTaskQueueFilters(task(start), filters)).toBe(true);
    expect(matchesTaskQueueFilters(task(end - 1), filters)).toBe(true);
    expect(matchesTaskQueueFilters(task(end), filters)).toBe(false);
  });

  it('supports a single day, including the local daylight-saving transition date', () => {
    const filters = buildTaskQueueFilters('', ['2026-11-01', '2026-11-01']);
    expect(filters.createdAtFrom).toBe(new Date(2026, 10, 1).getTime());
    expect(filters.createdAtTo).toBe(new Date(2026, 10, 2).getTime());
    expect(
      matchesTaskQueueFilters(
        task(new Date(2026, 10, 1, 23, 59, 59, 999).getTime()),
        filters
      )
    ).toBe(true);
  });

  it('combines keywords and dates, and clearing dates restores all dates', () => {
    const old = task(new Date(2026, 6, 1).getTime(), 'Autumn forest');
    const filters = buildTaskQueueFilters('  AUTUMN  ', [
      '2026-08-01',
      '2026-08-03',
    ]);
    expect(matchesTaskQueueFilters(old, filters)).toBe(false);
    expect(
      matchesTaskQueueFilters(old, buildTaskQueueFilters('  AUTUMN  ', []))
    ).toBe(true);
    expect(
      matchesTaskQueueFilters(task(new Date(2026, 7, 2).getTime()), filters)
    ).toBe(false);
    expect(matchesTaskQueueFilters(old, buildTaskQueueFilters('', []))).toBe(
      true
    );
  });

  it('keeps the existing content search fields available', () => {
    const current = task(1);
    current.result = {
      url: '/result',
      format: 'txt',
      size: 0,
      title: '月光',
      lyricsTitle: '星河',
      lyricsText: '夜空',
      chatResponse: '繁星',
      lyricsTags: ['舒缓'],
    };
    for (const query of ['秋日', '月光', '星河', '夜空', '繁星', '舒缓']) {
      expect(matchesTaskQueueFilters(current, { searchText: query })).toBe(
        true
      );
    }
    expect(matchesTaskQueueFilters(current, { searchText: '不存在' })).toBe(
      false
    );
  });

  it('supports either date boundary while dates are being selected', () => {
    expect(buildTaskQueueFilters('', ['2026-08-01', ''])).toMatchObject({
      createdAtFrom: new Date(2026, 7, 1).getTime(),
      createdAtTo: undefined,
    });
    expect(buildTaskQueueFilters('', ['', '2026-08-03'])).toMatchObject({
      createdAtFrom: undefined,
      createdAtTo: new Date(2026, 7, 4).getTime(),
    });
  });

  it('does not silently roll an invalid calendar date into a different month', () => {
    for (const date of ['2026-02-30', '2026-13-01', 'invalid']) {
      expect(buildTaskQueueFilters('', [date, date])).toMatchObject({
        createdAtFrom: undefined,
        createdAtTo: undefined,
      });
    }
  });
});
