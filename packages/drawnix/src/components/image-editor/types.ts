/**
 * 图片编辑器 - 类型定义
 */

/** 裁剪区域 */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 裁剪比例预设 */
export interface AspectRatioPreset {
  label: string;
  value: number | null; // null 表示自由裁剪
}

/** 滤镜类型 */
export type FilterType =
  | 'none'
  | 'grayscale'
  | 'sepia'
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'saturate'
  | 'hue-rotate'
  | 'invert'
  | 'vintage'
  | 'cold'
  | 'warm';

/** 滤镜预设 */
export interface FilterPreset {
  label: string;
  type: FilterType;
  /** CSS filter 字符串 */
  filter: string;
  /** 预览缩略图的样式 */
  thumbnail?: string;
}

/** 滤镜参数 */
export interface FilterParams {
  brightness: number; // 0-200, 默认 100
  contrast: number; // 0-200, 默认 100
  saturate: number; // 0-200, 默认 100
  blur: number; // 0-10, 默认 0
  grayscale: number; // 0-100, 默认 0
  sepia: number; // 0-100, 默认 0
  hueRotate: number; // 0-360, 默认 0
  invert: number; // 0-100, 默认 0
}

/** 编辑模式 */
export type EditMode = 'crop' | 'filter';

/** 图片编辑器状态 */
export interface ImageEditorState {
  /** 当前编辑模式 */
  mode: EditMode;
  /** 裁剪区域 */
  cropArea: CropArea | null;
  /** 裁剪比例 */
  aspectRatio: number | null;
  /** 滤镜类型 */
  filterType: FilterType;
  /** 滤镜参数 */
  filterParams: FilterParams;
  /** 旋转角度 */
  rotation: number;
  /** 水平翻转 */
  flipH: boolean;
  /** 垂直翻转 */
  flipV: boolean;
}

/** 保存操作类型 */
export type SaveAction = 'overwrite' | 'insert' | 'download';

/** 图片编辑器 Props */
export type ResizeImageHandler = (
  options: import('../../services/canvas-operations/resize-canvas-image').ImageResizeOptions,
  onStage: (
    stage: import('../../services/canvas-operations/resize-canvas-image').ImageResizeStage
  ) => void,
  signal: AbortSignal
) => Promise<{ width: number; height: number }>;

export interface ImageEditorProps {
  /** 是否显示 */
  visible: boolean;
  /** 图片 URL */
  imageUrl: string;
  /** 关闭回调 */
  onClose: () => void;
  /** 保存回调（编辑后的图片 URL，通用回调） */
  onSave?: (editedImageUrl: string) => void;
  /** 覆盖原图回调 */
  onOverwrite?: (editedImageUrl: string) => void;
  /** 插入到画布回调 */
  onInsert?: (editedImageUrl: string) => void;
  /** 将拆分结果作为多张新图片插入画布 */
  onSplit?: (images: string[]) => Promise<void>;
  onResize?: ResizeImageHandler;
  /** 元素 ID（用于更新画布中的图片） */
  elementId?: string;
  /** 是否显示覆盖选项（仅当编辑画布上已有图片时显示） */
  showOverwrite?: boolean;
}

/** 默认滤镜参数 */
export const DEFAULT_FILTER_PARAMS: FilterParams = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
  invert: 0,
};

/** 裁剪比例预设列表 */
export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
];

/** 滤镜预设列表 */
export const FILTER_PRESETS: FilterPreset[] = [
  { label: '原图', type: 'none', filter: 'none' },
  { label: '黑白', type: 'grayscale', filter: 'grayscale(100%)' },
  { label: '怀旧', type: 'sepia', filter: 'sepia(80%)' },
  {
    label: '复古',
    type: 'vintage',
    filter: 'sepia(40%) contrast(110%) brightness(90%)',
  },
  {
    label: '冷色',
    type: 'cold',
    filter: 'saturate(80%) hue-rotate(180deg) brightness(105%)',
  },
  {
    label: '暖色',
    type: 'warm',
    filter: 'saturate(120%) sepia(20%) brightness(105%)',
  },
  { label: '高对比', type: 'contrast', filter: 'contrast(150%)' },
  { label: '高饱和', type: 'saturate', filter: 'saturate(180%)' },
  { label: '反转', type: 'invert', filter: 'invert(100%)' },
];
