import { describe, expect, it } from 'vitest';
import {
  getAllBuiltInModelConfigs,
  getCompatibleParams,
} from '../../constants/model-config';
import {
  describeNativeModel,
  PARAMETER_CONSUMERS,
  applyNativeAdapterContract,
  extendAdapterParameters,
} from './native-parameters';
import { buildNativeModelCoverage } from './native-model-coverage';
import { getVideoModelConfig } from '../../constants/video-model-config';
import { validateNativeReferences } from '../shared/native-parameters';

describe('complete native catalog parameter coverage', () => {
  it('exposes Tuzi generation output options without enabling edit fidelity', () => {
    const parameters = extendAdapterParameters([], 'tuzi-gpt-image-adapter');
    for (const id of [
      'output_format',
      'output_compression',
      'moderation',
      'user',
    ]) {
      expect(
        parameters.find((parameter) => parameter.id === id)?.disabledReason
      ).toBeUndefined();
      expect(parameters.find((parameter) => parameter.id === id)).toBeDefined();
    }
    expect(
      parameters.find((parameter) => parameter.id === 'input_fidelity')
    ).toBeUndefined();
  });
  it('aligns H3 reference inputs with OpenTu limits without discarding images', () => {
    const inputs = describeNativeModel('MiniMax-H3', 'video').referenceInputs!;
    expect(inputs.images?.maxCountWithoutVideos).toBe(
      getVideoModelConfig('MiniMax-H3').imageUpload.maxCount
    );
    expect(inputs.images?.maxCount).toBe(9);
    expect(inputs.videos).toEqual({
      maxCount: 3,
      formats: ['url', 'data', 'asset'],
    });
    expect(() => validateNativeReferences(inputs, {})).not.toThrow();
    expect(() =>
      validateNativeReferences(inputs, {
        images: [
          'https://example.test/first.png',
          'https://example.test/last.png',
        ],
      })
    ).not.toThrow();
    expect(() =>
      validateNativeReferences(inputs, {
        images: ['https://example.test/frame.png'],
        videos: [
          'https://example.test/a.mp4',
          'data:video/mp4;base64,AA==',
          '/asset-library/video.mov',
        ],
      })
    ).not.toThrow();
    expect(() =>
      validateNativeReferences(inputs, {
        images: [
          'https://example.test/1.png',
          'https://example.test/2.png',
          'https://example.test/3.png',
        ],
      })
    ).toThrow('最多支持 2 个');
    expect(() =>
      validateNativeReferences(inputs, {
        images: Array(9).fill('https://example.test/image.png'),
        videos: ['https://example.test/video.mp4'],
      })
    ).not.toThrow();
    expect(() =>
      validateNativeReferences(inputs, {
        images: Array(10).fill('https://example.test/image.png'),
        videos: ['https://example.test/video.mp4'],
      })
    ).toThrow('最多支持 9 个');
    expect(() =>
      validateNativeReferences(inputs, {
        videos: Array(4).fill('https://example.test/video.mp4'),
      })
    ).toThrow('最多支持 3 个');
    expect(() =>
      validateNativeReferences(inputs, {
        audios: ['https://example.test/audio.mp3'],
      })
    ).toThrow();
  });
  it('reports actual adapter limitations rather than claiming generic parameter forwarding', () => {
    const gpt = describeNativeModel('gpt-image-2', 'image').parameters!;
    const compatibility = applyNativeAdapterContract(
      gpt,
      'image',
      'gemini-image-adapter'
    );
    expect(
      compatibility.find((parameter) => parameter.id === 'quality')
        ?.disabledReason
    ).toBeTruthy();
    expect(
      compatibility.find((parameter) => parameter.id === 'resolution')
        ?.disabledReason
    ).toBeUndefined();
    expect(
      applyNativeAdapterContract(gpt, 'image', 'gpt-image-adapter').every(
        (parameter) => !parameter.disabledReason
      )
    ).toBe(true);
    const async = applyNativeAdapterContract(
      gpt,
      'image',
      'gemini-image-adapter',
      'openai.async.image.form'
    );
    expect(
      async
        .filter((parameter) => !parameter.disabledReason)
        .map((parameter) => parameter.id)
    ).toEqual(['size']);
  });
  it.each(
    getAllBuiltInModelConfigs().map((model) => [model.id, model.type] as const)
  )('%s has every declared field and a request consumer', (id, capability) => {
    const metadata = describeNativeModel(id, capability);
    for (const parameter of getCompatibleParams(id)) {
      expect(
        metadata.parameters?.find((item) => item.id === parameter.id)
      ).toBeDefined();
      expect(PARAMETER_CONSUMERS[capability][parameter.id]).toBeTruthy();
    }
    expect(
      new Set(metadata.parameters?.map((parameter) => parameter.id)).size
    ).toBe(metadata.parameters?.length);
    for (const parameter of metadata.parameters || [])
      expect(PARAMETER_CONSUMERS[capability][parameter.id]).toBeTruthy();
  });
  it('keeps H3 values independent from Seedance and rejects invented dynamic defaults', () => {
    expect(
      describeNativeModel('MiniMax-H3', 'video')
        .parameters?.find((item) => item.id === 'size')
        ?.options?.map((item) => item.value)
    ).toEqual(['768P', '2K']);
    expect(describeNativeModel('private-video', 'video').parameters).toEqual(
      []
    );
    expect(
      describeNativeModel('private-video', 'video').referenceInputs
    ).toEqual({});
  });
  it('accounts for every hidden or visible built-in even without a route', () => {
    const coverage = buildNativeModelCoverage({
      channels: [],
      defaults: { image: '', video: '', text: '', audio: '' },
      warnings: [],
    });
    expect(coverage).toHaveLength(getAllBuiltInModelConfigs().length);
    expect(coverage.every((entry) => entry.status === 'unconfigured')).toBe(
      true
    );
    expect(coverage.some((entry) => entry.modelId === 'sora-2')).toBe(true);
    expect(
      coverage.flatMap((entry) => Object.values(entry.consumers))
    ).not.toContain('UNMAPPED');
  });
});
