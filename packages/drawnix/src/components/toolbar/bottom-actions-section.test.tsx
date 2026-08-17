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

vi.mock('../task-pet/TaskPetCompanion', () => ({
  TaskPetCompanion: () => <button data-testid="toolbar-task-pet" />,
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
    showTaskPet = false
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
          showLocalDataClear={showLocalDataClear}
          taskPet={
            showTaskPet
              ? {
                  state: 'idle',
                  message: null,
                  activeCount: 0,
                  motionEnabled: true,
                }
              : null
          }
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
    expect(container.querySelectorAll('button[data-testid]')).toHaveLength(5);
    expect(container.querySelectorAll('button[data-testid]').item(4)).toBe(
      button
    );
  });

  it('hides the local data clear button when desktop entry is disabled', async () => {
    await renderSection(false);

    expect(
      container.querySelector('[data-testid="toolbar-clear-local-data"]')
    ).toBeNull();
  });

  it('renders the task pet immediately before the local data clear button', async () => {
    await renderSection(true, true);

    const petButton = container.querySelector(
      '[data-testid="toolbar-task-pet"]'
    );
    const clearButton = container.querySelector(
      '[data-testid="toolbar-clear-local-data"]'
    );

    expect(petButton).not.toBeNull();
    expect(
      petButton?.compareDocumentPosition(clearButton as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
