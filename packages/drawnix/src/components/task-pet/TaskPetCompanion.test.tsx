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
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  const setViewport = (width: number, height: number) => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: width },
      innerHeight: { configurable: true, value: height },
    });
  };

  beforeEach(() => {
    setViewport(1024, 768);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setViewport(originalInnerWidth, originalInnerHeight);
  });

  const defaultPosition = { x: 0.9, y: 0.78 };
  const dispatchPointer = (
    target: EventTarget,
    type: string,
    clientX: number,
    clientY: number,
    pointerId = 1
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      button: { value: 0 },
      clientX: { value: clientX },
      clientY: { value: clientY },
      pointerId: { value: pointerId },
    });
    target.dispatchEvent(event);
  };

  it('announces status and opens the task queue from the bubble', () => {
    const onOpenTasks = vi.fn();

    act(() => {
      root.render(
        <TaskPetCompanion
          state="running"
          message="2 个任务正在处理"
          activeCount={2}
          motionEnabled={true}
          position={defaultPosition}
          onPositionCommit={vi.fn()}
          onOpenTasks={onOpenTasks}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-task-pet"]'
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
          position={defaultPosition}
          onPositionCommit={vi.fn()}
          onOpenTasks={vi.fn()}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-task-pet"]'
    );
    expect(container.querySelector('.task-pet--motion')).toBeNull();
    expect(container.querySelector('.task-pet__bubble')).toBeNull();

    act(() => trigger?.click());

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.task-pet__message')?.textContent).toBe(
      '灵宠待命'
    );
  });

  it('commits a clamped normalized position after dragging', () => {
    const onPositionCommit = vi.fn();

    act(() => {
      root.render(
        <TaskPetCompanion
          state="idle"
          message={null}
          activeCount={0}
          motionEnabled={true}
          position={defaultPosition}
          onPositionCommit={onPositionCommit}
          onOpenTasks={vi.fn()}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-task-pet"]'
    );
    act(() => {
      dispatchPointer(trigger as HTMLButtonElement, 'pointerdown', 900, 600);
      dispatchPointer(window, 'pointermove', 100, 100);
    });
    expect(container.querySelector('.task-pet--running-left')).not.toBeNull();

    act(() => {
      dispatchPointer(window, 'pointerup', 100, 100);
      trigger?.click();
    });

    expect(onPositionCommit).toHaveBeenCalledOnce();
    const committed = onPositionCommit.mock.calls[0][0];
    expect(committed.x).toBeGreaterThanOrEqual(0);
    expect(committed.x).toBeLessThanOrEqual(1);
    expect(committed.y).toBeGreaterThanOrEqual(0);
    expect(committed.y).toBeLessThanOrEqual(1);
    expect(container.querySelector('.task-pet--dragging')).toBeNull();
    expect(container.querySelector('.task-pet__bubble')).toBeNull();
  });

  it('ignores movement below the drag threshold', () => {
    const onPositionCommit = vi.fn();

    act(() => {
      root.render(
        <TaskPetCompanion
          state="idle"
          message={null}
          activeCount={0}
          motionEnabled={true}
          position={defaultPosition}
          onPositionCommit={onPositionCommit}
          onOpenTasks={vi.fn()}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-task-pet"]'
    );
    act(() => {
      dispatchPointer(trigger as HTMLButtonElement, 'pointerdown', 100, 100);
      dispatchPointer(window, 'pointermove', 103, 103);
      dispatchPointer(window, 'pointerup', 103, 103);
    });

    expect(onPositionCommit).not.toHaveBeenCalled();
    expect(container.querySelector('.task-pet--dragging')).toBeNull();
  });

  it('cleans up a cancelled drag without persisting it', () => {
    const onPositionCommit = vi.fn();

    act(() => {
      root.render(
        <TaskPetCompanion
          state="idle"
          message={null}
          activeCount={0}
          motionEnabled={true}
          position={defaultPosition}
          onPositionCommit={onPositionCommit}
          onOpenTasks={vi.fn()}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-task-pet"]'
    );
    act(() => {
      dispatchPointer(trigger as HTMLButtonElement, 'pointerdown', 800, 500);
      dispatchPointer(window, 'pointermove', 600, 400);
    });
    expect(container.querySelector('.task-pet--dragging')).not.toBeNull();

    act(() => {
      dispatchPointer(window, 'pointercancel', 600, 400);
    });

    expect(onPositionCommit).not.toHaveBeenCalled();
    expect(container.querySelector('.task-pet--dragging')).toBeNull();
  });

  it('keeps a drag bound to the pointer that started it', () => {
    const onPositionCommit = vi.fn();

    act(() => {
      root.render(
        <TaskPetCompanion
          state="idle"
          message={null}
          activeCount={0}
          motionEnabled={true}
          position={defaultPosition}
          onPositionCommit={onPositionCommit}
          onOpenTasks={vi.fn()}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-task-pet"]'
    );
    act(() => {
      dispatchPointer(trigger as HTMLButtonElement, 'pointerdown', 800, 500, 1);
      dispatchPointer(trigger as HTMLButtonElement, 'pointerdown', 300, 300, 2);
      dispatchPointer(window, 'pointermove', 100, 100, 2);
    });
    expect(container.querySelector('.task-pet--dragging')).toBeNull();

    act(() => {
      dispatchPointer(window, 'pointermove', 600, 400, 1);
      dispatchPointer(window, 'pointerup', 100, 100, 2);
    });
    expect(container.querySelector('.task-pet--dragging')).not.toBeNull();
    expect(onPositionCommit).not.toHaveBeenCalled();

    act(() => {
      dispatchPointer(window, 'pointerup', 600, 400, 1);
    });
    expect(container.querySelector('.task-pet--dragging')).toBeNull();
    expect(onPositionCommit).toHaveBeenCalledOnce();
  });

  it('restores the normalized position after viewport resizing', () => {
    act(() => {
      root.render(
        <TaskPetCompanion
          state="idle"
          message={null}
          activeCount={0}
          motionEnabled={true}
          position={{ x: 0.5, y: 0.5 }}
          onPositionCommit={vi.fn()}
          onOpenTasks={vi.fn()}
        />
      );
    });

    const pet = container.querySelector<HTMLElement>('[data-testid="task-pet"]');
    expect(pet?.style.left).toBe('456px');

    act(() => {
      setViewport(512, 768);
      window.dispatchEvent(new Event('resize'));
    });
    expect(pet?.style.left).toBe('200px');

    act(() => {
      setViewport(1024, 768);
      window.dispatchEvent(new Event('resize'));
    });
    expect(pet?.style.left).toBe('456px');
  });
});
