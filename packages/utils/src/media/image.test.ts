/**
 * Image Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  getCompressionStrategy,
  isBorderColor,
  isBackgroundPixel,
  isWhiteBorderPixel,
  parsePixelSize,
} from './image';

describe('getCompressionStrategy', () => {
  it('should return no compression for files < 10MB', () => {
    const strategy = getCompressionStrategy(5);
    expect(strategy.shouldCompress).toBe(false);
  });

  it('should return medium strategy for 10-15MB files', () => {
    const strategy = getCompressionStrategy(12);
    expect(strategy.shouldCompress).toBe(true);
    expect(strategy.targetSizeMB).toBe(5);
    expect(strategy.initialQuality).toBe(0.8);
  });

  it('should return large strategy for 15-20MB files', () => {
    const strategy = getCompressionStrategy(17);
    expect(strategy.shouldCompress).toBe(true);
    expect(strategy.targetSizeMB).toBe(3);
    expect(strategy.initialQuality).toBe(0.7);
  });

  it('should return veryLarge strategy for 20-25MB files', () => {
    const strategy = getCompressionStrategy(22);
    expect(strategy.shouldCompress).toBe(true);
    expect(strategy.targetSizeMB).toBe(2);
    expect(strategy.initialQuality).toBe(0.6);
  });

  it('should return no compression for files > 25MB (caller handles)', () => {
    const strategy = getCompressionStrategy(30);
    expect(strategy.shouldCompress).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(getCompressionStrategy(10).shouldCompress).toBe(true);
    expect(getCompressionStrategy(15).shouldCompress).toBe(true);
    expect(getCompressionStrategy(20).shouldCompress).toBe(true);
    expect(getCompressionStrategy(25).shouldCompress).toBe(true);
  });
});

describe('isBorderColor', () => {
  it('should detect white pixels', () => {
    expect(isBorderColor(255, 255, 255)).toBe(true);
    expect(isBorderColor(240, 240, 240)).toBe(true);
    expect(isBorderColor(230, 230, 230)).toBe(true);
  });

  it('should detect gray pixels', () => {
    expect(isBorderColor(200, 200, 200)).toBe(true);
    expect(isBorderColor(180, 180, 180)).toBe(true);
  });

  it('should detect black pixels', () => {
    expect(isBorderColor(0, 0, 0)).toBe(true);
    expect(isBorderColor(5, 5, 5)).toBe(true);
  });

  it('should detect transparent pixels', () => {
    expect(isBorderColor(100, 100, 100, { alpha: 50 })).toBe(true);
    expect(isBorderColor(100, 100, 100, { alpha: 0 })).toBe(true);
  });

  it('should reject colored pixels', () => {
    expect(isBorderColor(255, 0, 0)).toBe(false); // Red
    expect(isBorderColor(0, 255, 0)).toBe(false); // Green
    expect(isBorderColor(0, 0, 255)).toBe(false); // Blue
    expect(isBorderColor(100, 150, 200)).toBe(false); // Mixed color
  });

  it('should respect custom thresholds', () => {
    expect(isBorderColor(200, 200, 200, { whiteThreshold: 250 })).toBe(true); // Still gray
    expect(isBorderColor(220, 220, 220, { whiteThreshold: 210 })).toBe(true); // Above white threshold
  });
});

describe('isBackgroundPixel', () => {
  it('should detect light gray pixels', () => {
    expect(isBackgroundPixel(200, 200, 200)).toBe(true);
    expect(isBackgroundPixel(220, 220, 220)).toBe(true);
    expect(isBackgroundPixel(255, 255, 255)).toBe(true);
  });

  it('should reject dark pixels', () => {
    expect(isBackgroundPixel(100, 100, 100)).toBe(false);
    expect(isBackgroundPixel(50, 50, 50)).toBe(false);
  });

  it('should reject colored pixels', () => {
    expect(isBackgroundPixel(200, 100, 100)).toBe(false);
    expect(isBackgroundPixel(200, 200, 100)).toBe(false);
  });

  it('should respect custom thresholds', () => {
    expect(isBackgroundPixel(150, 150, 150, { minGray: 140 })).toBe(true);
    expect(isBackgroundPixel(150, 150, 150, { minGray: 160 })).toBe(false);
  });
});

describe('isWhiteBorderPixel', () => {
  it('should detect white pixels', () => {
    expect(isWhiteBorderPixel(255, 255, 255)).toBe(true);
    expect(isWhiteBorderPixel(250, 250, 250)).toBe(true);
    expect(isWhiteBorderPixel(245, 245, 245)).toBe(true);
  });

  it('should reject non-white pixels', () => {
    expect(isWhiteBorderPixel(240, 240, 240)).toBe(false);
    expect(isWhiteBorderPixel(200, 200, 200)).toBe(false);
  });

  it('should respect custom threshold', () => {
    expect(isWhiteBorderPixel(240, 240, 240, 235)).toBe(true);
    expect(isWhiteBorderPixel(230, 230, 230, 225)).toBe(true);
  });
});

describe('parsePixelSize', () => {
  it('parses pixel size tokens', () => {
    expect(parsePixelSize('1280x720')).toEqual({ width: 1280, height: 720 });
    expect(parsePixelSize(' 720X1280 ')).toEqual({
      width: 720,
      height: 1280,
    });
  });

  it('returns null for ratio strings and invalid values', () => {
    expect(parsePixelSize('16:9')).toBeNull();
    expect(parsePixelSize('auto')).toBeNull();
    expect(parsePixelSize('')).toBeNull();
  });
});

// Note: loadImage, createCanvasFromImage, compressImageBlob, trimBorders, etc.
// require DOM environment and are better tested in E2E tests
