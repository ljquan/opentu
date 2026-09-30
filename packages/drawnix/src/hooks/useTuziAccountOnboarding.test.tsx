// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTuziAccountOnboarding } from './useTuziAccountOnboarding';
import type { TuziBridgeContext } from '../services/tuzi-postmessage-bridge';

const bridge = vi.hoisted(() => ({
  context: null as Pick<
    TuziBridgeContext,
    'status' | 'userId' | 'systemToken'
  > | null,
  request: vi.fn(),
}));
const syncProviders = vi.hoisted(() => vi.fn());
vi.mock('../services/tuzi-session-provider-sync', () => ({
  syncTuziSessionProviders: syncProviders,
}));
vi.mock('../services/tuzi-postmessage-bridge', () => ({
  getTuziBridgeContext: () => bridge.context,
  requestTuziParentContext: bridge.request,
  TUZI_BRIDGE_EVENT: 'opentu:tuzi-bridge-status',
}));
const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
const notify = () =>
  act(() => {
    window.dispatchEvent(new Event('opentu:tuzi-bridge-status'));
  });

describe('Tuzi account onboarding', () => {
  beforeEach(() => {
    bridge.context = null;
    bridge.request.mockReset().mockResolvedValue(null);
    syncProviders.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    cleanup();
    if (originalParent) Object.defineProperty(window, 'parent', originalParent);
  });

  it('opens settings for missing system token before settings are mounted', () => {
    const setState = vi.fn();
    renderHook(() => useTuziAccountOnboarding(setState));
    bridge.context = { status: 'need_system_token', userId: '10' };
    notify();
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls[0][0]({ openSettings: false, keep: 1 })).toEqual(
      { openSettings: true, keep: 1 }
    );
    notify();
    expect(setState).toHaveBeenCalledTimes(1);
    bridge.context = { status: 'need_system_token', userId: '11' };
    notify();
    expect(setState).toHaveBeenCalledTimes(2);
  });

  it('leaves standalone and ready accounts alone, and prompts if association is lost', () => {
    const setState = vi.fn();
    renderHook(() => useTuziAccountOnboarding(setState));
    notify();
    bridge.context = { status: 'ready', userId: '10' };
    notify();
    expect(setState).not.toHaveBeenCalled();
    bridge.context = { status: 'need_system_token', userId: '10' };
    notify();
    expect(setState).toHaveBeenCalledTimes(1);
  });

  it('ignores a late iframe handshake after unmount', async () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: {} });
    let resolve!: () => void;
    bridge.request.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      })
    );
    const setState = vi.fn();
    const { unmount } = renderHook(() => useTuziAccountOnboarding(setState));
    expect(bridge.request).toHaveBeenCalledOnce();
    unmount();
    bridge.context = { status: 'need_system_token', userId: '10' };
    await act(async () => resolve());
    expect(setState).not.toHaveBeenCalled();
  });

  it('restores saved groups when the iframe handshake becomes ready after startup', async () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: {} });
    renderHook(() => useTuziAccountOnboarding(vi.fn()));
    expect(syncProviders).not.toHaveBeenCalled();
    bridge.context = { status: 'ready', userId: '10', systemToken: 'system' };
    await act(async () => notify());
    expect(syncProviders).toHaveBeenCalled();
  });

  it('restores groups on remount and retries when returning to the page', async () => {
    bridge.context = { status: 'ready', userId: '10', systemToken: 'system' };
    const first = renderHook(() => useTuziAccountOnboarding(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(syncProviders).toHaveBeenCalledTimes(1);
    first.unmount();
    renderHook(() => useTuziAccountOnboarding(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(syncProviders).toHaveBeenCalledTimes(2);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(syncProviders).toHaveBeenCalledTimes(3);
  });
});
