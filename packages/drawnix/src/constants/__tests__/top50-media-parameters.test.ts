import { describe, expect, it } from 'vitest';
import { getCompatibleParams, getModelConfig } from '../model-config';

const images = [
  'gpt-image-2.5-sunburst',
  'gemini-3.1-flash-image-preview',
  'gpt-image-2.5-flare',
  'gpt-image-2',
  'gemini-3-pro-image-preview',
  'gpt-image-2.5',
  'gemini-3-pro-image-preview-4k',
  'gpt-image-2-1k',
  'gemini-2.5-flash-image-vip',
  'gpt-image-2-vip',
  'gemini-3-pro-image-preview-2k',
  'gemini-3.1-flash-image',
  'gpt-image-2.5-1k',
  'nano-banana-2',
  'gpt-image-2.5-vip',
  'gemini-3.1-flash-image-preview-4k',
  'doubao-seedream-5-0-260128',
  'nano-banana',
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview-2k',
  'gemini-3-pro-image',
];
const videos = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-5-260628',
  'MiniMax-H3',
  'veo3.1',
  'doubao-seedance-2-0-fast-260128',
];

describe('scoped Top 50 media model coverage', () => {
  it('withdraws new watermark controls while preserving the existing Seedance 2.5 control', () => {
    for (const id of ['doubao-seedream-5-0-260128', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'MiniMax-H3']) {
      expect(getCompatibleParams(id).map(param => param.id)).not.toContain('watermark');
      expect(getCompatibleParams(id).map(param => param.id)).not.toContain('aigc_watermark');
    }
    expect(getCompatibleParams('doubao-seedance-2-5-260628').map(param => param.id)).toContain('watermark');
  });
  it.each(images)(
    'resolves exact image identity and a size contract for %s',
    (id) => {
      if (id === 'gpt-image-2-1k') {
        expect(getModelConfig(id)).toBeUndefined();
        expect(getCompatibleParams(id)).toEqual([]);
        return;
      }
      expect(getModelConfig(id)).toMatchObject({ id, type: 'image' });
      const parameters = getCompatibleParams(id);
      expect(parameters.some((parameter) => parameter.id === 'size')).toBe(
        true
      );
      expect(new Set(parameters.map((parameter) => parameter.id)).size).toBe(
        parameters.length
      );
    }
  );
  it.each(videos)(
    'resolves exact video identity and baseline controls for %s',
    (id) => {
      expect(getModelConfig(id)).toMatchObject({ id, type: 'video' });
      const parameters = getCompatibleParams(id);
      expect(parameters.map((parameter) => parameter.id)).toEqual(
        expect.arrayContaining(['duration', 'size'])
      );
      expect(new Set(parameters.map((parameter) => parameter.id)).size).toBe(
        parameters.length
      );
    }
  );
});
