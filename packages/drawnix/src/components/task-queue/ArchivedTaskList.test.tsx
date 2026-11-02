import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { ArchivedTaskList } from './ArchivedTaskList';

const mocks = vi.hoisted(() => ({ getArchivedTasks: vi.fn() }));
vi.mock('../../services/task-storage-reader', () => ({
  taskStorageReader: mocks,
}));
// TaskItem starts media/cache integrations; keep these tests on history loading.
vi.mock('./TaskItem', () => ({
  TaskItem: ({
    task,
    onPreviewOpen,
  }: {
    task: Task;
    onPreviewOpen?: () => void;
  }) => <button onClick={onPreviewOpen}>{task.params.prompt}</button>,
}));

function task(id: string): Task {
  return {
    id,
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: { prompt: id },
    createdAt: 1,
    updatedAt: 1,
  };
}
function deferred() {
  let resolve!: (result: { tasks: Task[]; hasMore: boolean }) => void;
  const promise = new Promise<{ tasks: Task[]; hasMore: boolean }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => mocks.getArchivedTasks.mockReset());
afterEach(cleanup);

describe('archived task filtering and paging', () => {
  it('queries all history with the filters and pages using the matching offset', async () => {
    mocks.getArchivedTasks
      .mockResolvedValueOnce({
        tasks: Array.from({ length: 30 }, (_, i) => task(`old-${i}`)),
        hasMore: true,
      })
      .mockResolvedValueOnce({ tasks: [task('older')], hasMore: false });
    const onPreview = vi.fn();
    const filters = {
      searchText: 'forest',
      createdAtFrom: 10,
      createdAtTo: 20,
    };
    render(<ArchivedTaskList filters={filters} onPreviewOpen={onPreview} />);
    await screen.findByText('old-0');
    expect(mocks.getArchivedTasks).toHaveBeenCalledWith(0, 30, filters);
    fireEvent.click(screen.getByText('old-0'));
    expect(onPreview).toHaveBeenCalledWith('old-0');
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await screen.findByText('older');
    expect(mocks.getArchivedTasks).toHaveBeenLastCalledWith(30, 30, filters);
    expect(screen.queryByText('加载更多')).toBeNull();
  });

  it('discards a late initial query after the date range changes', async () => {
    const old = deferred();
    mocks.getArchivedTasks
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ tasks: [task('new-filter')], hasMore: false });
    const view = render(<ArchivedTaskList filters={{ createdAtFrom: 1 }} />);
    view.rerender(<ArchivedTaskList filters={{ createdAtFrom: 2 }} />);
    await screen.findByText('new-filter');
    await act(async () =>
      old.resolve({ tasks: [task('stale-filter')], hasMore: true })
    );
    expect(screen.queryByText('stale-filter')).toBeNull();
    expect(screen.getByText('new-filter')).not.toBeNull();
  });

  it('ignores old load-more responses and restarts at zero for the new filters', async () => {
    const oldPage = deferred();
    mocks.getArchivedTasks
      .mockResolvedValueOnce({ tasks: [task('old-first')], hasMore: true })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ tasks: [task('new-first')], hasMore: true })
      .mockResolvedValueOnce({ tasks: [task('new-second')], hasMore: false });
    const view = render(<ArchivedTaskList filters={{ searchText: 'old' }} />);
    await screen.findByText('old-first');
    fireEvent.click(screen.getByText('加载更多'));
    view.rerender(<ArchivedTaskList filters={{ searchText: 'new' }} />);
    await screen.findByText('new-first');
    await act(async () =>
      oldPage.resolve({ tasks: [task('stale-page')], hasMore: false })
    );
    expect(screen.queryByText('old-first')).toBeNull();
    expect(screen.queryByText('stale-page')).toBeNull();
    fireEvent.click(screen.getByText('加载更多'));
    await screen.findByText('new-second');
    expect(mocks.getArchivedTasks.mock.calls.map((call) => call[0])).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it('clears the range and search without keeping old offsets or an empty filtered message', async () => {
    mocks.getArchivedTasks
      .mockResolvedValueOnce({ tasks: [], hasMore: false })
      .mockResolvedValueOnce({ tasks: [task('unfiltered')], hasMore: false });
    const view = render(
      <ArchivedTaskList filters={{ createdAtTo: 10, searchText: 'missing' }} />
    );
    await screen.findByText('没有符合筛选条件的历史任务');
    view.rerender(<ArchivedTaskList filters={{}} />);
    await screen.findByText('unfiltered');
    expect(mocks.getArchivedTasks).toHaveBeenLastCalledWith(0, 30, {
      searchText: undefined,
      createdAtFrom: undefined,
      createdAtTo: undefined,
    });
  });

  it('shows a read error and retries instead of claiming there is no history', async () => {
    mocks.getArchivedTasks
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce({ tasks: [task('recovered')], hasMore: false });
    render(<ArchivedTaskList />);
    await screen.findByText('历史任务加载失败，请重试');
    expect(screen.queryByText('暂无历史任务')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByText('recovered');
  });

  it('retains matching records and the same offset when loading more fails', async () => {
    mocks.getArchivedTasks
      .mockResolvedValueOnce({ tasks: [task('first')], hasMore: true })
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce({ tasks: [task('second')], hasMore: false });
    render(<ArchivedTaskList />);
    await screen.findByText('first');
    fireEvent.click(screen.getByText('加载更多'));
    await screen.findByRole('alert');
    expect(screen.getByText('first')).not.toBeNull();
    fireEvent.click(screen.getByText('加载更多'));
    await screen.findByText('second');
    expect(mocks.getArchivedTasks.mock.calls.map((call) => call[0])).toEqual([
      0, 1, 1,
    ]);
  });

  it('does not start duplicate page reads on repeated scroll events', async () => {
    const page = deferred();
    mocks.getArchivedTasks
      .mockResolvedValueOnce({ tasks: [task('first')], hasMore: true })
      .mockReturnValueOnce(page.promise);
    render(<ArchivedTaskList />);
    const list = await screen.findByRole('region', { name: '历史任务列表' });
    fireEvent.scroll(list);
    fireEvent.scroll(list);
    await waitFor(() =>
      expect(mocks.getArchivedTasks).toHaveBeenCalledTimes(2)
    );
    await act(async () =>
      page.resolve({ tasks: [task('second')], hasMore: false })
    );
    expect(screen.getByText('second')).not.toBeNull();
  });
});
