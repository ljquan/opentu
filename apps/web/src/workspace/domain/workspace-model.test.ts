import { describe, expect, it } from 'vitest';
import { createActivities, toTaskSummary } from './workspace-model';
import type { Task } from '@drawnix/drawnix/task-types';

describe('workspace projections', () => {
  it('normalizes task progress, title, and result preview', () => {
    const summary = toTaskSummary({
      id: 'task-1',
      type: 'image',
      status: 'processing',
      params: { prompt: '  product concept  ' },
      progress: 130,
      createdAt: 10,
      updatedAt: 20,
    } as Task);

    expect(summary.title).toBe('product concept');
    expect(summary.prompt).toBe('product concept');
    expect(summary.progress).toBe(100);
  });

  it('builds a bounded, newest-first activity feed', () => {
    const activities = createActivities(
      [
        {
          id: 'board-1',
          name: '画布',
          folderId: null,
          createdAt: 1,
          updatedAt: 12,
        },
      ],
      [
        {
          id: 'task-1',
          type: 'image',
          status: 'completed',
          progress: 100,
          prompt: '海报',
          title: '海报',
          createdAt: 2,
          updatedAt: 20,
        },
      ],
      30
    );

    expect(activities[0].id).toBe('task:task-1');
    expect(activities).toHaveLength(2);
  });
});
