/**
 * 统一媒体预览系统 - 类型定义
 */

/** 媒体项 */
export interface MediaItem {
  /** 媒体 URL */
  url: string;
  /** 媒体类型 */
  type: 'image' | 'video' | 'audio';
  /** 可选的标题 */
  title?: string;
  /** 可选的描述 */
  alt?: string;
  /** 唯一标识（可选，用于追踪） */
  id?: string;
  /** 音频/视频封面 */
  posterUrl?: string;
  /** 媒体时长（秒） */
  duration?: number;
  /** 生成提示词 */
  prompt?: string;
  /** 音频风格标签 */
  tags?: string;
  /** 下载时显示的演唱者/作者 */
  artist?: string;
  /** 下载时显示的专辑 */
  album?: string;
}

/** 预览模式 */
export type ViewerMode = 'single' | 'compare' | 'edit';

/** 对比布局 */
export type CompareLayout = 'horizontal' | 'vertical' | 'grid';

/** 统一媒体预览组件 Props */
export interface UnifiedMediaViewerProps {
  /** 是否显示 */
  visible: boolean;
  /** 媒体列表 */
  items: MediaItem[];
  /** 初始模式 */
  initialMode?: ViewerMode;
  /** 初始索引（单图模式）或初始选中索引数组（对比模式） */
  initialIndex?: number | number[];
  /** 关闭回调 */
  onClose: () => void;
  /** 模式切换回调 */
  onModeChange?: (mode: ViewerMode) => void;
  /** 是否显示缩略图队列（单图模式下可选，默认 true） */
  showThumbnails?: boolean;
  /** 对比模式最大分屏数，默认 4 */
  maxCompareSlots?: 2 | 3 | 4;
  /** 默认对比布局 */
  defaultCompareLayout?: CompareLayout;
  /** 自定义类名 */
  className?: string;
  /** 是否显示标题 */
  showTitle?: boolean;
  /** 视频是否自动播放 */
  videoAutoPlay?: boolean;
  /** 视频是否循环播放 */
  videoLoop?: boolean;
  /** 插入到画布回调（传入则显示插入按钮） */
  onInsertToCanvas?: (item: MediaItem) => void;
  /** 编辑图片回调（传入则显示编辑按钮，外部处理编辑） */
  onEdit?: (item: MediaItem) => void;
  /** 是否使用内置编辑器（为 true 时点击编辑进入内置编辑模式） */
  useBuiltInEditor?: boolean;
  /** 编辑完成后覆盖原图回调 */
  onEditOverwrite?: (editedImageUrl: string, originalItem: MediaItem) => void;
  /** 编辑完成后插入新图片回调 */
  onEditInsert?: (editedImageUrl: string) => void;
  /** 是否显示覆盖选项（仅当编辑画布上已有图片时显示） */
  showEditOverwrite?: boolean;
}

/** 预览状态 */
export interface ViewerState {
  /** 当前模式 */
  mode: ViewerMode;
  /** 单图模式当前索引 */
  currentIndex: number;
  /** 对比模式各槽位索引 */
  compareIndices: number[];
  /** 对比布局 */
  compareLayout: CompareLayout;
  /** 同步模式（对比时同步缩放/拖拽） */
  syncMode: boolean;
  /** 缩放级别 */
  zoomLevel: number;
  /** 拖拽偏移 */
  panOffset: { x: number; y: number };
  /** 对比模式当前焦点槽位 */
  focusedSlot: number;
}

/** 预览操作 */
export interface ViewerActions {
  /** 切换模式 */
  setMode: (mode: ViewerMode) => void;
  /** 跳转到指定索引（单图模式） */
  goTo: (index: number) => void;
  /** 上一个 */
  goToPrev: () => void;
  /** 下一个 */
  goToNext: () => void;
  /** 添加到对比 */
  addToCompare: (index: number, slot?: number) => void;
  /** 从对比中移除 */
  removeFromCompare: (slot: number) => void;
  /** 交换槽位 */
  swapSlots: (slot1: number, slot2: number) => void;
  /** 设置对比布局 */
  setCompareLayout: (layout: CompareLayout) => void;
  /** 切换同步模式 */
  toggleSyncMode: () => void;
  /** 缩放 */
  zoom: (delta: number) => void;
  /** 设置拖拽偏移 */
  setPan: (offset: { x: number; y: number }) => void;
  /** 重置视图 */
  resetView: () => void;
  /** 设置焦点槽位 */
  setFocusedSlot: (slot: number) => void;
  /** 设置分屏数量 */
  setSlotCount: (count: 2 | 3 | 4) => void;
}

