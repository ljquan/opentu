// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomActionsSection } from './bottom-actions-section';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../hooks/useTaskQueue', () => ({
  useTaskQueue: () => ({
    activeTasks: [],
    completedTasks: [],
    failedTasks: [],
  }),
}));

vi.mock('../feedback-button/feedback-button', () => ({
  FeedbackButton: () => <button data-testid="toolbar-feedback" />,
}));

vi.mock('../tool-button', () => ({
  ToolButton: ({
    'data-testid': testId,
    'aria-label': ariaLabel,
    onClick,
  }: {
    'data-testid'?: string;
    'aria-label': string;
    onClick?: () => void;
  }) => (
    <button data-testid={testId} aria-label={ariaLabel} onClick={onClick} />
  ),
}));

vi.mock('../local-data-clear/LocalDataClearDialog', () => ({
  LocalDataClearDialog: () => null,
}));

describe('BottomActionsSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderSection(
    showLocalDataClear: boolean,
    onTaskPetSettingsOpen = vi.fn()
  ) {
    await act(async () => {
      root.render(
        <BottomActionsSection
          projectDrawerOpen={false}
          onProjectDrawerToggle={vi.fn()}
          toolboxDrawerOpen={false}
          onToolboxDrawerToggle={vi.fn()}
          taskPanelExpanded={false}
          onTaskPanelToggle={vi.fn()}
          onTaskPetSettingsOpen={onTaskPetSettingsOpen}
          showLocalDataClear={showLocalDataClear}
        />
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it('renders the local data clear button for desktop toolbar', async () => {
    await renderSection(true);

    const taskButton = container.querySelector('[data-testid="toolbar-tasks"]');
    const button = container.querySelector(
      '[data-testid="toolbar-clear-local-data"]'
    );
    expect(button?.getAttribute('aria-label')).toBe('清理网站数据');
    expect(
      taskButton?.compareDocumentPosition(button as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.querySelectorAll('button[data-testid]')).toHaveLength(6);
    expect(container.querySelectorAll('button[data-testid]').item(5)).toBe(
      button
    );
  });

  it('hides the local data clear button when desktop entry is disabled', async () => {
    await renderSection(false);

    expect(
      container.querySelector('[data-testid="toolbar-clear-local-data"]')
    ).toBeNull();
  });

  it('keeps the task pet settings entry immediately before local data clear', async () => {
    const onTaskPetSettingsOpen = vi.fn();
    await renderSection(true, onTaskPetSettingsOpen);

    const settingsButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="toolbar-task-pet-settings"]'
    );
    const clearButton = container.querySelector(
      '[data-testid="toolbar-clear-local-data"]'
    );

    expect(settingsButton?.getAttribute('aria-label')).toBe('任务灵宠设置');
    expect(
      settingsButton?.compareDocumentPosition(clearButton as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    act(() => settingsButton?.click());
    expect(onTaskPetSettingsOpen).toHaveBeenCalledOnce();
  });

  it('keeps the settings entry when desktop-only clear is hidden', async () => {
    await renderSection(false);

    expect(
      container.querySelector('[data-testid="toolbar-task-pet-settings"]')
    ).not.toBeNull();
  });
});
