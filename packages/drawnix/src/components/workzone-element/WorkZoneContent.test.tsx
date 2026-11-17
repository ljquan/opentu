import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WorkZoneContent } from './WorkZoneContent';
import type { WorkflowMessageData } from '../../types/chat.types';

vi.mock('../dialog/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));

const workflow: WorkflowMessageData = {
  id: 'workflow-1',
  name: '生成 PPT 大纲',
  generationType: 'text',
  prompt: '生成 PPT 大纲',
  count: 1,
  status: 'completed',
  createdAt: Date.now(),
  steps: [
    {
      id: 'step-1',
      description: '执行 generate_ppt',
      status: 'completed',
      mcp: 'generate_ppt',
      args: {},
    },
  ],
};

describe('WorkZoneContent actions', () => {
  it.each(['failed', 'cancelled'] as const)(
    'restores editing from %s without starting a canvas drag',
    (status) => {
      const onRestoreDraft = vi.fn();
      const onPointerDown = vi.fn();
      render(
        <div onPointerDown={onPointerDown}>
          <WorkZoneContent
            workflow={{ ...workflow, status }}
            onRestoreDraft={onRestoreDraft}
          />
        </div>
      );
      const button = screen.getByRole('button', { name: '恢复编辑' });
      fireEvent.pointerDown(button);
      expect(onPointerDown).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(onRestoreDraft).toHaveBeenCalledTimes(1);
    }
  );

  it('runs delete from click instead of pointerup', () => {
    const onDelete = vi.fn();
    render(<WorkZoneContent workflow={workflow} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: '删除' });
    fireEvent.pointerUp(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('stops pointerdown before canvas handlers can start dragging', () => {
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <WorkZoneContent workflow={workflow} onDelete={vi.fn()} />
      </div>
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: '删除' }));
    expect(onPointerDown).not.toHaveBeenCalled();
  });
});
