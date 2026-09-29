import { afterEach, describe, expect, it, vi } from 'vitest';
import { mjImageAdapter } from '../model-adapters/mj-image-adapter';

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
