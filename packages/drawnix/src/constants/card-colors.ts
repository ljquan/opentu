/**
 * Card 标签贴颜色常量
 *
 * 预设调色板：6 种主色，每种主色对应深色标题区和浅色正文区
 */

/** 预设调色板（主色） */
export const CARD_PALETTE: string[] = [
  '#4A90D9', // 蓝色
  '#7B68EE', // 紫色
  '#52C41A', // 绿色
  '#FA8C16', // 橙色
  '#F5222D', // 红色
  '#13C2C2', // 青色
];

/** Card 默认宽度（像素） */
export const CARD_DEFAULT_WIDTH = 240;

/** Card 标题区高度（像素） */
export const CARD_TITLE_HEIGHT = 44;

/** Card 默认标题 */
export const CARD_DEFAULT_TITLE = '无标题';

/** Card 正文区最小高度（像素） */
export const CARD_BODY_MIN_HEIGHT = 80;

/** Card 正文区最大高度（像素），超出后正文区可滚动 */
export const CARD_BODY_MAX_HEIGHT = 400;

/** Card 圆角半径 */
export const CARD_BORDER_RADIUS = 8;

/** Card 内边距 */
export const CARD_PADDING = 12;

/** Card 标题字体大小 */
export const CARD_TITLE_FONT_SIZE = 14;

/** Card 正文字体大小 */
export const CARD_BODY_FONT_SIZE = 13;

/** Card 行高 */
export const CARD_LINE_HEIGHT = 20;

/**
 * 根据主色生成标题区颜色（深色调）
 */
export function getTitleColor(fillColor: string): string {
  return fillColor;
}

/**
 * 根据主色生成正文区颜色（浅色调，20% 透明度）
 */
export function getBodyColor(fillColor: string): string {
  // 将十六进制颜色转为 rgba，透明度 0.12
  const hex = fillColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

/**
 * 根据主色生成标题文字颜色（白色）
 */
export function getTitleTextColor(_fillColor: string): string {
  return '#FFFFFF';
}

/**
 * 根据主色生成正文文字颜色（深色）
 */
export function getBodyTextColor(_fillColor: string): string {
  return '#1F2329';
}

/**
 * 根据索引从调色板循环取色
 */
export function getCardColorByIndex(index: number): string {
  return CARD_PALETTE[index % CARD_PALETTE.length];
}

/**
 * 获取 Card 实际显示标题
 */
export function getCardDisplayTitle(title?: string): string {
  const trimmedTitle = title?.trim();
  return trimmedTitle || CARD_DEFAULT_TITLE;
}
