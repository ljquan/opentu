import { describe, expect, it } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';
import {
  clearImageGenerationAnchorRenderedSize,
  getImageGenerationAnchorRenderedRectangle as rectangle,
  setImageGenerationAnchorRenderedSize as measure,
} from '../image-generation-anchor-bounds';

describe('image anchor selection bounds', () => {
  it('follows expansion and collapse without changing the requested image geometry', () => {
    const board = { viewport: { zoom: 1 } } as PlaitBoard;
    const anchor = {
      id: 'a',
      points: [
        [10, 20],
        [330, 200],
      ],
    } as PlaitImageGenerationAnchor;
    measure(board, anchor.id, { width: 320, height: 480 });
    expect(rectangle(board, anchor)).toMatchObject({
      x: 10,
      y: 20,
      width: 320,
      height: 480,
    });
    board.viewport.zoom = 0.5;
    expect(rectangle(board, anchor).height).toBe(480);
    expect(anchor.points).toEqual([
      [10, 20],
      [330, 200],
    ]);
    measure(board, anchor.id, { width: 320, height: 180 });
    expect(rectangle(board, anchor).height).toBe(180);
  });

  it('uses the current position and clears stale measurements on removal', () => {
    const board = {} as PlaitBoard;
    const anchor = {
      id: 'a',
      points: [
        [100, 200],
        [420, 380],
      ],
    } as PlaitImageGenerationAnchor;
    measure(board, anchor.id, { width: 320, height: 500 });
    expect(rectangle(board, anchor)).toMatchObject({
      x: 100,
      y: 200,
      height: 500,
    });
    expect(rectangle({} as PlaitBoard, anchor).height).toBe(180);
    clearImageGenerationAnchorRenderedSize(board, anchor.id);
    expect(rectangle(board, anchor).height).toBe(180);
  });
});
