import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, PlaitBoard } from '@plait/core';
import { AppToolbar } from './app-toolbar';
import { hasUnseenFeature } from '../../../utils/feature-discovery';

const mocks = vi.hoisted(() => ({ board: null as PlaitBoard | null }));
vi.mock('@plait-board/react-board', () => ({ useBoard: () => mocks.board }));
vi.mock('../../../i18n', () => ({
  useI18n: () => ({
    language: 'zh',
    t: (key: string) => (key === 'general.menu' ? '菜单' : key),
  }),
}));
vi.mock('../../../hooks/use-toolbar-config', () => ({
  useToolbarConfig: () => ({
    isButtonVisible: () => false,
    visibleButtons: [],
  }),
}));
vi.mock('../toolbar-context-menu', () => ({
  ToolbarContextMenu: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./language-switcher-menu', () => ({
  LanguageSwitcherMenu: () => null,
}));
vi.mock('./app-menu-items', () =>
  Object.fromEntries(
    [
      'CleanBoard',
      'OpenFile',
      'SaveAsImage',
      'SaveToFile',
      'Settings',
      'BackupRestore',
      'CloudSync',
      'DebugPanel',
      'QuickCommands',
      'UserManual',
      'VersionInfo',
      'CleanInvalidLinks',
    ].map((name) => [name, () => null])
  )
);

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  mocks.board = createBoard([]);
  vi.spyOn(PlaitBoard, 'getBoardContainer').mockReturnValue(document.body);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('application menu feature notification', () => {
  it('keeps the red dot until opening the menu, then stays dismissed after remount', () => {
    const view = render(<AppToolbar />);
    const button = screen.getByRole('button', { name: '菜单 (有新功能)' });
    expect(button.querySelector('.new-feature-dot')).toBeTruthy();
    view.rerender(<AppToolbar />);
    expect(hasUnseenFeature('app-menu')).toBe(true);
    fireEvent.pointerDown(button);
    fireEvent.click(button, { detail: 1 });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '菜单' })
        .querySelector('.new-feature-dot')
    ).toBeNull();
    expect(hasUnseenFeature('canvas-settings')).toBe(true);
    view.unmount();
    render(<AppToolbar />);
    expect(
      screen
        .getByRole('button', { name: '菜单' })
        .querySelector('.new-feature-dot')
    ).toBeNull();
  });

  it('acknowledges opening the menu by a keyboard-style click', async () => {
    render(<AppToolbar />);
    fireEvent.click(screen.getByRole('button', { name: '菜单 (有新功能)' }), {
      detail: 0,
    });
    await waitFor(() => expect(hasUnseenFeature('app-menu')).toBe(false));
    expect(
      screen
        .getByRole('button', { name: '菜单' })
        .querySelector('.new-feature-dot')
    ).toBeNull();
  });
});
