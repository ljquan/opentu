import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEEDREAM_FLASH_MODEL_ID } from '../../constants/seedream-flash';
import { seedreamFlashImageAdapter } from '../model-adapters/seedream-flash-adapter';

const request = { model: SEEDREAM_FLASH_MODEL_ID, prompt: 'A blue cup' };
const profile = { baseUrl: 'https://dedicated.example.test/v1' };
const success = (item: Record<string, unknown>) =>
  new Response(JSON.stringify({ data: [item] }));
afterEach(() => vi.unstubAllGlobals());

describe('Seedream Flash dimensions without provider metadata', () => {
  it('reads actual pixels when a successful response omits size instead of deriving them from the requested tier', async () => {
    const loaded: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1800;
        naturalHeight = 1200;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          if (value) {
            loaded.push(value);
            queueMicrotask(() => this.onload?.());
          }
        }
      }
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        success({ url: 'https://cdn.example.test/without-size.png' })
      );
    const result = await seedreamFlashImageAdapter.generateImage(
      { baseUrl: profile.baseUrl, fetcher },
      { ...request, size: '1.5K' }
    );
    expect(result).toMatchObject({ width: 1800, height: 1200 });
    expect(loaded).toEqual(['https://cdn.example.test/without-size.png']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.raw).toEqual({
      data: [{ url: 'https://cdn.example.test/without-size.png' }],
    });
  });

  it('keeps the generated image available if missing dimensions cannot be decoded', async () => {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          if (value) queueMicrotask(() => this.onerror?.());
        }
      }
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        success({ url: 'https://cdn.example.test/unknown-size.png' })
      );
    const result = await seedreamFlashImageAdapter.generateImage(
      { baseUrl: profile.baseUrl, fetcher },
      request
    );
    expect(result.url).toBe('https://cdn.example.test/unknown-size.png');
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
