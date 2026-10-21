// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../tuzi-embedded-config', () => ({
  tuziEmbeddedConfig: { enabled: true, apiBaseUrl: 'http://127.0.0.1:3000' },
}));
import {
  readTuziClientChannel,
  withTuziClientChannel,
  fetchWithTuziClientChannel,
} from '../tuzi-client-attribution';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('per-request channel attribution', () => {
  it.each([
    ['opentu-desktop-client-channel:3', 3],
    ['opentu-desktop-client-channel:4', 0],
    ['other:3', 0],
    ['', 0],
  ])('uses the single desktop channel with proof %s', (proof, expected) => {
    vi.stubEnv('VITE_OPENTU_DESKTOP', 'true');
    vi.stubGlobal('__OPENTU_DESKTOP_CHANNEL_PROOF__', proof);
    for (const origin of [
      'tauri://localhost',
      'http://tauri.localhost',
      'http://localhost:7201',
      'https://opentu.ai',
    ]) {
      expect(readTuziClientChannel(origin)).toBe(expected);
      expect(
        withTuziClientChannel(
          'https://api.tu-zi.com/v1/responses?ch=2&%63h=4&sig=a%2Fb',
          readTuziClientChannel(origin)
        )
      ).toBe('https://api.tu-zi.com/v1/responses?sig=a%2Fb&ch=' + expected);
    }
  });
  it.each([
    ['https://opentu.ai', 1],
    ['https://pr.opentu.ai', 2],
    ['http://localhost:7200', 2],
    ['http://127.0.0.1:7200', 2],
    ['http://[::1]:7200', 2],
    ['https://opentu.ai.evil.example', 0],
    ['http://opentu.ai', 0],
    ['file://', 0],
    ['tauri://localhost', 0],
  ])('maps %s to %s for web clients', (origin, ch) => {
    expect(readTuziClientChannel(origin)).toBe(ch);
  });
  it('replaces duplicate and encoded channel parameters while retaining every other query byte', () => {
    const url =
      'https://api.tu-zi.com/v1/images/edits?x=a%20b&ch=2&%63h=3&sig=a+b%2F&bad=%zz#result';
    const result = withTuziClientChannel(url, 1);
    expect(result).toBe(
      'https://api.tu-zi.com/v1/images/edits?x=a%20b&sig=a+b%2F&bad=%zz&ch=1#result'
    );
    expect(withTuziClientChannel(result, 1)).toBe(result);
    expect(
      withTuziClientChannel('http://127.0.0.1:3000/v1/audio/speech', 2)
    ).toBe('http://127.0.0.1:3000/v1/audio/speech?ch=2');
  });
  it.each([
    'https://api.openai.com/v1/responses',
    'https://evil.tu-zi.com/v1/images/generations',
    'https://api.tu-zi.com.evil.example/v1/responses',
    'https://user@api.tu-zi.com/v1/responses',
    '/local/path',
  ])('leaves foreign or ambiguous targets unchanged: %s', (url) => {
    expect(withTuziClientChannel(url, 1)).toBe(url);
  });
  it('keeps JSON explicit zero/false, unknown fields, headers and signal unchanged', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const init = {
      method: 'POST',
      body: '{"temperature":0,"stream":false,"extra":{"keep":1}}',
      headers: { Authorization: 'Bearer test' },
      signal: new AbortController().signal,
    };
    await fetchWithTuziClientChannel(
      'https://api.tu-zi.com/v1/responses',
      init
    );
    expect(fetcher.mock.calls[0][1]).toBe(init);
    expect(
      new URL(fetcher.mock.calls[0][0]).searchParams.getAll('ch')
    ).toHaveLength(1);
  });
  it('does not serialize or copy multipart/file bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const body = new FormData();
    body.append(
      'image',
      new Blob([new Uint8Array([0, 255, 1, 13, 10])]),
      'image.png'
    );
    body.append('unknown', 'false');
    const init = { method: 'POST', body };
    await fetchWithTuziClientChannel(
      'https://api.tu-zi.com/v1/images/edits',
      init
    );
    expect(fetcher.mock.calls[0][1]).toBe(init);
    expect(fetcher.mock.calls[0][1].body).toBe(body);
  });
  it('keeps Request bytes and headers without converting HTTP/1.1 uploads to streams', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const request = new Request('https://api.tu-zi.com/v1/responses', {
      method: 'POST',
      body: '{"n":0}',
      headers: { 'x-test': 'keep' },
    });
    await fetchWithTuziClientChannel(request);
    const [input, init] = fetcher.mock.calls[0];
    expect(init.body).toBeInstanceOf(Blob);
    const sent = new Request(input, init);
    expect(await sent.text()).toBe('{"n":0}');
    expect(sent.headers.get('x-test')).toBe('keep');
    expect(new URL(sent.url).searchParams.has('ch')).toBe(true);
  });
  it('honors Request init overrides and preserves multipart bytes and boundary', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const body = new FormData();
    body.append(
      'file',
      new Blob([new Uint8Array([0, 255, 13, 10])]),
      'input.png'
    );
    const controller = new AbortController();
    const request = new Request('https://api.tu-zi.com/v1/images/edits', {
      method: 'POST',
      body,
    });
    const expected = await request.clone().arrayBuffer();
    await fetchWithTuziClientChannel(request, { signal: controller.signal });
    const sent = new Request(
      ...(fetcher.mock.calls[0] as [Request, RequestInit])
    );
    expect(await sent.arrayBuffer()).toEqual(expected);
    expect(sent.headers.get('content-type')).toBe(
      request.headers.get('content-type')
    );
    controller.abort();
    expect(sent.signal.aborted).toBe(true);
  });
  it('cancels a pending Request body read on abort without sending a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const cancelled = vi.fn();
    const controller = new AbortController();
    const request = new Request('https://api.tu-zi.com/v1/responses', {
      method: 'POST',
      body: new ReadableStream({ cancel: cancelled }),
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit);
    const pending = fetchWithTuziClientChannel(request);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
