import { describe, expect, it, vi } from 'vitest';
import { buildGPTImageGenerationBody, buildGPTImageEditFormData, gptImageAdapter } from '../model-adapters/gpt-image-adapter';
import { buildTuziGPTImageRequestBody, buildTuziGPTImageEditFormData, tuziGPTImageAdapter } from '../model-adapters/tuzi-gpt-image-adapter';
import { normalizeGPTImage26Request } from '../model-adapters/gpt-image-26-request';
import type { ImageGenerationRequest } from '../model-adapters/types';
import { GPT_IMAGE_26_MODEL_IDS } from '../../constants/model-config';

const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><circle r="10"/></svg>');
const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe.each(GPT_IMAGE_26_MODEL_IDS)('2.6 output contract: %s', (model) => {
  const is1k = model === 'gpt-image-2.6-1k';
  const responseParams = is1k ? { response_format: 'b64_json' } : {};
  const request: ImageGenerationRequest = { model, prompt: '小猫挥手', size: 'auto', params: {
    quality: 'max', output_format: 'unsupported', response_format: 'b64_json', resolution: '4k', n: 4,
  } };

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])('uses the single GIF mode with a transport-only suffix and model-supported fields', (build) => {
    const input = { ...request, params: { ...request.params, gpt_image_26_output: 'gif', frame_count: 9 } };
    const normalized = normalizeGPTImage26Request(input);
    expect(normalizeGPTImage26Request(normalized)).toEqual(normalized);
    expect(build(input)).toEqual({ model, prompt: '小猫挥手\n生成 GIF 图', size: 'auto', n: 1, ...responseParams,
      ...(!is1k ? { output_format: 'gif', frame_count: 9 } : {}),
    });
    expect(input.prompt).toBe('小猫挥手');
  });

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])('keeps the model-specific response format policy in automatic mode', (build) => {
    expect(build(request)).toEqual({ model, prompt: request.prompt, size: is1k ? 'auto' : '4096x4096', n: 1, ...responseParams });
  });

  it('does not duplicate existing hint lines or remove user-written text', () => {
    const input = { model, prompt: '图\n透明图\n生成 GIF 图',
      params: { background: 'transparent', gpt_image_26_output: 'gif' },
    };
    const normalized = normalizeGPTImage26Request(input);
    expect(normalized.prompt).toBe(input.prompt);
    expect(normalizeGPTImage26Request(normalized)).toEqual(normalized);
    expect(input.prompt).toBe('图\n透明图\n生成 GIF 图');
  });

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])('preserves static image fields and zero compression with model-specific resolution support', (build) => {
    expect(build({ ...request, params: {
      gpt_image_26_output: 'auto', quality: 'high', background: 'transparent',
      output_format: 'webp', output_compression: '0', moderation: 'auto', user: ' client-1 ',
      resolution: '4k', response_format: 'url',
    } })).toEqual({
      model, prompt: `${request.prompt}\n透明图`, size: is1k ? 'auto' : '4096x4096', n: 1, quality: 'high',
      background: 'transparent', output_format: 'webp', output_compression: 0,
      moderation: 'auto', user: 'client-1',
      ...responseParams,
    });
  });

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])('uses PNG for transparency unless WebP is selected and rejects JPEG before sending', (build) => {
    expect(build({ model, prompt: '透明花朵', background: 'transparent' })).toMatchObject({
      background: 'transparent', output_format: 'png',
    });
    expect(() => build({ model, prompt: '透明花朵', params: {
      background: 'transparent', output_format: 'jpeg',
    } })).toThrow('透明背景需要 PNG 或 WebP');
  });

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])('validates lossy compression and omits inapplicable PNG and text-only edit fields', (build) => {
    for (const output_compression of [-1, 101, 2.5, true, 'bad']) {
      expect(() => build({ model, prompt: '照片', params: {
        output_format: 'jpeg', output_compression,
      } })).toThrow('压缩质量必须为');
    }
    expect(build({ model, prompt: '照片', params: {
      output_format: 'jpeg', output_compression: '100',
    } })).toMatchObject({ output_format: 'jpeg', output_compression: 100 });
    expect(build({ model, prompt: '照片', params: {
      output_format: 'webp', output_compression: '  ',
    } })).not.toHaveProperty('output_compression');
    const body = build({ model, prompt: '图片', params: {
      output_format: 'png', output_compression: 'bad', input_fidelity: 'high',
      response_format: 'url', stream: true, partial_images: 3, style: 'vivid',
    } });
    expect(body).not.toHaveProperty('output_compression');
    expect(body).not.toHaveProperty('input_fidelity');
    expect(body.response_format).toBe(responseParams.response_format);
    for (const key of ['stream', 'partial_images', 'style']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it.each(is1k ? ['gif'] : ['gif', 'gif_official', 'svg'])('isolates static encodings in %s while preserving applicable image controls', (output) => {
    const input = { model, prompt: '图', background: 'transparent' as const,
      outputFormat: 'jpeg' as const, outputCompression: 85,
      params: { gpt_image_26_output: output, quality: 'high', moderation: 'low', user: 'old', frame_count: 48 },
    };
    const normalized = normalizeGPTImage26Request(input);
    expect(normalizeGPTImage26Request(normalized)).toEqual(normalized);
    for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
      const body = build(input);
      for (const key of ['output_compression', 'input_fidelity']) {
        expect(body).not.toHaveProperty(key);
      }
      if (output === 'svg') {
        for (const key of ['background', 'quality', 'moderation', 'user']) {
          expect(body).not.toHaveProperty(key);
        }
      } else {
        expect(body).toMatchObject({
          background: 'transparent', quality: 'high', moderation: 'low', user: 'old',
        });
      }
      expect(body.output_format).toBe(is1k ? undefined : output === 'svg' ? 'svg' : 'gif');
    }
  });

  it.each(is1k ? ['gif'] : ['gif', 'gif_official'])(
    'keeps transparent %s requests on GIF output instead of selecting PNG', (output) => {
      const input = { model, prompt: '花朵', params: {
        gpt_image_26_output: output, background: 'transparent', quality: 'medium',
      } };
      for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
        expect(build(input)).toEqual({
          model, prompt: '花朵\n透明图\n生成 GIF 图',
          size: 'auto', n: 1, ...responseParams,
          background: 'transparent', quality: 'medium',
          ...(!is1k ? { output_format: 'gif' } : {}),
        });
      }
    }
  );

  it('keeps transparency, quality, format, compression and input fidelity through both multipart edit builders', async () => {
    const editRequest = { model, prompt: '编辑',
      referenceImages: [`data:image/gif;base64,${gif}`], maskImage: `data:image/gif;base64,${gif}`,
      params: { background: 'transparent', output_format: 'webp', output_compression: '75', quality: 'medium', input_fidelity: 'high' },
    };
    for (const form of [await buildGPTImageEditFormData(editRequest), await buildTuziGPTImageEditFormData(editRequest)]) {
      for (const [key, value] of Object.entries({ model, background: 'transparent', output_format: 'webp', output_compression: '75', quality: 'medium', input_fidelity: 'high' })) {
        expect(form.get(key)).toBe(value);
      }
      expect(form.getAll('input_fidelity')).toEqual(['high']);
      expect(form.get('prompt')).toBe('编辑\n透明图');
      expect(form.has('mask')).toBe(true);
      expect(form.has('image[]')).toBe(true);
      expect(form.get('response_format')).toBe(responseParams.response_format || null);
    }
    expect(buildTuziGPTImageRequestBody(editRequest)).toMatchObject({ input_fidelity: 'high' });
  });

  it.each([gptImageAdapter, tuziGPTImageAdapter])('$id reports a static format mismatch without resubmitting', async (adapter) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://example.com/result.png', width: 80, height: 40 }],
    }), { status: 200 }));
    await expect(adapter.generateImage({ baseUrl: 'https://api.tu-zi.com/v1', fetcher }, {
      model, prompt: '图片', params: { output_format: 'webp' },
    })).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_FORMAT_MISMATCH', accepted: true, retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  // The 1k alias shares raster controls while retaining its prompt-only GIF mode.
  if (is1k) return;

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])('sends official GIF fields and validates optional frames', (build) => {
    const input = { ...request, params: { ...request.params, gpt_image_26_output: 'gif_official', frame_count: '9' } };
    expect(build(input)).toEqual({ model, prompt: `${request.prompt}\n生成 GIF 图`, size: 'auto', n: 1,
      output_format: 'gif', frame_count: 9 });
    expect(normalizeGPTImage26Request(input).params).not.toHaveProperty('response_format');
    expect(build({ ...input, params: { ...input.params, frame_count: '' } })).not.toHaveProperty('frame_count');
    for (const frame_count of [0, -1, 1.5, 'invalid', true, Infinity]) {
      expect(() => build({ ...input, params: { ...input.params, frame_count } })).toThrow('帧数必须为正整数');
    }
  });

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])('sends non-streaming SVG and isolates unrelated format fields', (build) => {
    const input = { ...request, params: { ...request.params, gpt_image_26_output: 'svg', frame_count: 'invalid' } };
    expect(build(input)).toEqual({ model, prompt: request.prompt, size: 'auto', n: 1,
      output_format: 'svg', svg: { model: 'gpt-5.5' }, stream: false });
    expect(normalizeGPTImage26Request(input).params).not.toHaveProperty('response_format');
    expect(build({ ...input, params: { ...input.params, svg_model: ' custom-writer ' } }).svg).toEqual({ model: 'custom-writer' });
    expect(build({ ...input, params: { output_format: 'svg', svg: { model: 'custom-writer' } } }).svg).toEqual({ model: 'custom-writer' });
    expect(build({ ...input, params: { ...input.params, gpt_image_26_output: 'auto' } })).not.toHaveProperty('svg');
    expect(build({ ...input, params: { ...input.params, background: 'transparent' } }).prompt).toBe(request.prompt);
  });

  it.each([gptImageAdapter, tuziGPTImageAdapter])('$id keeps SVG bytes and does not resubmit after a format mismatch', async (adapter) => {
    const input = { ...request, params: { gpt_image_26_output: 'svg' } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: svg, width: 80, height: 40 }] }), { status: 200 }));
    const result = await adapter.generateImage({ baseUrl: 'https://api.tu-zi.com/v1', fetcher }, input);
    expect(result).toMatchObject({ format: 'svg', url: `data:image/svg+xml;base64,${svg}` });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model, output_format: 'svg', svg: { model: 'gpt-5.5' }, stream: false });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('response_format');
    fetcher.mockClear().mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'https://example.com/result.png', width: 80, height: 40 }] }), { status: 200 }));
    await expect(adapter.generateImage({ baseUrl: 'https://api.tu-zi.com/v1', fetcher }, input)).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_FORMAT_MISMATCH', accepted: true, retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([gptImageAdapter, tuziGPTImageAdapter])('$id sends official GIF and preserves its media format', async (adapter) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: gif, width: 1, height: 1 }] }), { status: 200 }));
    const result = await adapter.generateImage({ baseUrl: 'https://api.tu-zi.com/v1', fetcher }, { ...request, params: { gpt_image_26_output: 'gif_official', frame_count: '9' } });
    expect(result.format).toBe('gif');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model, prompt: `${request.prompt}\n生成 GIF 图`, output_format: 'gif', frame_count: 9 });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('response_format');
  });

  it.each([gptImageAdapter, tuziGPTImageAdapter])('$id rejects SVG reference edits before requesting', async (adapter) => {
    const fetcher = vi.fn<typeof fetch>();
    for (const output of ['svg']) {
      await expect(adapter.generateImage({ baseUrl: 'https://api.tu-zi.com/v1', fetcher }, {
        ...request, referenceImages: ['https://example.com/ref.png'], params: { gpt_image_26_output: output },
      })).rejects.toThrow('当前仅接入文字生图');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it('keeps the 1k model on its documented prompt GIF route', () => {
  expect(() => normalizeGPTImage26Request({ model: 'gpt-image-2.6-1k', prompt: '猫', params: { gpt_image_26_output: 'svg' } })).toThrow('2.6-1k');
});
