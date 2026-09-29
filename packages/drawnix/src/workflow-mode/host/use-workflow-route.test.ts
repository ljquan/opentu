// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useWorkflowRoute } from './use-workflow-route';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('workflow route', () => {
  it('opens directly at /workflow', () => {
    window.history.replaceState(null, '', '/workflow');
    const { result } = renderHook(() => useWorkflowRoute('board-a'));
    expect(result.current.open).toBe(true);
    act(() => result.current.exit());
    expect(window.location.pathname + window.location.search).toBe('/?board=board-a');
  });

  it('uses a clean workflow URL and restores the board URL', () => {
    window.history.replaceState(null, '', '/?board=board-b');
    const { result } = renderHook(() => useWorkflowRoute('board-b'));
    act(() => result.current.enter());
    expect(window.location.pathname).toBe('/workflow');
    expect(window.location.search).toBe('');
    expect(result.current.open).toBe(true);
    act(() => result.current.exit());
    expect(window.location.search).toBe('?board=board-b');
    expect(result.current.open).toBe(false);
  });

  it('follows history navigation and keeps the saved return URL after remount', () => {
    window.history.replaceState({ workflowReturnUrl: '/?board=original' }, '', '/workflow');
    const { result } = renderHook(() => useWorkflowRoute('other'));
    act(() => result.current.exit());
    expect(window.location.search).toBe('?board=original');
    act(() => {
      window.history.replaceState(null, '', '/workflow');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.open).toBe(true);
  });
});
