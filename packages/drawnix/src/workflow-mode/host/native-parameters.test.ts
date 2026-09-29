import { describe, expect, it } from 'vitest';
import {
  getAllBuiltInModelConfigs,
  getCompatibleParams,
} from '../../constants/model-config';
import {
  describeNativeModel,
  PARAMETER_CONSUMERS,
  applyNativeAdapterContract,
} from './native-parameters';
import { buildNativeModelCoverage } from './native-model-coverage';

describe('complete native catalog parameter coverage', () => {
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
