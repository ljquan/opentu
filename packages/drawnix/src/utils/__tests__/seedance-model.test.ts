import { describe, expect, it } from 'vitest';
import {
  getSeedance2Capabilities,
  isSeedance2ModelId,
  isSeedance25ModelId,
  normalizeSeedanceRatio,
} from '../seedance-model';

describe('seedance model identifiers', () => {
  it('matches the supported 2.0 family and exact 2.5 model', () => {
    expect(isSeedance2ModelId('doubao-seedance-2-0-fast-260128')).toBe(true);
    expect(isSeedance2ModelId('doubao-seedance-2-5-260628')).toBe(true);
    expect(isSeedance25ModelId('doubao-seedance-2-5-260628')).toBe(true);
    expect(isSeedance2ModelId('doubao-seedance-2-6-260701')).toBe(false);
    expect(isSeedance2ModelId('seedance-1.5-pro')).toBe(false);
  });

  it('keeps version-specific capability boundaries', () => {
    expect(getSeedance2Capabilities('doubao-seedance-2-0-260128')).toMatchObject({
      minDuration: 4,
      maxDuration: 12,
      maxReferenceVideos: 3,
      maxReferenceAudios: 3,
      supportsAdvancedControls: true,
    });
    expect(getSeedance2Capabilities('doubao-seedance-2-5-260628')).toMatchObject({
      minDuration: 4,
      maxDuration: 30,
      maxReferenceImages: 30,
      maxReferenceVideos: 10,
      maxReferenceAudios: 10,
      supportsAdvancedControls: false,
    });
  });

  it('normalizes UI and legacy ratio spellings', () => {
    expect(normalizeSeedanceRatio(' 16x9 ')).toBe('16:9');
    expect(normalizeSeedanceRatio('16:9')).toBe('16:9');
    expect(normalizeSeedanceRatio('1280x720')).toBe('16:9');
    expect(normalizeSeedanceRatio('1920:1080')).toBe('16:9');
    expect(normalizeSeedanceRatio('720x1280')).toBe('9:16');
    expect(normalizeSeedanceRatio('1024x1024')).toBe('1:1');
    expect(normalizeSeedanceRatio('2560x1080')).toBe('21:9');
    expect(normalizeSeedanceRatio('5x3')).toBe('5:3');
    expect(normalizeSeedanceRatio('Auto')).toBe('adaptive');
    expect(normalizeSeedanceRatio('adaptive')).toBe('adaptive');
  });
});
