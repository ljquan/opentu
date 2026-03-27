import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendImagePartsToLastUserMessage,
  buildImagePartsFromChatAttachments,
  normalizeImageUrlForMultimodalInput,
  countImageParts,
} from './message-utils';
import type { GeminiMessage } from './types';

afterEach(() => {
  vi.restoreAllMocks();
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['fake-image'], { type: 'image/png' }), {
        status: 200,
      }) as Response
    );

    const normalized = await normalizeImageUrlForMultimodalInput(
      '/__aitu_cache__/image/example.png'
    );

    expect(normalized.startsWith('data:image/png;base64,')).toBe(true);
  });
});
