import { describe, expect, it } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { getWorkZoneVisualRectangle, setWorkZoneRenderedSize, clearWorkZoneRenderedSize } from './workzone-transforms';
import type { PlaitWorkZone } from '../types/workzone.types';

function createWorkZone(zoom: number): PlaitWorkZone {
  return {
    id: 'workzone-1',
    type: 'workzone',
    points: [
      [10, 20],
      [370, 260],
    ],
    angle: 0,
    createdAt: Date.now(),
    zoom,
    workflow: {
      id: 'workflow-1',
      name: '生成 PPT 大纲',
      generationType: 'text',
      prompt: '生成 PPT 大纲',
      count: 1,
      steps: [],
    },
    children: [],
  };
}

describe('getWorkZoneVisualRectangle', () => {
  it('expands the hit rectangle to match scaled content when zoomed out', () => {
    expect(getWorkZoneVisualRectangle(createWorkZone(0.5))).toMatchObject({
      x: 10,
      y: 20,
      width: 720,
      height: 480,
    });
  });

  it('shrinks the hit rectangle to match scaled content when zoomed in', () => {
    expect(getWorkZoneVisualRectangle(createWorkZone(2))).toMatchObject({
      x: 10,
      y: 20,
      width: 180,
      height: 120,
    });
  });
});

it('measures expanded diagnostics before element scaling and clears stale sizes', () => {
  const board = {} as PlaitBoard;
  const zone = createWorkZone(.5);
  setWorkZoneRenderedSize(board, zone.id, {width:360,height:420});
  expect(getWorkZoneVisualRectangle(zone, board)).toMatchObject({width:720,height:840});
  expect(zone.points).toEqual([[10,20],[370,260]]);
  expect(getWorkZoneVisualRectangle(zone, {} as PlaitBoard).height).toBe(480);
  clearWorkZoneRenderedSize(board, zone.id);
  expect(getWorkZoneVisualRectangle(zone, board).height).toBe(480);
});
