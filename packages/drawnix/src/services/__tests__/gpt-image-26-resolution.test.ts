import { describe, expect, it, vi } from 'vitest';
import { GPT_IMAGE_26_MODEL_IDS } from '../../constants/model-config';
import { buildGPTImageGenerationBody, buildGPTImageEditFormData, gptImageAdapter } from '../model-adapters/gpt-image-adapter';
import { buildTuziGPTImageRequestBody, buildTuziGPTImageEditFormData, tuziGPTImageAdapter } from '../model-adapters/tuzi-gpt-image-adapter';
import { normalizeGPTImage26Request } from '../model-adapters/gpt-image-26-request';
import { resolveOfficialGPTImageSize, resolveOfficialGPTImageEditSize } from '../model-adapters/image-size-quality-resolver';
import type { ImageGenerationRequest } from '../model-adapters/types';

const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe.each(GPT_IMAGE_26_MODEL_IDS.filter((id) => id !== 'gpt-image-2.6-1k'))('%s ratio and resolution controls', (model) => {
  it.each([
    ['1x1', '1k', '1024x1024'], ['1x1', '2k', '2048x2048'], ['1x1', '4k', '4096x4096'],
    ['2x3', '1k', '832x1248'], ['2x3', '2k', '1680x2512'], ['2x3', '4k', '2352x3520'],
    ['3x2', '1k', '1248x832'], ['3x2', '2k', '2512x1680'], ['3x2', '4k', '3520x2352'],
    ['3x4', '1k', '880x1184'], ['3x4', '2k', '1776x2368'], ['3x4', '4k', '2480x3312'],
    ['4x3', '1k', '1184x880'], ['4x3', '2k', '2368x1776'], ['4x3', '4k', '3312x2480'],
    ['4x5', '1k', '912x1152'], ['4x5', '2k', '1824x2288'], ['4x5', '4k', '2576x3216'],
    ['5x4', '1k', '1152x912'], ['5x4', '2k', '2288x1824'], ['5x4', '4k', '3216x2576'],
    ['9x16', '1k', '768x1360'], ['9x16', '2k', '1536x2736'], ['9x16', '4k', '2160x3840'],
    ['16x9', '1k', '1360x768'], ['16x9', '2k', '2736x1536'], ['16x9', '4k', '3840x2160'],
    ['21x9', '1k', '1568x672'], ['21x9', '2k', '3136x1344'], ['21x9', '4k', '3840x1632'],
  ])('combines ratio %s and tier %s into size %s across compatible routes', async (ratio, resolution, size) => {
    const request = { model, prompt: '风景图', params: { size: ratio, resolution } };
    const normalized = normalizeGPTImage26Request(request);
    expect(normalized).toMatchObject({ size, params: { size, resolution } });
    expect(normalizeGPTImage26Request(normalized)).toEqual(normalized);
    for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
      expect(build(request)).toMatchObject({ model: request.model, size });
      expect(build(request)).not.toHaveProperty('resolution');
    }
    const edit = { ...request, referenceImages: [`data:image/gif;base64,${gif}`], maskImage: `data:image/gif;base64,${gif}` };
    for (const form of [await buildGPTImageEditFormData(edit), await buildTuziGPTImageEditFormData(edit)]) {
      expect(form.get('size')).toBe(size);
      expect(form.has('resolution')).toBe(false);
    }
  });

  it.each([
    ['auto', 'auto', '16:9 的湖泊', 'auto'],
    ['auto', '2k', '16:9 的湖泊', '2736x1536'],
    ['auto', '4k', '竖图 3：4', '2480x3312'],
    ['auto', '4k', '湖泊', '4096x4096'],
    ['3x4', 'auto', '湖泊', '880x1184'],
    ['1x1', 'auto', '湖泊', '1024x1024'],
    ['16x9', 'auto', '湖泊', '16x9'],
  ])('keeps automatic ratio/resolution behavior for %s / %s / %s', (size, resolution, prompt, expected) => {
    for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
      expect(build({ model, prompt, params: { size, resolution } }).size).toBe(expected);
    }
  });

  it.each(['gif', 'gif_official', 'svg'])('isolates the saved resolution from %s output', (output) => {
    for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
      const body = build({ model, prompt: '图', params: {
        size: '1x1', resolution: '4k', gpt_image_26_output: output,
      } });
      expect(body.size).toBe(output === 'svg' ? '1024x1024' : 'auto');
      expect(body).not.toHaveProperty('resolution');
    }
  });

  it.each(['2048x2048', '4096x4096'])(
    'preserves explicit static size %s through normalization, JSON and multipart routes', async (size) => {
      const request: ImageGenerationRequest = {
        model, prompt: '静态风景', size: '1024x1024',
        params: { size, gpt_image_26_output: 'auto', output_format: 'png', resolution: 'auto' },
      };
      const normalized = normalizeGPTImage26Request(request);
      expect(normalized.size).toBe(size);
      expect(normalizeGPTImage26Request(normalized)).toEqual(normalized);
      for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
        expect(build(request)).toMatchObject({ model: request.model, size, output_format: 'png', n: 1 });
        expect(build({ model: request.model, prompt: request.prompt, size }).size).toBe(size);
        expect(build(request)).not.toHaveProperty('resolution');
      }
      expect(resolveOfficialGPTImageSize(request.model, size)).toBe(size);
      expect(resolveOfficialGPTImageEditSize(request.model, size)).toBe(size);
      const editRequest = {
        ...request,
        referenceImages: [`data:image/gif;base64,${gif}`],
        maskImage: `data:image/gif;base64,${gif}`,
      };
      for (const form of [
        await buildGPTImageEditFormData(editRequest),
        await buildTuziGPTImageEditFormData(editRequest),
      ]) {
        expect(form.get('size')).toBe(size);
        expect(form.has('image[]')).toBe(true);
      }
      for (const gpt_image_26_output of ['gif', 'gif_official', 'svg']) {
        for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
          expect(build({ ...request, params: { size, gpt_image_26_output } }).size).toBe('auto');
        }
      }
      for (const output_format of ['gif', 'svg']) {
        expect(normalizeGPTImage26Request({ ...request, params: { size, output_format } }).size).toBe('auto');
      }
    }
  );

  it.each([gptImageAdapter, tuziGPTImageAdapter])(
    '$id accepts a 4K tier result at the actual returned dimensions without regeneration', async (adapter) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        data: [{ url: 'https://example.com/4k-tier.png', width: 2880, height: 2880 }],
      }), { status: 200 }));
      const result = await adapter.generateImage(
        { baseUrl: 'https://api.tu-zi.com/v1', authType: 'bearer', fetcher },
        { model, prompt: '静态风景', size: '4096x4096' }
      );
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).size).toBe('4096x4096');
      expect(result).toMatchObject({ width: 2880, height: 2880, format: 'png' });
    }
  );
});
