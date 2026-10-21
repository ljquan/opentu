import { describe, expect, it } from 'vitest';
import {
  imageResizeDimensions,
  imageSplitCuts,
  buildImageAnglePrompt,
} from './canvas-image-tools';
import { getLegacyCanvasReturnUrl } from './legacy-canvas-location';

describe('consolidated image tools', () => {
  it('keeps portrait and landscape output proportional', () => {
    expect(imageResizeDimensions(1200, 800, 2400)).toEqual({
      width: 2400,
      height: 1600,
    });
    expect(imageResizeDimensions(800, 1200, 2400)).toEqual({
      width: 1600,
      height: 2400,
    });
    expect(() => imageResizeDimensions(0, 800, 2400)).toThrow();
    expect(() => imageResizeDimensions(800, 800, Infinity)).toThrow();
  });
  it('uses distinct pixel cuts without missing edge pixels', () => {
    expect(imageSplitCuts('75,25,25', 101)).toEqual([0, 25, 76, 101]);
    expect(imageSplitCuts('1,2,50,99', 2)).toEqual([0, 1, 2]);
    expect(imageSplitCuts('', 100)).toEqual([0, 100]);
    expect(() => imageSplitCuts('10,what', 100)).toThrow();
    expect(() => imageSplitCuts('100', 100)).toThrow();
  });
  it('prepares new-view instructions and rejects invalid values', () => {
    expect(
      buildImageAnglePrompt({
        horizontal: -20,
        pitch: 10,
        distance: 5,
        wide: true,
      })
    ).toContain('广角');
    expect(() =>
      buildImageAnglePrompt({
        horizontal: NaN,
        pitch: 10,
        distance: 5,
        wide: false,
      })
    ).toThrow();
  });
});
describe('retired route bookmarks', () => {
  it.each(['/workflow', '/workflow/canvas/old', '/workflow/config'])(
    'returns %s to canvas with recovery access',
    (path) => {
      expect(getLegacyCanvasReturnUrl(`https://example.test${path}`)).toBe(
        '/?legacyData=1'
      );
    }
  );
  it('preserves explicit board selection but not legacy project IDs or hashes', () => {
    expect(
      getLegacyCanvasReturnUrl(
        'https://example.test/workflow/canvas/old?board=one#old'
      )
    ).toBe('/?board=one&legacyData=1');
  });
  it.each(['/workflower', '/', '/?board=one'])(
    'does not intercept %s',
    (path) => {
      expect(
        getLegacyCanvasReturnUrl(`https://example.test${path}`)
      ).toBeNull();
    }
  );
});
