import { describe, expect, it, vi } from 'vitest';
import {
  AI_INPUT_FOCUS_EVENT,
  requestAIInputFocus,
  resolvePptExplainerFrameIds,
  updatePptExplainerFrameSelection,
} from './ai-input-ui-events';

describe('ai-input-ui-events', () => {
  it('dispatches focus request detail', () => {
    const handler = vi.fn();
    window.addEventListener(AI_INPUT_FOCUS_EVENT, handler);

    requestAIInputFocus({
      generationType: 'agent',
      skillId: 'generate_ppt',
      pptExplainerSource: 'current_ppt',
      pptExplainerFrameIds: ['frame-2', 'frame-4'],
      openPptExplainer: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      detail: {
        generationType: 'agent',
        skillId: 'generate_ppt',
        pptExplainerSource: 'current_ppt',
        pptExplainerFrameIds: ['frame-2', 'frame-4'],
        openPptExplainer: true,
      },
    });

    window.removeEventListener(AI_INPUT_FOCUS_EVENT, handler);
  });

  it('resolves selected pages in PPT order and falls back to all when empty', () => {
    expect(
      resolvePptExplainerFrameIds(
        ['frame-1', 'frame-2', 'frame-3'],
        new Set(['frame-3', 'frame-1'])
      )
    ).toEqual(['frame-1', 'frame-3']);
    expect(
      resolvePptExplainerFrameIds(
        ['frame-1', 'frame-2'],
        new Set(['not-a-ppt-frame'])
      )
    ).toBeUndefined();
  });

  it('updates the checked PPT explainer references without mutating selection', () => {
    const current = new Set(['frame-1', 'frame-2']);

    expect(updatePptExplainerFrameSelection(current, 'frame-3', true)).toEqual(
      new Set(['frame-1', 'frame-2', 'frame-3'])
    );
    expect(updatePptExplainerFrameSelection(current, 'frame-1', false)).toEqual(
      new Set(['frame-2'])
    );
    expect(current).toEqual(new Set(['frame-1', 'frame-2']));
  });
});
