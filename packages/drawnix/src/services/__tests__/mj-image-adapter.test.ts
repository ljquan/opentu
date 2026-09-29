import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMJImageUrls, mjImageAdapter } from '../model-adapters/mj-image-adapter';

vi.mock('../../utils/config-indexeddb-writer', () => ({
  configIndexedDBWriter: { saveConfig: async () => undefined },
}));

afterEach(() => {
  vi.useRealTimers();
});

async function captureSubmission(
  prompt: string,
  params?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  vi.useFakeTimers();
  let submitted: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      submitted = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ code: 1, description: 'submitted', result: 'mj-1' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        status: 'SUCCESS',
        imageUrl: 'https://example.test/image.png',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  };
  const result = mjImageAdapter.generateImage(
    { baseUrl: 'https://example.test', fetcher },
    {
      model: 'mj-imagine',
      prompt,
      params,
      referenceImages: ['data:image/png;base64,YQ=='],
    }
  );
  await vi.runAllTimersAsync();
  await result;
  return submitted;
}

describe('Midjourney parameter submission', () => {
  it.each(['file:///bad.png', '', 123])('uses a validated individual image when the composite URL is invalid: %s', async imageUrl => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ result: 'remote' }))).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'SUCCESS', imageUrl, imageUrls: [{ url: 'https://example.test/good.png' }] })));
    const pending = mjImageAdapter.generateImage({ baseUrl: 'https://example.test', fetcher }, { model: 'mj-imagine', prompt: 'test' });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ url: 'https://example.test/good.png' });
  });
  it.each([true, false])('returns all four images with composite imageUrl present: %s', async (hasComposite) => {
    vi.useFakeTimers();
    const urls = Array.from({ length: 4 }, (_, index) => `https://example.test/mj-${index}.png`);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'mj-multi' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'SUCCESS', ...(hasComposite ? { imageUrl: 'https://example.test/grid.png' } : {}), imageUrls: urls.map(url => ({ url })) })));
    const pending = mjImageAdapter.generateImage({ baseUrl: 'https://example.test', fetcher }, { model: 'mj-imagine', prompt: 'test' });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ url: hasComposite ? 'https://example.test/grid.png' : urls[0], urls });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('filters unusable image entries and falls back to a single composite image', () => {
    expect(getMJImageUrls({ imageUrls: [null, {}, { url: '' }, { url: 'file:///not-an-image' }, { url: 'https://example.test/one.png' }] })).toEqual(['https://example.test/one.png']);
    expect(getMJImageUrls({ imageUrl: 'https://example.test/grid.png', imageUrls: [{}] })).toEqual(['https://example.test/grid.png']);
    expect(getMJImageUrls({ imageUrls: [{}] })).toEqual([]);
  });

  it('reports a completed response with no usable images without polling until timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'mj-empty' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'SUCCESS', imageUrls: [] })));
    const pending = mjImageAdapter.generateImage({ baseUrl: 'https://example.test', fetcher }, { model: 'mj-imagine', prompt: 'test' });
    const assertion = expect(pending).rejects.toThrow('without valid image results');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('converts every structured MJ parameter into provider prompt flags', async () => {
    const body = await captureSubmission('An architectural drawing', {
      mj_ar: '16:9',
      mj_v: '7',
      mj_style: 'raw',
      mj_s: 100,
      mj_q: '2',
      mj_seed: 0,
      unrelated: 'ignored',
    });
    expect(body).toEqual({
      botType: 'MID_JOURNEY',
      prompt:
        'An architectural drawing --ar 16:9 --v 7 --style raw --s 100 --q 2 --seed 0',
      base64Array: ['YQ=='],
    });
  });

  it('does not duplicate flags already appended by the ordinary canvas', async () => {
    const body = await captureSubmission('A landscape --ar 16:9 --v 7', {
      mj_ar: '16:9',
      mj_v: '7',
      mj_style: 'default',
    });
    expect(body.prompt).toBe('A landscape --ar 16:9 --v 7');
  });

  it('lets selected parameters replace conflicting prompt flags and preserves other flags', async () => {
    const body = await captureSubmission(
      'A landscape --ar 1:1 --seed 12 --chaos 20',
      {
        mj_ar: '9:16',
        mj_seed: 0,
      }
    );
    expect(body.prompt).toBe('A landscape --chaos 20 --ar 9:16 --seed 0');
  });

  it('preserves prompt-only requests and ignores default or non-scalar parameter values', async () => {
    const prompt = 'A landscape --ar 1:1';
    const body = await captureSubmission(prompt, {
      mj_ar: 'default',
      mj_v: null,
      mj_q: {},
      mj_s: Number.NaN,
    });
    expect(body.prompt).toBe(prompt);
  });
});
