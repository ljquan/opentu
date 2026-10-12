import { describe, expect, it } from 'vitest';
import type { PlaitBoard, Point } from '@plait/core';
import {
  getRetainedTaskCardRectangles,
  occupiesGenerationPlacement,
  placeBelowRetainedTaskCards,
} from './generation-task-placement';

const card = (x: number, y: number, status = 'failed', zoom = 1) => ({
  type: 'workzone',
  workflow: { status },
  points: [
    [x, y],
    [x + 360, y + 240],
  ] as [Point, Point],
  zoom,
});
const board = (children: unknown[]) => ({ children } as unknown as PlaitBoard);
const size = { width: 360, height: 240 };

describe('generation task placement', () => {
  it('counts failed/cancelled cards and step failures, while ignoring active cards', () => {
    expect(occupiesGenerationPlacement({ type: 'audio' })).toBe(true);
    expect(occupiesGenerationPlacement(card(0, 0))).toBe(true);
    expect(occupiesGenerationPlacement(card(0, 0, 'cancelled'))).toBe(true);
    expect(
      occupiesGenerationPlacement({
        type: 'workzone',
        workflow: { steps: [{ status: 'failed' }] },
      })
    ).toBe(true);
    expect(occupiesGenerationPlacement(card(0, 0, 'running'))).toBe(false);
    expect(occupiesGenerationPlacement(card(0, 0, 'completed'))).toBe(false);
  });
  it('puts the next submission below a failed card at the old insertion position', () => {
    expect(
      placeBelowRetainedTaskCards(board([card(100, 200)]), [100, 200], size)
    ).toEqual([100, 490]);
  });
  it('resolves multiple retained cards regardless of their order', () => {
    expect(
      placeBelowRetainedTaskCards(
        board([card(100, 490), card(100, 200)]),
        [100, 200],
        size
      )
    ).toEqual([100, 780]);
  });
  it('uses both old and new visual sizes at non-default zoom', () => {
    expect(
      placeBelowRetainedTaskCards(
        board([card(600, 200, 'failed', 0.5)]),
        [100, 200],
        size,
        50,
        0.5
      )
    ).toEqual([100, 730]);
  });
  it('keeps positions free when the new card is visually smaller at higher zoom', () => {
    expect(
      placeBelowRetainedTaskCards(
        board([card(400, 200)]),
        [100, 200],
        size,
        50,
        2
      )
    ).toEqual([100, 200]);
  });
  it.each([0, -1, NaN, Infinity])(
    'falls back to unit scale for invalid zoom %s',
    (zoom) => {
      expect(
        placeBelowRetainedTaskCards(
          board([card(100, 200, 'failed', zoom)]),
          [100, 200],
          size,
          50,
          zoom
        )
      ).toEqual([100, 490]);
    }
  );
  it('reads visual geometry without depending on the board rectangle adapter', () => {
    const taskBoard = board([card(100, 200, 'failed', 0.5)]);
    taskBoard.getRectangle = () => {
      throw new Error('unavailable adapter');
    };
    expect(getRetainedTaskCardRectangles(taskBoard)).toEqual([
      { x: 100, y: 200, width: 720, height: 480 },
    ]);
  });

  it('preserves unrelated positions and ignores active cards', () => {
    expect(
      placeBelowRetainedTaskCards(board([card(600, 200)]), [100, 200], size)
    ).toEqual([100, 200]);
    expect(
      placeBelowRetainedTaskCards(
        board([card(100, 200, 'running')]),
        [100, 200],
        size
      )
    ).toEqual([100, 200]);
    expect(
      placeBelowRetainedTaskCards(board([card(100, 200)]), [100, 490], size)
    ).toEqual([100, 490]);
  });
});