/** MediaViewport 暴露的方法（通过 ref） */
export interface MediaViewportRef {
  /** 重置视频进度到开始位置 */
  resetVideo: () => void;
  /** 播放视频 */
  playVideo: () => void;
  /** 暂停视频 */
  pauseVideo: () => void;
  /** 设置视频播放进度（秒） */
  setVideoTime: (time: number) => void;
  /** 获取视频当前时间（秒） */
  getVideoTime: () => number;
  /** 检查当前项是否为视频 */
  isVideo: () => boolean;
}

/** MediaViewport Props */
export interface MediaViewportProps {
  /** 媒体项 */
  item: MediaItem | null;
  /** 槽位索引（对比模式） */
  slotIndex?: number;
  /** 是否为焦点槽位 */
  isFocused?: boolean;
  /** 缩放级别 */
  zoomLevel?: number;
  /** 拖拽偏移 */
  panOffset?: { x: number; y: number };
  /** 点击回调 */
  onClick?: () => void;
  /** 关闭槽位回调（对比模式） */
  onClose?: () => void;
  /** 视频自动播放 */
  videoAutoPlay?: boolean;
  /** 视频循环 */
  videoLoop?: boolean;
  /** 缩放变化回调 */
  onZoomChange?: (zoom: number) => void;
  /** 拖拽变化回调 */
  onPanChange?: (offset: { x: number; y: number }) => void;
  /** 是否为对比模式（多图） */
  isCompareMode?: boolean;
  /** 插入到画布回调 */
  onInsertToCanvas?: () => void;
  /** 下载回调 */
  onDownload?: () => void;
  /** 编辑回调（仅图片） */
  onEdit?: () => void;
  /** 视频播放状态变化回调（联动模式下使用） */
  onVideoPlayStateChange?: (isPlaying: boolean) => void;
  /** 视频时间更新回调（联动模式下使用） */
  onVideoTimeUpdate?: (currentTime: number) => void;
  /** 是否为联动模式（用于视频同步） */
  isSyncMode?: boolean;
}

/** ThumbnailQueue Props */
export interface ThumbnailQueueProps {
  /** 所有媒体项 */
  items: MediaItem[];
  /** 当前模式 */
  mode: ViewerMode;
  /** 单图模式当前索引 */
  currentIndex: number;
  /** 对比模式选中的索引 */
  compareIndices: number[];
  /** 点击缩略图回调 */
  onThumbnailClick: (index: number) => void;
  /** 拖拽开始回调 */
  onDragStart?: (index: number) => void;
}

/** ViewerToolbar Props */
export interface ViewerToolbarProps {
  /** 当前模式 */
  mode: ViewerMode;
  /** 当前索引 */
  currentIndex: number;
  /** 总数 */
  totalCount: number;
  /** 对比分屏数 */
  slotCount: 2 | 3 | 4;
  /** 对比布局 */
  compareLayout: CompareLayout;
  /** 同步模式 */
  syncMode: boolean;
  /** 切换模式 */
  onModeChange: (mode: ViewerMode) => void;
  /** 设置分屏数 */
  onSlotCountChange: (count: 2 | 3 | 4) => void;
  /** 设置布局 */
  onLayoutChange: (layout: CompareLayout) => void;
  /** 切换同步 */
  onSyncToggle: () => void;
  /** 重置视图 */
  onResetView: () => void;
  /** 关闭 */
  onClose: () => void;
  /** 全屏 */
  onFullscreen?: () => void;
  /** 当前媒体项是否为图片（用于判断是否显示编辑按钮） */
  isImage?: boolean;
  /** 是否显示编辑按钮 */
  showEditButton?: boolean;
  /** 编辑模式：返回预览 */
  onBackToPreview?: () => void;
  /** 编辑模式：重置编辑 */
  onResetEdit?: () => void;
  /** 编辑模式：保存 */
  onSaveEdit?: () => void;
}
