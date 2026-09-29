// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowModeHost } from './WorkflowModeHost';

vi.mock('../web/src/WorkflowApp', () => ({
  WorkflowApp: ({ onOpenProviderSettings }: { onOpenProviderSettings?: (profileId?: string | null) => void }) => (
    <div id="opentu-workflow-root">
      <button onClick={() => onOpenProviderSettings?.('profile-a')}>编辑原生渠道</button>
      <button onClick={() => onOpenProviderSettings?.()}>添加原生渠道</button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('WorkflowModeHost', () => {
  it('renders the workflow in-process without an iframe', async () => {
    const exit = vi.fn();
    const view = render(<WorkflowModeHost open={false} onExit={exit} />);
    expect(document.getElementById('opentu-workflow-root')).toBeNull();
    view.rerender(<WorkflowModeHost open onExit={exit} />);
    await screen.findByRole('button', { name: '编辑原生渠道' });
    const root = document.getElementById('opentu-workflow-root');
    expect(root).not.toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: '打开文档' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回画布' }));
    expect(exit).toHaveBeenCalledOnce();
    view.rerender(<WorkflowModeHost open={false} onExit={exit} />);
    expect(document.getElementById('opentu-workflow-root')).toBeNull();
  });

  it('navigates in shared history and preserves the board return address', async () => {
    window.history.replaceState({ workflowReturnUrl: '/?board=original' }, '', '/workflow/canvas');
    render(<WorkflowModeHost open onExit={() => undefined} />);
    await screen.findByRole('button', { name: '编辑原生渠道' });
    expect(screen.getByRole('button', { name: '返回画布' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '视频创作台' }));
    expect(window.location.pathname).toBe('/workflow/video');
    expect(window.history.state.workflowReturnUrl).toBe('/?board=original');
    expect(screen.getByRole('button', { name: '视频创作台' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens provider settings directly with the selected profile or create action', async () => {
    const edit = vi.fn();
    render(<WorkflowModeHost open onExit={() => undefined} onOpenProviderSettings={edit} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑原生渠道' }));
    expect(edit).toHaveBeenLastCalledWith('profile-a');
    fireEvent.click(screen.getByRole('button', { name: '添加原生渠道' }));
    expect(edit).toHaveBeenLastCalledWith();
  });
});
