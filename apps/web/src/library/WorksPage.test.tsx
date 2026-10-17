/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorksPage } from './WorksPage';

vi.mock('../workspace/application/use-workspace-runtime', () => ({
  useWorkspaceRuntime: () => ({
    boards: [
      {
        id: 'board-1',
        name: '品牌探索',
        folderId: null,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
    ],
    tasks: [
      {
        id: 'task-1',
        type: 'image',
        status: 'completed',
        progress: 100,
        title: '春季主视觉',
        prompt: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  }),
}));

afterEach(cleanup);

describe('WorksPage', () => {
  it('renders runtime works and filters them by category', () => {
    const onOpenBoard = vi.fn().mockResolvedValue(undefined);
    render(
      <WorksPage
        onGoHome={vi.fn()}
        onGoCreativeCenter={vi.fn()}
        onOpenWorkflows={vi.fn()}
        onOpenBoard={onOpenBoard}
        onOpenAccount={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '我的作品' })).toBeTruthy();
    expect(screen.getByText('品牌探索')).toBeTruthy();
    expect(screen.getByText('春季主视觉')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '今天' })).toBeTruthy();

    fireEvent.click(screen.getByText('品牌探索'));
    expect(onOpenBoard).toHaveBeenCalledWith('board-1');

    fireEvent.click(screen.getByRole('tab', { name: '画布' }));
    expect(screen.getByText('品牌探索')).toBeTruthy();
    expect(screen.queryByText('春季主视觉')).toBeNull();
  });

  it('opens creation without passing the click event as an argument', () => {
    const openCreation = vi.fn();
    render(
      <WorksPage
        onGoHome={vi.fn()}
        onGoCreativeCenter={openCreation}
        onOpenWorkflows={vi.fn()}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onOpenAccount={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '新建创作' }));
    expect(openCreation).toHaveBeenCalledWith();
  });
});
