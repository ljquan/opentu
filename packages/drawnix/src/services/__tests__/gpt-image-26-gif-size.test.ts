import { describe, expect, it, vi } from 'vitest';
import { normalizeGPTImage26Request } from '../model-adapters/gpt-image-26-request';
import { buildGPTImageGenerationBody, gptImageAdapter } from '../model-adapters/gpt-image-adapter';
import { buildTuziGPTImageRequestBody, tuziGPTImageAdapter } from '../model-adapters/tuzi-gpt-image-adapter';

const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe.each(['gpt-image-2.6', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])(
  '%s GIF sheet sizing', (model) => {
    it.each([
      { gpt_image_26_output: 'gif' },
      { gpt_image_26_output: 'gif_official' },
      { output_format: 'gif' },
    ])('uses automatic pixels with a transport-only ratio for %j', (output) => {
      for (const frame_count of [undefined, '', 9, '9', 48]) {
        const request = { model, prompt: '小猫挥手', size: '1024x1024', params: {
          ...output, size: '3x2', resolution: '4k', background: 'transparent', frame_count,
        } };
        const original = structuredClone(request);
        const normalized = normalizeGPTImage26Request(request);
        expect(normalized).toMatchObject({ size: 'auto', params: { size: 'auto' } });
        expect(normalizeGPTImage26Request(normalized)).toEqual(normalized);
        for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
          const body = build(request);
          expect(body).toEqual({
            model, size: 'auto', n: 1, output_format: 'gif', background: 'transparent',
            prompt: '小猫挥手\nGIF 每帧画面比例：3:2\n透明图\n生成 GIF 图',
            ...(frame_count === undefined || frame_count === '' ? {} : { frame_count: Number(frame_count) }),
          });
          expect(build(normalized)).toEqual(body);
        }
        expect(request).toEqual(original);
      }
    });

    it('preserves an existing ratio hint without duplication', () => {
      const prompt = '小猫挥手\nGIF 每帧画面比例：3:2\n生成 GIF 图';
      const request = { model, prompt, size: '1536x1024', params: { output_format: 'gif' } };
      expect(normalizeGPTImage26Request(request)).toMatchObject({ prompt, size: 'auto' });
    });

    it.each([gptImageAdapter, tuziGPTImageAdapter])(
      '$id avoids the rejected 9-frame sheet without retrying or changing the selected provider', async (adapter) => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          if (body.size === '1536x1024') {
            return Response.json({ error: { message: "No supported sheet fits 9 GIF frames at size '1536x1024'. Invalid size '4608x3072'. The longest edge must be less than or equal to 3840." } }, { status: 400 });
          }
          return Response.json({ data: [{ b64_json: gif, width: 1, height: 1 }] });
        });
        const result = await adapter.generateImage({ baseUrl: 'https://gateway.example.com/v1', fetcher }, {
          model, prompt: '小猫挥手', size: '1536x1024',
          params: { gpt_image_26_output: 'gif_official', frame_count: 9 },
        });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(String(fetcher.mock.calls[0][0])).toBe('https://gateway.example.com/v1/images/generations');
        expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
          model, size: 'auto', frame_count: 9, output_format: 'gif',
          prompt: '小猫挥手\nGIF 每帧画面比例：3:2\n生成 GIF 图',
        });
        expect(result.format).toBe('gif');
      }
    );
  }
);
