// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskPetCompanion } from './TaskPetCompanion';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('TaskPetCompanion', () => {
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

  it('announces status and opens the task queue from the bubble', () => {
    const onOpenTasks = vi.fn();

    act(() => {
      root.render(
        <TaskPetCompanion
          state="running"
          message="2 个任务正在处理"
          activeCount={2}
          motionEnabled={true}
          onOpenTasks={onOpenTasks}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="toolbar-task-pet"]'
    );
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.task-pet__message')?.textContent).toBe(
      '2 个任务正在处理'
    );
    expect(container.querySelector('.task-pet__count')?.textContent).toBe('2');
    expect(container.querySelector('.task-pet--motion')).not.toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('.task-pet__tasks-button')
        ?.click();
    });

    expect(onOpenTasks).toHaveBeenCalledOnce();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles an idle status bubble without enabling motion', () => {
    act(() => {
      root.render(
        <TaskPetCompanion
          state="idle"
          message={null}
          activeCount={0}
          motionEnabled={false}
          onOpenTasks={vi.fn()}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="toolbar-task-pet"]'
    );
    expect(container.querySelector('.task-pet--motion')).toBeNull();
    expect(container.querySelector('.task-pet__bubble')).toBeNull();

    act(() => trigger?.click());

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.task-pet__message')?.textContent).toBe(
      '灵宠待命'
    );
  });
});
