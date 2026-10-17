/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    account: null as { id: string; username: string; role: number } | null,
    checking: false,
  },
}));

vi.mock('../account/use-account-session', () => ({
  useAccountSession: () => sessionState,
}));

afterEach(() => {
  cleanup();
  sessionState.account = null;
  sessionState.checking = false;
});

describe('HomePage', () => {
  it('shows a usable workspace home and starts a workspace from its entry points', async () => {
    const onStartCreating = vi.fn().mockResolvedValue(undefined);
    const onOpenMusicStation = vi.fn();

    render(
      <HomePage
        onStartCreating={onStartCreating}
        onOpenMusicStation={onOpenMusicStation}
      />
    );

    expect(
      screen.getByRole('heading', { name: /今天，想做点什么/ })
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: '模型广场' })).toBeTruthy();
    expect(await screen.findByText('GPT Image 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '从模板开始' })).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: '描述你的创作想法' })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /开始创作/ }));
    expect(onStartCreating).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '音乐台' }));
    expect(onOpenMusicStation).toHaveBeenCalledTimes(1);
  });

  it('starts a workspace when a template is selected', async () => {
    const onStartCreating = vi.fn().mockResolvedValue(undefined);

    render(<HomePage onStartCreating={onStartCreating} />);

    expect(await screen.findByText('GPT Image 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /产品主视觉/ }));
    expect(onStartCreating).toHaveBeenCalledTimes(1);
  });

  it('shows direct model configuration entries for administrators', async () => {
    sessionState.account = { id: 'admin-1', username: '管理员', role: 5 };
    const onOpenAdmin = vi.fn();

    render(
      <HomePage
        onStartCreating={vi.fn().mockResolvedValue(undefined)}
        onOpenAdmin={onOpenAdmin}
      />
    );

    expect(await screen.findByText('GPT Image 2')).toBeTruthy();
    const entries = screen.getAllByRole('button', { name: /模型配置/ });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(entries[0]);
    expect(onOpenAdmin).toHaveBeenCalledTimes(1);
  });
});
