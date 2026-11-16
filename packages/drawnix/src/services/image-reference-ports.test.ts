import { describe, expect, it, vi } from 'vitest';
import { getAutoCompletePoints } from '@plait/draw';
import {
  getImageReferencePorts,
  hitImageReferencePort,
} from './image-reference-ports';
vi.mock('@plait/draw', () => ({ getAutoCompletePoints: vi.fn() }));
describe('image connection controls', () => {
  it('keeps the hit area usable beyond the visible circle at every zoom', () => {
    for (const zoom of [0.4, 1, 2]) {
      vi.mocked(getAutoCompletePoints).mockReturnValue([
        [50 * zoom, -16],
        [100 * zoom + 16, 50 * zoom],
        [50 * zoom, 100 * zoom + 16],
        [-16, 50 * zoom],
      ]);
      const ports = getImageReferencePorts(
        { viewport: { zoom } } as any,
        {} as any
      );
      ports.forEach((point, index) => {
        expect(hitImageReferencePort([point[0] + 20, point[1]], ports)).toBe(
          index
        );
        expect(hitImageReferencePort([point[0] + 23, point[1]], [point])).toBe(
          -1
        );
      });
      expect(ports[0][0] - 100 * zoom).toBe(24);
      expect(ports[2][0]).toBe(-24);
    }
  });
});
