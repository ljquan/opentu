import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedreamImageAdapter } from '../seedream-adapter';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../context', () => ({ sendAdapterRequest: send }));
afterEach(() => vi.resetAllMocks());

describe('Seedream durable image responses', () => {
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
