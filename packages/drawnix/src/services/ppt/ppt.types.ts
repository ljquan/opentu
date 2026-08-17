/**
 * PPT 生成相关类型定义
 */

import type { ModelRef } from '../../utils/settings-manager';

/** PPT 页面版式类型 */
export type PPTLayoutType =
  | 'cover' // 封面页：大标题居中 + 副标题
  | 'toc' // 目录页：标题 + 目录列表
  | 'title-body' // 标题正文页：标题 + 要点列表
  | 'image-text' // 图文页：文字与视觉元素结合
  | 'comparison' // 对比页：左右对比
  | 'ending'; // 结尾页：结束语居中

/** PPT 页面规格（AI 生成的大纲中每页的描述） */
export interface PPTPageSpec {
  /** 页面版式类型 */
  layout: PPTLayoutType;
  /** 页面标题 */
  title: string;
  /** 副标题（封面页、结尾页使用） */
  subtitle?: string;
  /** 正文要点列表 */
  bullets?: string[];
  /** 视觉提示词（兼容旧配图字段） */
  imagePrompt?: string;
  /** 演讲者备注 */
  notes?: string;
}

/** PPT 全局风格规格：每页共用，避免整套 PPT 视觉漂移 */
export interface PPTStyleSpec {
  /** 整体视觉风格 */
  visualStyle: string;
  /** 主色、背景色、强调色等色板规则 */
  colorPalette: string;
  /** 字体气质与层级规则 */
  typography: string;
  /** 网格、留白、组件复用等布局规则 */
  layout: string;
  /** 可复用装饰元素或视觉母题 */
  decorativeElements: string;
  /** 需要避免的风格漂移项 */
  avoid?: string;
}

/** PPT 大纲（AI 生成的完整大纲结构） */
export interface PPTOutline {
  /** PPT 总标题 */
  title: string;
  /** 整套 PPT 共用的风格规格 */
  styleSpec?: PPTStyleSpec;
  /** 所有页面规格 */
  pages: PPTPageSpec[];
}

/** PPT 生成页数选项 */
export type PPTPageCountOption = 'short' | 'normal' | 'long';

/** PPT 生成选项 */
export interface PPTGenerateOptions {
  /** 页数控制：short(5-7页), normal(8-12页), long(13-18页) */
  pageCount?: PPTPageCountOption;
  /** 输出语言 */
  language?: string;
  /** 额外要求 */
  extraRequirements?: string;
  /** 参考图片 URL 列表（仅保存轻量 URL，不保存 base64 大图） */
  referenceImages?: string[];
}

/** Frame 上的 PPT 扩展元数据 */
export interface PPTSlideImageHistoryItem {
  /** 历史记录 ID */
  id: string;
  /** 生成图片 URL（不存 base64 大图） */
  imageUrl: string;
  /** 关联图片元素 ID（如果图片仍在画布中） */
  elementId?: string;
  /** 本次生成使用的提示词 */
  prompt?: string;
  /** 记录创建时间 */
  createdAt: number;
  /** 来源标记 */
  source?: 'agent' | 'manual' | 'regenerate';
}

export type PPTSlideTransitionType =
  | 'none'
  | 'fade'
  | 'push'
  | 'wipe'
  | 'split'
  | 'cover'
  | 'uncover';

export interface PPTSlideTransition {
  type: PPTSlideTransitionType;
  durationMs?: number;
}

export interface PPTFrameMeta {
  /** Owning PPT explainer draft. Omitted for regular PPT generation. */
  pptExplainerJobId?: string;
  /** PPT 总标题，用于大纲标题输入和导出文件名 */
  deckTitle?: string;
  /** 旧视觉提示词（兼容旧数据，整页提示词优先使用 slidePrompt） */
  imagePrompt?: string;
  /** 旧图片状态（兼容旧数据，整页状态优先使用 slideImageStatus） */
  imageStatus?: 'placeholder' | 'loading' | 'generated' | 'failed';
  /** 整页幻灯片生成提示词（优先于旧 imagePrompt） */
  slidePrompt?: string;
  /** 整套 PPT 共用的风格规格 */
  styleSpec?: PPTStyleSpec;
  /** 整套 PPT 共用的公共提示词（轻量文本，不存图片/base64） */
  commonPrompt?: string;
  /** 整套 PPT 的参考图片 URL（轻量 URL，不保存 base64 大图） */
  referenceImages?: string[];
  /** 当前整页幻灯片图片 URL */
  slideImageUrl?: string;
  /** 当前整页幻灯片图片元素 ID */
  slideImageElementId?: string;
  /** 整页幻灯片图片状态 */
  slideImageStatus?: 'placeholder' | 'loading' | 'generated' | 'failed';
  /** 整页幻灯片生图历史（仅保存轻量 URL/提示词/元素 ID） */
  slideImageHistory?: PPTSlideImageHistoryItem[];
  /** 页面切换转场动画 */
  transition?: PPTSlideTransition;
  /** 页面版式类型 */
  layout?: PPTLayoutType;
  /** 演讲者备注 */
  notes?: string;
  /** 页面索引（从 1 开始） */
  pageIndex?: number;
  /** 旧背景图 URL（兼容旧数据） */
  backgroundUrl?: string;
  /** 旧背景图提示词（兼容旧数据） */
  backgroundPrompt?: string;
}

/** 布局引擎输出：单个文本元素的位置和样式 */
export interface LayoutElement {
  /** 元素类型 */
  type: 'title' | 'subtitle' | 'body' | 'bullet';
  /** 文本内容 */
  text: string;
  /** 相对于 Frame 左上角的偏移坐标 [x, y] */
  point: [number, number];
  /** 字体大小等级 */
  fontSize?: 'large' | 'medium' | 'small';
  /** 文本对齐方式 */
  align?: 'left' | 'center' | 'right';
}

/** Frame 矩形信息 */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** generate_ppt MCP 工具参数 */
export interface PPTGenerationParams {
  /** PPT 主题或内容描述 */
  topic: string;
  /** 页数控制 */
  pageCount?: PPTPageCountOption;
  /** 输出语言 */
  language?: string;
  /** 额外要求 */
  extraRequirements?: string;
  /** PPT 大纲生成文本模型 */
  textModel?: string;
  /** PPT 大纲生成文本模型来源 */
  textModelRef?: ModelRef | null;
  /** 兼容旧版 Agent 注入的文本模型字段 */
  model?: string;
  /** 兼容 Agent 媒体模型注入的模型来源字段 */
  modelRef?: ModelRef | null;
  /** 参考图片 URL 列表，用于规划配图和后续 PPT 生图参考 */
  referenceImages?: string[];
}

// ============================================
// 思维导图转 PPT 相关类型
// ============================================

/** 思维导图节点信息（用于转换） */
export interface MindmapNodeInfo {
  /** 节点文本内容 */
  text: string;
  /** 子节点列表 */
  children: MindmapNodeInfo[];
  /** 节点深度（根节点为 0） */
  depth: number;
}

/** 思维导图转 PPT 选项 */
export interface MindmapToPPTOptions {
  /** 是否生成目录页，默认 true */
  includeToc?: boolean;
  /** 结尾页文案，默认"谢谢观看" */
  endingTitle?: string;
  /** 结尾页副标题 */
  endingSubtitle?: string;
}

/** 思维导图转 PPT 结果 */
export interface MindmapToPPTResult {
  /** 是否成功 */
  success: boolean;
  /** 生成的页面数量 */
  pageCount?: number;
  /** 错误信息 */
  error?: string;
}
