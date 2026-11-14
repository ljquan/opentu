import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedreamImageAdapter } from '../seedream-adapter';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../context', () => ({ sendAdapterRequest: send }));
afterEach(() => vi.resetAllMocks());

describe('Seedream durable image responses', () => {
  it.each([
    ['1K', '1K'], ['1.5K', '1.5K'], ['2K', '2K'],
    ['1x1', '2048x2048'], ['16x9', '2560x1440'], ['1536x1536', '1536x1536'],
  ])('preserves Seedream 5.5 size %s as %s', async (size, expectedSize) => {
    send.mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://example.test/image.png' }],
    })));
    await seedreamImageAdapter.generateImage({baseUrl:'https://api.example.test/v1'}, {
      model:'doubao-seedream-5-5-261028', prompt:'test', size,
    });
    expect(JSON.parse(send.mock.calls[0][1].body).size).toBe(expectedSize);
  });

  it('sends Seedream 5.5 native size and image controls without rewriting model identity', async () => {
    send.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: 'https://signed.example.test/result.png' }] })
      )
    );

    await seedreamImageAdapter.generateImage(
      { baseUrl: 'https://api.example.test/v1' },
      {
        model: 'doubao-seedream-5-5-261028',
        prompt: 'transparent sticker',
        size: '1.5K',
        background: 'transparent',
        outputFormat: 'png',
        params: {
          watermark: false,
          layer_decomposition: false,
        },
        referenceImages: [
          'https://example.test/reference-1.png',
          'https://example.test/reference-2.png',
        ],
      }
    );

    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({
      model: 'doubao-seedream-5-5-261028',
      prompt: 'transparent sticker',
      response_format: 'b64_json',
      size: '1.5K',
      image: [
        'https://example.test/reference-1.png',
        'https://example.test/reference-2.png',
      ],
      background: 'transparent',
      output_format: 'png',
      watermark: false,
      layer_decomposition: false,
    });
    expect(send.mock.calls[0][1]).toMatchObject({
      path: '/api/v3/images/generations',
      baseUrlStrategy: 'trim-v1',
    });
  });

  it('rejects more than 10 Seedream 5.5 reference images before transport', async () => {
    await expect(
      seedreamImageAdapter.generateImage(
        { baseUrl: 'https://api.example.test/v1' },
        {
          model: 'doubao-seedream-5-5-261028',
          prompt: 'collage',
          referenceImages: Array.from(
            { length: 11 },
            (_, index) => `https://example.test/reference-${index}.png`
          ),
        }
      )
    ).rejects.toThrow('最多支持 10 张参考图');
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [
      '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/bSiiivPPQP/2Q==',
      'jpeg',
    ],
    [
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'png',
    ],
  ])(
    'requests inline bytes and prefers %s over a temporary URL',
    async (bytes, format) => {
      send.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                url: 'https://signed.example.test/temporary.png',
                b64_json: bytes,
              },
            ],
          })
        )
      );
      const result = await seedreamImageAdapter.generateImage(
        { baseUrl: 'https://api.example.test/v1' },
        {
          model: 'doubao-seedream-5-0-260128',
          prompt: 'cup',
          size: '9x16',
          params: { seedream_quality: '3k' },
        }
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({
        model: 'doubao-seedream-5-0-260128',
        response_format: 'b64_json',
        size: '2304x4096',
      });
      expect(result.url).toBe(`data:image/${format};base64,${bytes}`);
      expect(result.format).toBe(format === 'jpeg' ? 'jpg' : format);
      expect(result.urls).toEqual([result.url]);
    }
  );

  it('keeps URL-only responses available for the existing cache warning and download path', async () => {
    const url = 'https://signed.example.test/temporary.jpeg';
    send.mockResolvedValue(new Response(JSON.stringify({ data: [{ url }] })));
    const result = await seedreamImageAdapter.generateImage(
      { baseUrl: 'https://api.example.test/v1' },
      { prompt: 'cup' }
    );
    expect(result.url).toBe(url);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports an invalid response without submitting a second generation', async () => {
    send.mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    await expect(
      seedreamImageAdapter.generateImage(
        { baseUrl: 'https://api.example.test/v1' },
        { prompt: 'cup' }
      )
    ).rejects.toThrow('未返回有效的图片数据');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
