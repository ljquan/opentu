import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { buildTuziVideoRequest } from './tuzi-video-request';
import { submitVideoGeneration } from './media-api/video-api';
import {
  fitGeminiOmniRequest,
  GEMINI_OMNI_REQUEST_MAX_BYTES as LIMIT,
} from './gemini-omni-request-budget';
import { encodeTuziVideoBytes } from './tuzi-video-media';

const settings = vi.hoisted(() => ({ keepOriginal: vi.fn(() => false) }));
vi.mock('./reference-image-settings', () => ({
  readKeepOriginalImageEnabled: settings.keepOriginal,
}));
const bytes = (size: number) => {
  const value = new Uint8Array(size);
  value.set([255, 216, 255, 224]);
  return value;
};
const jpeg = (size: number) => encodeTuziVideoBytes(bytes(size), 'image/jpeg');
const byteLength = (body: unknown) =>
  new TextEncoder().encode(JSON.stringify(body)).length;
const request = (references: string[], prompt = '让画面动起来') => ({
  model: 'gemini-omni-1.2-flash',
  prompt,
  referenceImages: references,
});
let close: ReturnType<typeof vi.fn>;
let draw: ReturnType<typeof vi.fn>;
let encode: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  settings.keepOriginal.mockReturnValue(false);
  close = vi.fn();
  draw = vi.fn();
  encode = vi.fn(
    async ({ quality }: { quality: number }) =>
      new Blob([bytes(Math.floor(quality * 400_000))], { type: 'image/jpeg' })
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1600, height: 900, close }))
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(public width: number, public height: number) {}
      getContext() {
        return { fillRect: vi.fn(), drawImage: draw };
      }
      convertToBlob = encode;
    }
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Gemini Omni serialized request budget', () => {
  it('compresses an image below 1 MiB whose Base64 exceeds the request limit', async () => {
    const source = jpeg(900_000);
    const body = await buildTuziVideoRequest(request([source]));
    expect(byteLength(body)).toBeLessThan(LIMIT);
    expect(body).toMatchObject({
      input: [
        { type: 'text', text: '让画面动起来' },
        { type: 'image', mime_type: 'image/jpeg' },
      ],
    });
    expect(source).toBe(jpeg(900_000));
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 900);
    expect(close).toHaveBeenCalledOnce();
  });

  it('budgets multiple images together, preserving input order and small images', async () => {
    const small = jpeg(100);
    const body = await buildTuziVideoRequest(
      request([jpeg(600_000), small, jpeg(600_000)])
    );
    expect(byteLength(body)).toBeLessThan(LIMIT);
    const parts = body!.input as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(4);
    expect(parts[2].data).toBe(small.split(',')[1]);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('counts UTF-8 text and request metadata, not just image bytes', async () => {
    const body = await buildTuziVideoRequest(
      request([jpeg(600_000)], '湖'.repeat(150_000))
    );
    expect(byteLength(body)).toBeLessThan(LIMIT);
    expect(encode).toHaveBeenCalled();
  });

  it('keeps small inline images and public image URLs unchanged', async () => {
    const local = jpeg(100);
    const body = await buildTuziVideoRequest(request([local]));
    expect((body!.input as Array<Record<string, unknown>>)[1].data).toBe(
      local.split(',')[1]
    );
    expect(
      await buildTuziVideoRequest(request(['https://example.test/a.png']))
    ).toMatchObject({
      prompt: '让画面动起来',
      input_reference: 'https://example.test/a.png',
    });
    expect(encode).not.toHaveBeenCalled();
  });

  it('applies the same limit to cached canvas references and explicit image parts', async () => {
    const source = jpeg(900_000);
    const resolve = vi.fn(async () => source);
    const cached = await buildTuziVideoRequest(
      request(['/__aitu_cache__/image/source.png']),
      resolve
    );
    const explicit = await buildTuziVideoRequest({
      ...request([], ''),
      params: {
        input: [
          {
            type: 'image',
            mime_type: 'image/jpeg',
            data: source.split(',')[1],
          },
        ],
      },
    });
    expect(resolve).toHaveBeenCalledWith('/__aitu_cache__/image/source.png');
    expect(byteLength(cached)).toBeLessThan(LIMIT);
    expect(byteLength(explicit)).toBeLessThan(LIMIT);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('accepts exactly the byte limit and rejects oversized text without dropping it', async () => {
    const base = { prompt: '' };
    const exact = { prompt: 'a'.repeat(LIMIT - byteLength(base)) };
    expect(await fitGeminiOmniRequest(exact)).toBe(exact);
    await expect(
      fitGeminiOmniRequest({ prompt: exact.prompt + 'a' })
    ).rejects.toThrow('1 MiB');
  });

  it('refuses oversized videos or text instead of deleting input', async () => {
    await expect(
      buildTuziVideoRequest({
        ...request([]),
        params: {
          video_media: [
            {
              type: 'video',
              url: `data:video/mp4;base64,${'AAAA'.repeat(300_000)}`,
            },
          ],
        },
      })
    ).rejects.toThrow('1 MiB');
    await expect(
      buildTuziVideoRequest(request([jpeg(20)], '湖'.repeat(400_000)))
    ).rejects.toThrow('1 MiB');
    expect(encode).not.toHaveBeenCalled();
  });

  it('respects keep-original and fails before submitting any request', async () => {
    settings.keepOriginal.mockReturnValue(true);
    const fetchImpl = vi.fn();
    await expect(
      submitVideoGeneration(request([jpeg(900_000)]), {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test',
        fetchImpl,
      })
    ).rejects.toThrow('保留原图');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  it('submits exactly once and puts the bounded JSON on the wire', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new TextEncoder().encode(String(init?.body)).length).toBeLessThan(
        LIMIT
      );
      return new Response(JSON.stringify({ id: 'task_small' }));
    });
    expect(
      await submitVideoGeneration(request([jpeg(900_000)]), {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test',
        fetchImpl,
      })
    ).toBe('task_small');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects compression failure and releases decoded images', async () => {
    encode.mockRejectedValue(new Error('encode failed'));
    await expect(
      buildTuziVideoRequest(request([jpeg(900_000)]))
    ).rejects.toThrow('encode failed');
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects a still-oversized output without mutating the original request', async () => {
    encode.mockResolvedValue(
      new Blob([bytes(900_000)], { type: 'image/jpeg' })
    );
    const body = {
      input: [
        {
          type: 'image',
          mime_type: 'image/jpeg',
          data: jpeg(900_000).split(',')[1],
        },
      ],
    };
    const before = JSON.stringify(body);
    await expect(fitGeminiOmniRequest(body)).rejects.toThrow('1 MiB');
    expect(JSON.stringify(body)).toBe(before);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not impose this limit on other video models', async () => {
    const source = jpeg(900_000);
    const body = await buildTuziVideoRequest({
      ...request([source]),
      model: 'wan3.0-video',
    });
    expect(byteLength(body)).toBeGreaterThan(LIMIT);
    expect(encode).not.toHaveBeenCalled();
  });
});
