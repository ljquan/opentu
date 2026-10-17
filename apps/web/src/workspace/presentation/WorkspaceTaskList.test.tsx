/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceTaskSummary } from '../domain/workspace-model';
import { safeTaskResultUrl, WorkspaceTaskList } from './WorkspaceTaskList';

afterEach(cleanup);

function completedTask(resultUrl: string): WorkspaceTaskSummary {
  return {
    id: 'task-1',
    type: 'image',
    status: 'completed',
    progress: 100,
    prompt: '测试',
    title: '测试结果',
    resultUrl,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('WorkspaceTaskList result links', () => {
  it('allows expected media result locations', () => {
    expect(safeTaskResultUrl('/__aitu_cache__/video/task.mp4')).toBe(
      '/__aitu_cache__/video/task.mp4'
    );
    expect(safeTaskResultUrl('https://cdn.example.com/result.png')).toBe(
      'https://cdn.example.com/result.png'
    );
    expect(safeTaskResultUrl('blob:http://localhost/result')).toBe(
      'blob:http://localhost/result'
    );
  });

  it('rejects executable, credential-bearing, and active data URLs', () => {
    expect(safeTaskResultUrl('javascript:alert(1)')).toBeNull();
    expect(safeTaskResultUrl('https://user:secret@example.com/result')).toBeNull();
    expect(safeTaskResultUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeTaskResultUrl('data:image/svg+xml,<svg onload="alert(1)"/>')).toBeNull();
  });

  it('shows a non-clickable failure state for an unsafe result URL', () => {
    render(
      <WorkspaceTaskList
        tasks={[completedTask('javascript:alert(1)')]}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.queryByRole('link', { name: '查看结果' })).toBeNull();
    expect(screen.getByText('结果地址不可用')).toBeTruthy();
  });
});
