import { describe, expect, it, vi } from 'vitest';
import type { PlaitBoard, PlaitElement } from '@plait/core';
import { getCanvasTargetCenteringOrigination } from './canvas-target-centering';

vi.mock('@plait/core', () => ({
  getSelectedElements: (board: { children: PlaitElement[] }) => board.children,
  getRectangleByElements: (_board: unknown, elements: PlaitElement[]) => {
    const [start, end] = elements[0].points as [number[], number[]];
    return {
      x: start[0],
      y: start[1],
      width: end[0] - start[0],
      height: end[1] - start[1],
    };
  },
  PlaitBoard: {
    hasBeenTextEditing: (board: { editing?: boolean }) => !!board.editing,
    getBoardContainer: () => ({
      getBoundingClientRect: () => ({ width: 1000, height: 600 }),
    }),
  },
}));
vi.mock('../plugins/with-video', () => ({
  isVideoElement: (element: PlaitElement) => element.isVideo === true,
}));
vi.mock('../plugins/with-tool', () => ({
  isToolElement: (element: PlaitElement) => element.type === 'tool',
}));
vi.mock('../plugins/with-workzone', () => ({
  isWorkZoneElement: (element: PlaitElement) => element.type === 'workzone',
}));

const audio = {
  id: 'audio',
  type: 'audio',
  audioUrl: '/song.mp3',
  points: [
    [1200, 800],
    [1540, 928],
  ],
};
const board = (elements: unknown[] = [audio], zoom = 1, editing = false) =>
  ({
    children: elements,
    viewport: { zoom },
    editing,
  } as unknown as PlaitBoard);

describe('canvas target centering', () => {
  it('centers the audio card in the viewport at different zoom levels', () => {
    expect(getCanvasTargetCenteringOrigination(board())).toEqual([870, 564]);
    expect(getCanvasTargetCenteringOrigination(board([audio], 2))).toEqual([
      1120, 714,
    ]);
    expect(audio.points).toEqual([
      [1200, 800],
      [1540, 928],
    ]);
  });
  it.each([
    { type: 'image', url: '/image.png' },
    { type: 'image', isVideo: true, url: '/video.mp4' },
    { type: 'geometry', shape: 'text' },
    { type: 'card', title: 'text' },
  ])('centers other supported targets: $type', (fields) => {
    expect(
      getCanvasTargetCenteringOrigination(board([{ ...audio, ...fields }]))
    ).toEqual([870, 564]);
  });
  it('does not move for no selection, multiple targets, shapes or text editing', () => {
    expect(getCanvasTargetCenteringOrigination(board([]))).toBeNull();
    expect(
      getCanvasTargetCenteringOrigination(
        board([audio, { ...audio, id: 'second' }])
      )
    ).toBeNull();
    expect(
      getCanvasTargetCenteringOrigination(
        board([{ ...audio, type: 'geometry', shape: 'rectangle' }])
      )
    ).toBeNull();
    expect(
      getCanvasTargetCenteringOrigination(board([audio], 1, true))
    ).toBeNull();
    expect(getCanvasTargetCenteringOrigination(board([audio], 0))).toBeNull();
  });
});
