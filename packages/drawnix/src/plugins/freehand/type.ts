import { DEFAULT_COLOR, Point, ThemeColorMode } from '@plait/core';
import { PlaitCustomGeometry } from '@plait/draw';
import { BrushShape } from './freehand-settings';

export const FreehandThemeColors = {
  [ThemeColorMode.default]: {
      strokeColor: DEFAULT_COLOR,
      fill: '#FFFFFF'
  },
  [ThemeColorMode.colorful]: {
      strokeColor: '#06ADBF',
      fill: '#CDEFF2'
  },
  [ThemeColorMode.soft]: {
      strokeColor: '#6D89C1',
      fill: '#DADFEB'
  },
  [ThemeColorMode.retro]: {
      strokeColor: '#E9C358',
      fill: '#F6EDCF'
  },
  [ThemeColorMode.dark]: {
      strokeColor: '#FFFFFF',
      fill: '#434343'
  },
  [ThemeColorMode.starry]: {
      strokeColor: '#42ABE5',
      fill: '#163F5A'
  }
};

export enum FreehandShape {
  eraser = 'eraser',
  nibPen = 'nibPen',
  feltTipPen = 'feltTipPen',
  mask = 'mask',
  artisticBrush = 'artisticBrush',
  markerHighlight = 'markerHighlight',
  laserPointer = 'laserPointer',
}

export const FREEHAND_MASK_VISIBLE_OPACITY = 0.6;

export const FREEHAND_TYPE = 'freehand';

/**
 * 带压力信息的点
 */
export interface PressurePoint {
  point: Point;
  pressure: number; // 0-1 范围的压力值
}

export type Freehand = PlaitCustomGeometry<typeof FREEHAND_TYPE, Point[], FreehandShape> & {
  /** Image owning this mask stroke; geometry remains in board coordinates. */
  aiMaskTargetId?: string;
  /** 压力数据（与 points 一一对应） */
  pressures?: number[];
  /** 基准线宽 */
  strokeWidth?: number;
  /** 画笔形状（圆形/方形） */
  brushShape?: BrushShape;
};

export const Freehand = {
  isFreehand: (value: any): value is Freehand => {
    return value.type === FREEHAND_TYPE;
  },
};
