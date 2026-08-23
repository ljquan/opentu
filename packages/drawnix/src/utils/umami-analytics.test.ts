import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analytics } from './umami-analytics';

describe('Umami analytics', () => {
  const trackMock = vi.fn();

  beforeEach(() => {
    trackMock.mockReset();
    window.umami = { track: trackMock };
    window.history.replaceState({}, '', '/analytics-test');
  });

  afterEach(() => {
    delete window.umami;
  });

  it('sends sanitized events with release context', async () => {
    await analytics.track('test_event', { value: 'ok' });

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      'test_event',
      expect.objectContaining({
        value: 'ok',
        hostname: 'localhost',
        route_name: '/analytics-test',
      })
    );
  });

  it('does not throw when the SDK is unavailable', async () => {
    delete window.umami;

    await expect(analytics.track('ignored_event')).resolves.toBeUndefined();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('waits for an async Umami SDK result', async () => {
    let resolveTrack: (() => void) | undefined;
    trackMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveTrack = resolve;
      })
    );

    const pending = analytics.track('async_event');
    await vi.waitFor(() => expect(trackMock).toHaveBeenCalledTimes(1));
    expect(resolveTrack).toBeDefined();
    resolveTrack?.();
    await expect(pending).resolves.toBeUndefined();
  });

  it('swallows SDK rejections so analytics never breaks the caller', async () => {
    trackMock.mockRejectedValue(new Error('network unavailable'));

    await expect(analytics.track('rejected_event')).resolves.toBeUndefined();
  });

  it('handles a burst of events without dropping calls', async () => {
    trackMock.mockResolvedValue(undefined);

    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        analytics.track('burst_event', { sequence: index + 1 })
      )
    );

    expect(trackMock).toHaveBeenCalledTimes(100);
  });
});
