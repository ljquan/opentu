/**
 * 截图标注工具库
 * 
 * 在 Playwright 截图前向页面注入标注元素，实现带标注的截图。
 * 支持数字圆圈、箭头文字、高亮框等标注类型。
 */

import { Page, Locator } from '@playwright/test';

// 标注基础接口
interface BaseAnnotation {
  x: number;
  y: number;
}

// 数字圆圈标注
export interface CircleAnnotation extends BaseAnnotation {
  type: 'circle';
  number: number;
  color?: string;
}

// 箭头文字标注
export interface ArrowAnnotation extends BaseAnnotation {
  type: 'arrow';
  label: string;
  direction?: 'left' | 'right' | 'up' | 'down';
  color?: string;
}

// 高亮框标注
export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight';
  width: number;
  height: number;
  color?: string;
  label?: string;
  labelPosition?: 'top' | 'bottom' | 'left' | 'right'; // 标签位置，默认 top
}

// 纯文字标注
export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  text: string;
  color?: string;
  fontSize?: number;
}

export type Annotation = CircleAnnotation | ArrowAnnotation | HighlightAnnotation | TextAnnotation;

// 默认颜色（使用品牌橙色）
const DEFAULT_COLOR = '#F39C12';
const ANNOTATION_CONTAINER_ID = 'playwright-annotation-container';

/**
 * 向页面注入标注样式
 */
