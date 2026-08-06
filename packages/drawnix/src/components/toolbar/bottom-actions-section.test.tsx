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

  function renderSection(showLocalDataClear: boolean) {
    act(() => {
      root.render(
        <BottomActionsSection
          projectDrawerOpen={false}
          onProjectDrawerToggle={vi.fn()}
          toolboxDrawerOpen={false}
          onToolboxDrawerToggle={vi.fn()}
          taskPanelExpanded={false}
          onTaskPanelToggle={vi.fn()}
          showLocalDataClear={showLocalDataClear}
        />
      );
    });
  }

  it('renders the local data clear button for desktop toolbar', () => {
    renderSection(true);

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

  it('hides the local data clear button when desktop entry is disabled', () => {
    renderSection(false);

    expect(
      container.querySelector('[data-testid="toolbar-clear-local-data"]')
    ).toBeNull();
  });
});
