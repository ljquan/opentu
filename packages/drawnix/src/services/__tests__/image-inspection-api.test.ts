import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchImageInspectionWithTimeout,
  isImageInspectionRunActive,
  isTuziProviderProfile,
  selectImageInspectionProfile,
} from '../image-inspection-api';
import type { ProviderProfile } from '../../utils/settings-manager';

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'tuzi',
    name: 'Tuzi',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.tu-zi.com/v1',
    apiKey: 'test-key',
    authType: 'bearer',
    enabled: true,
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: true,
      supportsAudio: true,
      supportsTools: false,
    },
    ...overrides,
  };
}

describe('image-inspection-api', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('selects only an enabled Tuzi provider with a token', () => {
    const selected = selectImageInspectionProfile([
      profile({ id: 'disabled', enabled: false }),
      profile({ id: 'empty', apiKey: '' }),
      profile({ id: 'other', baseUrl: 'https://api.openai.com/v1' }),
      profile({ id: 'usable', baseUrl: 'https://apius.tu-zi.com/v1' }),
    ]);

    expect(selected?.id).toBe('usable');
  });

  it('recognizes Tuzi root and subdomains without matching lookalikes', () => {
    expect(isTuziProviderProfile(profile())).toBe(true);
    expect(
      isTuziProviderProfile(
        profile({ baseUrl: 'https://api.sydney-ai.com/v1' })
      )
    ).toBe(true);
    expect(
      isTuziProviderProfile(
        profile({ baseUrl: 'https://apisz.ourzhishi.top/v1' })
      )
    ).toBe(true);
    expect(
      isTuziProviderProfile(
        profile({ baseUrl: 'https://api.tu-zi.com.evil.example/v1' })
      )
    ).toBe(false);
    expect(
      isTuziProviderProfile(profile({ baseUrl: 'https://random.tu-zi.com/v1' }))
    ).toBe(false);
  });

  it('treats pending and running runs as active', () => {
    expect(isImageInspectionRunActive('pending')).toBe(true);
    expect(isImageInspectionRunActive('running')).toBe(true);
    expect(isImageInspectionRunActive('completed')).toBe(false);
    expect(isImageInspectionRunActive('stopped')).toBe(false);
  });

  it('aborts a half-open request when its deadline is reached', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );

    const request = expect(
      fetchImageInspectionWithTimeout('/inspection', {}, 1000)
    ).rejects.toThrow('巡检服务请求超时（1 秒）');
    await vi.advanceTimersByTimeAsync(1000);

    await request;
  });

  it('forwards an external abort without reporting a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );
    const controller = new AbortController();
    const request = fetchImageInspectionWithTimeout(
      '/inspection',
      { signal: controller.signal },
      1000
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
