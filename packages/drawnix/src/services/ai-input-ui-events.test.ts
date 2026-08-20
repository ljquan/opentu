import { describe, expect, it, vi } from 'vitest';
import {
  AI_INPUT_FOCUS_EVENT,
  requestAIInputFocus,
} from './ai-input-ui-events';

describe('ai-input-ui-events', () => {
  it('dispatches focus request detail', () => {
    const handler = vi.fn();
    window.addEventListener(AI_INPUT_FOCUS_EVENT, handler);

    requestAIInputFocus({
      generationType: 'agent',
      skillId: 'generate_ppt',
      pptExplainerSource: 'current_ppt',
      openPptExplainer: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      detail: {
        generationType: 'agent',
        skillId: 'generate_ppt',
        pptExplainerSource: 'current_ppt',
        openPptExplainer: true,
      },
    });

    window.removeEventListener(AI_INPUT_FOCUS_EVENT, handler);
  });
});
