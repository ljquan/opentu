import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabSync } from '../useTabSync';

const syncKey = 'aitu-tab-sync-version';

function notify(version: number, boardId = 'board-a') {
  localStorage.setItem(
    syncKey,
    JSON.stringify({ version, boardId, tabId: 'another-tab' })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  notify(1);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTabSync acknowledgement', () => {
  it('retries a busy notification until it is acknowledged', async () => {
    const onSyncNeeded = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    renderHook(() => useTabSync({ onSyncNeeded, currentBoardId: 'board-a' }));

    notify(2);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onSyncNeeded).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onSyncNeeded).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onSyncNeeded).toHaveBeenCalledTimes(2);
  });

  it('does not consume a newer version while an earlier sync is in flight', async () => {
    let finish!: (value: boolean) => void;
    const onSyncNeeded = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(true);
    renderHook(() => useTabSync({ onSyncNeeded, currentBoardId: 'board-a' }));

    notify(2);
    await act(() => vi.advanceTimersByTimeAsync(500));
    notify(3);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onSyncNeeded).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(true);
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onSyncNeeded).toHaveBeenCalledTimes(2);
  });

  it('keeps legacy void callbacks acknowledged and filters other boards', async () => {
    const onSyncNeeded = vi.fn();
    renderHook(() => useTabSync({ onSyncNeeded, currentBoardId: 'board-a' }));

    notify(2, 'board-b');
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onSyncNeeded).not.toHaveBeenCalled();
    notify(3);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onSyncNeeded).toHaveBeenCalledTimes(1);
  });

  it('retries rejected callbacks without an unhandled rejection', async () => {
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const onSyncNeeded = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(true);
    renderHook(() => useTabSync({ onSyncNeeded, currentBoardId: 'board-a' }));

    notify(2);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onSyncNeeded).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it('does not let an obsolete callback acknowledge a notification still deferred by its replacement', async () => {
    let finish!: (value: boolean) => void;
    const previous = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    const replacement = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { rerender } = renderHook(
      ({ onSyncNeeded }) =>
        useTabSync({ onSyncNeeded, currentBoardId: 'board-a' }),
      { initialProps: { onSyncNeeded: previous } }
    );
    notify(2);
    await act(() => vi.advanceTimersByTimeAsync(500));
    rerender({ onSyncNeeded: replacement });
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(async () => {
      finish(true);
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(replacement).toHaveBeenCalledTimes(2);
  });

  it('stops retries after unmount', async () => {
    const onSyncNeeded = vi.fn().mockResolvedValue(false);
    const { unmount } = renderHook(() =>
      useTabSync({ onSyncNeeded, currentBoardId: 'board-a' })
    );
    notify(2);
    await act(() => vi.advanceTimersByTimeAsync(500));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onSyncNeeded).toHaveBeenCalledTimes(1);
  });
});