async function injectAnnotationStyles(page: Page): Promise<void> {
  await page.evaluate((containerId) => {
    if (document.getElementById('annotation-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'annotation-styles';
    style.textContent = `
      #${containerId} {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 999999;
      }
      
      .annotation-circle {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        color: white;
        font-weight: bold;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transform: translate(-50%, -50%);
      }
      
      .annotation-arrow {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 6px;
        color: white;
        font-size: 13px;
        font-weight: 500;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        white-space: nowrap;
      }
      
      .annotation-arrow-icon {
        font-size: 16px;
      }
      
      .annotation-highlight {
        position: absolute;
        border-width: 3px;
        border-style: solid;
        border-radius: 8px;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.8);
      }
      
      .annotation-highlight-label {
        position: absolute;
        top: -28px;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 10px;
        border-radius: 4px;
        color: white;
        font-size: 12px;
        font-weight: 500;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        white-space: nowrap;
      }
      
      .annotation-text {
        position: absolute;
        padding: 6px 12px;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }, ANNOTATION_CONTAINER_ID);
}

/**
 * 创建标注容器
 */
async function createAnnotationContainer(page: Page): Promise<void> {
  await page.evaluate((containerId) => {
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      document.body.appendChild(container);
    }
    // 清空现有标注
    container.innerHTML = '';
  }, ANNOTATION_CONTAINER_ID);
}

/**
 * 添加数字圆圈标注
 */
function createCircleElement(annotation: CircleAnnotation): string {
  const color = annotation.color || DEFAULT_COLOR;
  return `<div class="annotation-circle" style="left: ${annotation.x}px; top: ${annotation.y}px; background: ${color};">${annotation.number}</div>`;
}

/**
 * 添加箭头文字标注
 */
function createArrowElement(annotation: ArrowAnnotation): string {
  const color = annotation.color || DEFAULT_COLOR;
  const direction = annotation.direction || 'right';
  
  const arrows: Record<string, string> = {
    left: '←',
    right: '→',
    up: '↑',
    down: '↓',
  };
  
  const arrow = arrows[direction];
  const isHorizontal = direction === 'left' || direction === 'right';
  
  // 根据方向调整位置
  let transform = '';
  if (direction === 'left') {
    transform = 'translateX(-100%)';
  } else if (direction === 'up') {
    transform = 'translateY(-100%)';
  }
  
  const content = direction === 'left' 
    ? `<span>${annotation.label}</span><span class="annotation-arrow-icon">${arrow}</span>`
    : `<span class="annotation-arrow-icon">${arrow}</span><span>${annotation.label}</span>`;
  
  return `<div class="annotation-arrow" style="left: ${annotation.x}px; top: ${annotation.y}px; background: ${color}; transform: ${transform};">${content}</div>`;
}

/**
 * 添加高亮框标注
 */
function createHighlightElement(annotation: HighlightAnnotation): string {
  const color = annotation.color || DEFAULT_COLOR;
  const bgColor = color + '15'; // 15% 透明度
  const labelPos = annotation.labelPosition || 'top';
  
  let labelHtml = '';
  if (annotation.label) {
    let labelStyle = `background: ${color};`;
    switch (labelPos) {
      case 'top':
        labelStyle += 'top: -28px; left: 50%; transform: translateX(-50%);';
        break;
      case 'bottom':
        labelStyle += 'bottom: -28px; left: 50%; transform: translateX(-50%);';
        break;
      case 'left':
        // 标签在元素左侧，右边缘对齐元素左边缘
        labelStyle += 'right: 100%; top: 50%; transform: translateY(-50%); margin-right: 8px;';
        break;
      case 'right':
        // 标签在元素右侧，左边缘对齐元素右边缘
        labelStyle += 'left: 100%; top: 50%; transform: translateY(-50%); margin-left: 8px;';
        break;
    }
    labelHtml = `<div class="annotation-highlight-label" style="${labelStyle}">${annotation.label}</div>`;
  }
  
  return `<div class="annotation-highlight" style="left: ${annotation.x}px; top: ${annotation.y}px; width: ${annotation.width}px; height: ${annotation.height}px; border-color: ${color}; background: ${bgColor};">${labelHtml}</div>`;
}

/**
 * 添加纯文字标注
 */
function createTextElement(annotation: TextAnnotation): string {
  const color = annotation.color || DEFAULT_COLOR;
  const fontSize = annotation.fontSize || 13;
  
  return `<div class="annotation-text" style="left: ${annotation.x}px; top: ${annotation.y}px; background: ${color}; font-size: ${fontSize}px;">${annotation.text}</div>`;
}

/**
 * 向页面添加标注
 */
export async function addAnnotations(page: Page, annotations: Annotation[]): Promise<void> {
  await injectAnnotationStyles(page);
  await createAnnotationContainer(page);
  
  const elements = annotations.map(annotation => {
    switch (annotation.type) {
      case 'circle':
        return createCircleElement(annotation);
      case 'arrow':
        return createArrowElement(annotation);
      case 'highlight':
        return createHighlightElement(annotation);
      case 'text':
        return createTextElement(annotation);
      default:
        return '';
    }
  }).join('');
  
  await page.evaluate(({ containerId, html }) => {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = html;
    }
  }, { containerId: ANNOTATION_CONTAINER_ID, html: elements });
}

/**
 * 移除所有标注
 */
export async function removeAnnotations(page: Page): Promise<void> {
  await page.evaluate((containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '';
    }
  }, ANNOTATION_CONTAINER_ID);
}

/**
 * 获取元素的边界框位置
 */
export async function getElementBounds(locator: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    const box = await locator.boundingBox();
    return box;
  } catch {
    return null;
  }
}

/**
 * 获取元素中心点
 */
export async function getElementCenter(locator: Locator): Promise<{ x: number; y: number } | null> {
  const box = await getElementBounds(locator);
  if (!box) return null;
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

/**
 * 带标注的截图
 * 
 * @param page Playwright 页面对象
 * @param path 截图保存路径
 * @param annotations 标注数组
 */
export async function screenshotWithAnnotations(
  page: Page,
  path: string,
  annotations: Annotation[]
): Promise<void> {
  await addAnnotations(page, annotations);
  await page.screenshot({ path });
  await removeAnnotations(page);
}

/**
 * 辅助函数：创建数字圆圈标注
 */
export function circle(x: number, y: number, number: number, color?: string): CircleAnnotation {
  return { type: 'circle', x, y, number, color };
}

/**
 * 辅助函数：创建箭头文字标注
 */
export function arrow(
  x: number,
  y: number,
  label: string,
  direction: 'left' | 'right' | 'up' | 'down' = 'right',
  color?: string
): ArrowAnnotation {
  return { type: 'arrow', x, y, label, direction, color };
}

/**
 * 辅助函数：创建高亮框标注
 */
export function highlight(
  x: number,
  y: number,
  width: number,
  height: number,
  label?: string,
  color?: string,
  labelPosition?: 'top' | 'bottom' | 'left' | 'right'
): HighlightAnnotation {
  return { type: 'highlight', x, y, width, height, label, color, labelPosition };
}

/**
 * 辅助函数：创建文字标注
 */
export function text(x: number, y: number, content: string, color?: string, fontSize?: number): TextAnnotation {
  return { type: 'text', x, y, text: content, color, fontSize };
}

/**
 * 根据元素位置创建数字圆圈标注
 */
export async function circleOnElement(
  locator: Locator,
  number: number,
  offset: { x?: number; y?: number } = {},
  color?: string
): Promise<CircleAnnotation | null> {
  const center = await getElementCenter(locator);
  if (!center) return null;
  return circle(
    center.x + (offset.x || 0),
    center.y + (offset.y || 0),
    number,
    color
  );
}

/**
 * 根据元素位置创建高亮框标注
 */
export async function highlightElement(
  locator: Locator,
  label?: string,
  padding = 4,
  color?: string,
  labelPosition?: 'top' | 'bottom' | 'left' | 'right'
): Promise<HighlightAnnotation | null> {
  const box = await getElementBounds(locator);
  if (!box) return null;
  return highlight(
    box.x - padding,
    box.y - padding,
    box.width + padding * 2,
    box.height + padding * 2,
    label,
    color,
    labelPosition
  );
}

/**
 * 根据元素位置创建箭头文字标注
 */
export async function arrowToElement(
  locator: Locator,
  label: string,
  direction: 'left' | 'right' | 'up' | 'down' = 'right',
  offset: { x?: number; y?: number } = {},
  color?: string
): Promise<ArrowAnnotation | null> {
  const box = await getElementBounds(locator);
  if (!box) return null;
  
  let x = box.x;
  let y = box.y + box.height / 2;
  
  // 根据方向调整起始位置
  switch (direction) {
    case 'right':
      x = box.x - 10;
      break;
    case 'left':
      x = box.x + box.width + 10;
      break;
    case 'down':
      x = box.x + box.width / 2;
      y = box.y - 10;
      break;
    case 'up':
      x = box.x + box.width / 2;
      y = box.y + box.height + 10;
      break;
  }
  
  return arrow(
    x + (offset.x || 0),
    y + (offset.y || 0),
    label,
    direction,
    color
  );
}
