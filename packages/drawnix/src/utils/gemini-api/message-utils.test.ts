import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendImagePartsToLastUserMessage,
  buildImagePartsFromChatAttachments,
  normalizeImageUrlForMultimodalInput,
  countImageParts,
} from './message-utils';
import type { GeminiMessage } from './types';

const { getImageForAIMock } = vi.hoisted(() => ({
  getImageForAIMock: vi.fn(),
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getImageForAI: (...args: unknown[]) => getImageForAIMock(...args),
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getImageForAIMock.mockReset();
});

describe('message-utils', () => {
  it('builds image parts from chat attachments that already use data urls', async () => {
    const imageParts = await buildImagePartsFromChatAttachments([
      {
        id: 'att-1',
        name: 'example.png',
        type: 'image/png',
        size: 0,
        data: 'data:image/png;base64,ZmFrZQ==',
        isBlob: false,
      },
      {
        id: 'att-2',
        name: 'notes.txt',
        type: 'text/plain',
        size: 0,
        data: 'hello',
        isBlob: false,
      },
    ]);

    expect(imageParts).toHaveLength(1);
    expect(imageParts[0]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,ZmFrZQ==',
      },
    });
  });

  it('appends image parts to the last user message only', () => {
    const messages: GeminiMessage[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: 'system' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'first user' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'assistant' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'last user' }],
      },
    ];

    const updatedMessages = appendImagePartsToLastUserMessage(messages, [
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,ZmFrZQ==',
        },
      },
    ]);

    expect(countImageParts(updatedMessages)).toBe(1);
    expect(updatedMessages[3].content).toEqual([
      { type: 'text', text: 'last user' },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,ZmFrZQ==',
        },
      },
    ]);
    expect(updatedMessages[1].content).toEqual([
      { type: 'text', text: 'first user' },
    ]);
  });

  it('converts local cached image paths into data urls before sending', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-image'], { type: 'image/png' }),
    } as Response);

    const normalized = await normalizeImageUrlForMultimodalInput(
      './images/example.png'
    );

    expect(normalized.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('restores a virtual image through getImageForAI without using fetch', async () => {
    const virtualUrl = '/__aitu_cache__/image/example.png';
    const fetchMock = vi.fn();
    getImageForAIMock.mockResolvedValue({
      type: 'base64',
      value: 'data:image/png;base64,Y2FjaGVkLWltYWdl',
    });
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('fetch', fetchMock);

    const normalized = await normalizeImageUrlForMultimodalInput(virtualUrl);

    expect(getImageForAIMock).toHaveBeenCalledWith(virtualUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(normalized).toBe('data:image/png;base64,Y2FjaGVkLWltYWdl');
  });

  it('rejects a virtual image when getImageForAI falls back to its local path', async () => {
    const virtualUrl = '/__aitu_cache__/image/missing.png';
    getImageForAIMock.mockResolvedValue({
      type: 'url',
      value: virtualUrl,
    });

    await expect(
      normalizeImageUrlForMultimodalInput(virtualUrl)
    ).rejects.toThrow(`虚拟图片缓存不可用: ${virtualUrl}`);
  });

  it('rejects a virtual image when cache recovery returns no result', async () => {
    const virtualUrl = '/__aitu_cache__/image/missing-result.png';
    getImageForAIMock.mockResolvedValue(undefined);

    await expect(
      normalizeImageUrlForMultimodalInput(virtualUrl)
    ).rejects.toThrow(`虚拟图片缓存不可用: ${virtualUrl}`);
  });

  it('rejects non-image data returned for a virtual image', async () => {
    const virtualUrl = '/__aitu_cache__/image/not-an-image.png';
    getImageForAIMock.mockResolvedValue({
      type: 'base64',
      value: 'data:text/plain;base64,cGxhaW4=',
    });

    await expect(
      normalizeImageUrlForMultimodalInput(virtualUrl)
    ).rejects.toThrow(`虚拟图片缓存不可用: ${virtualUrl}`);
  });

  it('restores virtual chat images sequentially and preserves their order', async () => {
    const firstUrl = '/__aitu_cache__/image/first.png';
    const secondUrl = '/__aitu_cache__/image/second.png';
    const events: string[] = [];
    getImageForAIMock.mockImplementation(async (url: string) => {
      events.push(`start:${url}`);
      await Promise.resolve();
      events.push(`end:${url}`);
      return {
        type: 'base64',
        value:
          url === firstUrl
            ? 'data:image/png;base64,RklSU1Q='
            : 'data:image/png;base64,U0VDT05E',
      };
    });

    const imageParts = await buildImagePartsFromChatAttachments([
      {
        id: 'att-first',
        name: 'first.png',
        type: 'image/png',
        size: 0,
        data: firstUrl,
        isBlob: false,
      },
      {
        id: 'att-second',
        name: 'second.png',
        type: 'image/png',
        size: 0,
        data: secondUrl,
        isBlob: false,
      },
    ]);

    expect(events).toEqual([
      `start:${firstUrl}`,
      `end:${firstUrl}`,
      `start:${secondUrl}`,
      `end:${secondUrl}`,
    ]);
    expect(imageParts.map((part) => part.image_url?.url)).toEqual([
      'data:image/png;base64,RklSU1Q=',
      'data:image/png;base64,U0VDT05E',
    ]);
  });

  it('keeps public image urls unchanged without cache recovery', async () => {
    const publicUrl = 'https://cdn.example.com/reference.png';

    await expect(normalizeImageUrlForMultimodalInput(publicUrl)).resolves.toBe(
      publicUrl
    );
    expect(getImageForAIMock).not.toHaveBeenCalled();
  });
});
