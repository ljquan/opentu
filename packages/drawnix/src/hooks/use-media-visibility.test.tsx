import React, { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaVisibility } from './use-media-visibility';

let notify: IntersectionObserverCallback;
const disconnect = vi.fn();
function Probe({ pinned = false }: { pinned?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useMediaVisibility(ref, pinned);
  return <div ref={ref}>{visible ? 'loaded' : 'dormant'}</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('media visibility', () => {
  it('loads visible content and releases offscreen media after a delay', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
    const view = render(<Probe />);
    expect(screen.getByText('dormant')).toBeTruthy();
    act(() =>
      notify(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    expect(screen.getByText('loaded')).toBeTruthy();
    act(() =>
      notify(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    act(() => vi.advanceTimersByTime(1900));
    expect(screen.getByText('loaded')).toBeTruthy();
    act(() =>
      notify(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('loaded')).toBeTruthy();
    act(() =>
      notify(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('dormant')).toBeTruthy();
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('keeps selected media active even if it is outside the viewport', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    render(<Probe pinned />);
    expect(screen.getByText('loaded')).toBeTruthy();
  });

  it('preserves media rendering when IntersectionObserver is unsupported', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Probe />);
    expect(screen.getByText('loaded')).toBeTruthy();
  });
});
