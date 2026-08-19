// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TaskStatus, TaskType } from '../../types/task.types';
import {
  getPptExplainerModelLabel,
  getPptExplainerStageText,
  TaskProgressOverlay,
} from './TaskProgressOverlay';

describe('PPT explainer task display', () => {
  beforeAll(() => {
    class ResizeObserverStub {
      observe = () => undefined;
      disconnect = () => undefined;
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverStub,
    });
  });

  afterEach(cleanup);

  it.each([
    ['preparing', '正在生成PPT大纲'],
    ['review_pending', 'PPT大纲待确认'],
    ['snapshotting', '正在生成并固定PPT页面'],
    ['scripting', '正在生成逐页讲稿'],
    ['submitting', '正在生成逐页有声讲解'],
    ['polling', '正在生成逐页有声讲解'],
    ['finalizing', '正在合成PPT讲解视频'],
  ])('maps %s to its task stage text', (stage, expected) => {
    expect(getPptExplainerStageText(stage)).toBe(expected);
  });

  it('only exposes the selected video model while narration audio is generated', () => {
    expect(
      getPptExplainerModelLabel('preparing', 'Seedance 2.0 Fast')
    ).toBeUndefined();
    expect(
      getPptExplainerModelLabel('review_pending', 'Seedance 2.0 Fast')
    ).toBeUndefined();
    expect(
      getPptExplainerModelLabel('snapshotting', 'Seedance 2.0 Fast')
    ).toBeUndefined();
    expect(
      getPptExplainerModelLabel('scripting', 'Seedance 2.0 Fast')
    ).toBeUndefined();
    expect(getPptExplainerModelLabel('submitting', 'Seedance 2.0 Fast')).toBe(
      'Seedance 2.0 Fast'
    );
    expect(getPptExplainerModelLabel('polling', 'Seedance 2.0 Fast')).toBe(
      'Seedance 2.0 Fast'
    );
    expect(
      getPptExplainerModelLabel('finalizing', 'Seedance 2.0 Fast')
    ).toBeUndefined();
    expect(getPptExplainerModelLabel('submitting')).toBeUndefined();
  });

  it('keeps ordinary video tasks unchanged', () => {
    expect(getPptExplainerStageText(undefined)).toBeUndefined();
    expect(getPptExplainerModelLabel(undefined, 'Seedance 1.5 Pro')).toBe(
      'Seedance 1.5 Pro'
    );
  });

  it('renders the orchestration stage instead of generic video progress', () => {
    render(
      <TaskProgressOverlay
        taskType={TaskType.VIDEO}
        taskStatus={TaskStatus.PROCESSING}
        realProgress={20}
        pptExplainerStage="snapshotting"
      />
    );

    expect(screen.getByText('正在生成并固定PPT页面')).not.toBeNull();
    expect(screen.queryByText('生成中...')).toBeNull();
  });

  it('keeps the review-pending stage visible while the root task is pending', () => {
    render(
      <TaskProgressOverlay
        taskType={TaskType.VIDEO}
        taskStatus={TaskStatus.PENDING}
        realProgress={10}
        pptExplainerStage="review_pending"
      />
    );

    expect(screen.getByText('PPT大纲待确认')).not.toBeNull();
  });
});
