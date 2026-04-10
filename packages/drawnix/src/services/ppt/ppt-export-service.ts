import PptxGenJS from 'pptxgenjs';
import type { PlaitBoard, PlaitElement } from '@plait/core';
import {
  RectangleClient,
  getRectangleByElements,
  PlaitGroupElement,
} from '@plait/core';
import {
  PlaitDrawElement,
  getStrokeWidthByElement,
  isClosedPoints,
} from '@plait/draw';
import { MindElement } from '@plait/mind';
import { Freehand } from '../../plugins/freehand/type';
import { getFreehandRectangle } from '../../plugins/freehand/utils';
import { PenPath } from '../../plugins/pen/type';
import { getAbsoluteAnchors, getPenPathRectangle } from '../../plugins/pen/utils';
import { getPathSamplePoints } from '../../plugins/pen/bezier-utils';
import { isFrameElement, type PlaitFrame } from '../../types/frame.types';
import {
  sortElementsByPosition,
  extractTextFromElement,
  isTextElement,
  isImageElement,
} from '../../utils/selection-utils';
import { getCurrentFill, getCurrentStrokeColor } from '../../utils/property';

interface ExportPPTOptions {
  fileName?: string;
}

const SLIDE_WIDTH = 10;
const SLIDE_HEIGHT = 5.625;
/** 幻灯片宽度（磅），与 fontScale 计算一致：SLIDE_WIDTH 英寸 × 72pt/英寸 */
const SLIDE_WIDTH_PT = SLIDE_WIDTH * 72;
// 画布默认使用的中文系统字体（与前端一致）
const DEFAULT_FONT_FACE = 'PingFang SC';
// 画布文本默认字号（见 with-text-resize / inline text 输入）
const DEFAULT_CANVAS_TEXT_FONT_SIZE_PX = 14;

/**
 * 画布坐标系下的描边宽度（与 element.points 同单位）→ PptxGenJS line.width（磅）。
 * 原先把 1～2 的像素级线宽直接当「磅」传入，在宽 Frame 上会粗得夸张。
 */
function canvasStrokeWidthToPptPt(strokeWidthPx: number, frameWidthPx: number): number {
  const fw = Math.max(frameWidthPx, 1);
  const pt = strokeWidthPx * (SLIDE_WIDTH_PT / fw);
  return Math.max(0.1, pt);
}

// ─── Color conversion ───

function toPptColor(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const c = color.trim();
  if (c === 'transparent' || c === 'none' || c === '') return undefined;

  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return hex.split('').map((ch) => ch + ch).join('').toUpperCase();
    }
    return hex.substring(0, 6).toUpperCase();
  }

  const rgbMatch = c.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return [r, g, b].map((v) => parseInt(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  return undefined;
}

// ─── Slate rich text extraction ───
//
// Plait geometry/text elements store text as:
//   element.text = { type: 'paragraph', children: [{ text: '...', 'font-size': 44, ... }] }
// MindElement / some elements use:
//   element.data = [ { type: 'paragraph', children: [...] }, ... ]
//
// We walk both to extract styled TextProps for pptxgenjs.

interface SlateLeaf {
  text: string;
  'font-size'?: number;
  'font-weight'?: string;
  color?: string;
  italic?: boolean;
  underline?: boolean;
  bold?: boolean;
  [key: string]: any;
}

interface TextFallbackStyle {
  fontSizePt?: number;
  align?: 'left' | 'center' | 'right';
}

function isSlateLeaf(node: any): node is SlateLeaf {
  return node && typeof node === 'object' && typeof node.text === 'string';
}

function collectLeaves(node: any): SlateLeaf[] {
  if (isSlateLeaf(node)) return [node];
  const leaves: SlateLeaf[] = [];
  const children = node?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      leaves.push(...collectLeaves(child));
    }
  }
  return leaves;
}

function parseNumericFontSize(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function leafToTextProps(
  leaf: SlateLeaf,
  addBreakLine: boolean,
  fontScale: number,
  defaultFontSizePt: number
): PptxGenJS.TextProps {
  const opts: Record<string, any> = {};

  const fontSize = parseNumericFontSize(leaf['font-size']);
  const targetPt = fontSize
    ? Math.max(6, Math.round(fontSize * fontScale))
    : defaultFontSizePt;
  opts.fontSize = targetPt;

  const fontWeight = leaf['font-weight'];
  const fontWeightNum = fontWeight ? Number(fontWeight) : NaN;
  if (
    fontWeight === 'bold' ||
    leaf.bold ||
    (!Number.isNaN(fontWeightNum) && fontWeightNum >= 500)
  ) {
    opts.bold = true;
  }

  const color = toPptColor(leaf.color);
  if (color) opts.color = color;

  if (leaf.italic) opts.italic = true;
  if (leaf.underline) opts.underline = { style: 'sng' };
  if (addBreakLine) opts.breakLine = true;

  return { text: leaf.text, options: opts };
}

/**
 * 从 Slate 段落节点数组中提取带样式的 TextProps
 */
function walkParagraphs(paragraphs: any[], fontScale: number): PptxGenJS.TextProps[] | null {
  const result: PptxGenJS.TextProps[] = [];
  const defaultFontSizePt = Math.max(
    6,
    Math.round(DEFAULT_CANVAS_TEXT_FONT_SIZE_PX * fontScale)
  );

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const isLastPara = pi === paragraphs.length - 1;
    const leaves = collectLeaves(paragraphs[pi]);
    if (leaves.length === 0) {
      if (!isLastPara) result.push({ text: '', options: { breakLine: true } });
      continue;
    }
    for (let li = 0; li < leaves.length; li++) {
      const isLastLeaf = li === leaves.length - 1;
      const needBreak = isLastLeaf && !isLastPara;
      result.push(leafToTextProps(leaves[li], needBreak, fontScale, defaultFontSizePt));
    }
  }

  if (result.length === 0) return null;
  return result.some((r) => r.text?.trim()) ? result : null;
}

interface RichTextResult {
  rows: PptxGenJS.TextProps[];
  align?: 'left' | 'center' | 'right';
}

/**
 * 统一提取元素的富文本（同时支持 element.data 和 element.text）
 * 同时提取段落对齐方式
 */
function extractElementRichText(
  element: PlaitElement,
  fontScale: number
): RichTextResult | null {
  // 1) element.data：MindElement / 部分 PlaitText 使用 data 数组
  const data = (element as any).data;
  if (data && Array.isArray(data)) {
    const rows = walkParagraphs(data, fontScale);
    if (rows) {
      const align = extractAlign(data[0]);
      return { rows, align };
    }
  }

  // 2) element.text：PlaitGeometry / PlaitText 使用单个 Slate 段落
  const textObj = (element as any).text;
  if (textObj && typeof textObj === 'object' && 'children' in textObj) {
    const rows = walkParagraphs([textObj], fontScale);
    if (rows) {
      const align = extractAlign(textObj);
      return { rows, align };
    }
  }

  return null;
}

function extractAlign(para: any): 'left' | 'center' | 'right' | undefined {
  if (!para || typeof para !== 'object') return undefined;
  const a = para.align;
  if (a === 'center' || a === 'right' || a === 'left') return a;
  return undefined;
}

function extractFallbackTextStyle(
  element: PlaitElement,
  fontScale: number,
  defaultFontPt: number,
  defaultAlign: 'left' | 'center' | 'right'
): TextFallbackStyle {
  const textObj = (element as any).text;
  const data = (element as any).data;

  let align = defaultAlign;
  let fontSizePt = defaultFontPt;

  const paragraphs: any[] = [];
  if (Array.isArray(data)) {
    paragraphs.push(...data);
  }
  if (textObj && typeof textObj === 'object') {
    paragraphs.push(textObj);
  }

  for (const para of paragraphs) {
    const paraAlign = extractAlign(para);
    if (paraAlign) {
      align = paraAlign;
      break;
    }
  }

  for (const para of paragraphs) {
    const leaves = collectLeaves(para);
    for (const leaf of leaves) {
      const sizePx = parseNumericFontSize((leaf as any)['font-size']);
      if (sizePx && sizePx > 0) {
        fontSizePt = Math.max(6, Math.round(sizePx * fontScale));
        return { align, fontSizePt };
      }
    }
  }

  return { align, fontSizePt };
}

function extractPlainTextWithLineBreaks(element: PlaitElement, board: PlaitBoard): string {
  const data = (element as any).data;
  if (Array.isArray(data) && data.length > 0) {
    const rows = data
      .map((node: any) => {
        const leaves = collectLeaves(node);
        return leaves.map((leaf) => leaf.text || '').join('');
      })
      .filter((line: string) => line.length > 0);
    if (rows.length > 0) return rows.join('\n');
  }

  const textObj = (element as any).text;
  if (textObj && typeof textObj === 'object' && 'children' in textObj) {
    const children = (textObj as any).children;
    if (Array.isArray(children)) {
      const lines: string[] = [];
      const hasParagraphChildren = children.some(
        (child: any) =>
          child &&
          typeof child === 'object' &&
          Array.isArray(child.children)
      );
      if (hasParagraphChildren) {
        for (const child of children) {
          const leaves = collectLeaves(child);
          const line = leaves.map((leaf) => leaf.text || '').join('');
          if (line.length > 0) lines.push(line);
        }
      } else {
        const line = collectLeaves(textObj).map((leaf) => leaf.text || '').join('');
        if (line.length > 0) lines.push(line);
      }
      if (lines.length > 0) return lines.join('\n');
    }
  }

  return extractTextFromElement(element, board);
}

/**
 * 纯文本兜底（无样式数据时使用）
 */
function buildPlainTextRows(
  text: string,
  fontSizePt: number
): PptxGenJS.TextProps[] {
  return text.split('\n').map((line, i, arr) => ({
    text: line,
    options: {
      fontSize: fontSizePt,
      ...(i < arr.length - 1 ? { breakLine: true } : {}),
    },
  }));
}

function isShortSingleLine(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (!t) return false;
  // 没有显式换行且字符数不多（如「感谢聆听」「Q&A」）
  return !text.includes('\n') && t.length <= 12;
}

function shouldEnableAutoWrap(text: string, isSingle: boolean): boolean {
  // 用户输入了显式换行时，优先保留原换行，避免 PPT/WPS 二次自动断行
  if (text.includes('\n')) return false;
  return !isSingle;
}

// ─── Shape type mapping ───

function mapShapeType(pptx: PptxGenJS, shape: string): any {
  const st = pptx.ShapeType as Record<string, any>;
  switch (shape) {
    case 'rectangle': case 'process': return st.rect;
    case 'ellipse': case 'circle': return st.ellipse;
    case 'roundRectangle':
    case 'roundedRectangle':
    case 'round_rectangle':
      return st.roundRect;
    case 'diamond': case 'decision': return st.diamond;
    case 'triangle': return st.triangle;
    case 'parallelogram': return st.parallelogram;
    case 'trapezoid': return st.trapezoid;
    case 'hexagon': return st.hexagon;
    case 'star4': return st.star4;
    case 'star5': case 'star': return st.star5;
    case 'cloud': return st.cloud;
    default: return st.rect;
  }
}

// ─── Position / style helpers ───

/**
 * widthBuffer > 1 时：按中心点向两侧扩展宽度，防止 PPT 字体度量差异导致换行
 */
function computeSlidePosition(
  elRect: { x: number; y: number; width: number; height: number },
  frameRect: { x: number; y: number; width: number; height: number },
  widthBuffer = 1
) {
  const relX = (elRect.x - frameRect.x) / frameRect.width;
  const relY = (elRect.y - frameRect.y) / frameRect.height;
  const relW = elRect.width / frameRect.width;
  const relH = elRect.height / frameRect.height;

  const w = Math.max(0.1, relW * SLIDE_WIDTH * widthBuffer);
  const rawX = relX * SLIDE_WIDTH;
  const expandDelta = (w - relW * SLIDE_WIDTH) / 2;

  return {
    x: Math.max(0, rawX - expandDelta),
    y: Math.max(0, relY * SLIDE_HEIGHT),
    w,
    h: Math.max(0.1, relH * SLIDE_HEIGHT),
  };
}

function getElementFillOpts(
  board: PlaitBoard,
  element: PlaitElement
): { fill?: { color: string } } {
  const fillColor = toPptColor(getCurrentFill(board, element));
  return fillColor ? { fill: { color: fillColor } } : {};
}

function getElementLineOpts(
  board: PlaitBoard,
  element: PlaitElement,
  frameWidthPx: number
): { line: { color: string; width: number } } {
  const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
  const px = getStrokeWidthByElement(element as any);
  const widthPt = canvasStrokeWidthToPptPt(px, frameWidthPx);
  // pptxgenjs：未传 line 时会默认 { type: 'none' }，无填充的几何图形在 PPT 中会完全不可见
  return { line: { color: strokeColor || '333333', width: widthPt } };
}

type CustGeomPoint =
  | { x: number; y: number; moveTo?: boolean }
  | { close: true };

// ─── Image helper ───

async function ensureBase64Image(url: string): Promise<string> {
  if (!url) throw new Error('图片 URL 为空');
  if (url.startsWith('data:')) return url;

  const response = await fetch(url, { referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`获取图片失败: ${response.status}`);
  const blob = await response.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片转换失败'));
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

// ─── Frame sorting ───

function sortFramesForPPT(frames: PlaitFrame[]): PlaitFrame[] {
  return [...frames].sort((a, b) => {
    const metaA = (a as PlaitFrame & { pptMeta?: { pageIndex?: number } }).pptMeta;
    const metaB = (b as PlaitFrame & { pptMeta?: { pageIndex?: number } }).pptMeta;
    const indexA = metaA?.pageIndex;
    const indexB = metaB?.pageIndex;
    const hasA = typeof indexA === 'number' && !Number.isNaN(indexA);
    const hasB = typeof indexB === 'number' && !Number.isNaN(indexB);
    // 原先用 pageA && pageB：pageIndex 为 0 或与「无 meta」混排时会失效，导致顺序退化成仅按 x，幻灯片与配图页错乱
    if (hasA && hasB && indexA !== indexB) {
      return indexA - indexB;
    }
    if (hasA !== hasB) {
      return hasA ? -1 : 1;
    }

    const rectA = RectangleClient.getRectangleByPoints(a.points);
    const rectB = RectangleClient.getRectangleByPoints(b.points);
    const dy = rectA.y - rectB.y;
    if (Math.abs(dy) > 1) return dy;
    return rectA.x - rectB.x;
  });
}

function rectangleIntersectionArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = x2 - x1;
  const h = y2 - y1;
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 将画布元素划分到各 Frame（导出页）。有 frameId 的跟绑定走；无绑定的按与 Frame 相交面积最大的一页归属，避免重复进多页。
 */
function partitionElementsByExportFrames(
  board: PlaitBoard,
  frames: PlaitFrame[]
): Map<string, PlaitElement[]> {
  const byFrame = new Map<string, PlaitElement[]>();
  const frameRectMap = new Map(
    frames.map((f) => [f.id, RectangleClient.getRectangleByPoints(f.points)] as const)
  );
  for (const f of frames) {
    byFrame.set(f.id, []);
  }
  const unbound: PlaitElement[] = [];

  for (const el of board.children as PlaitElement[]) {
    if (isFrameElement(el)) continue;
    if (PlaitGroupElement.isGroup(el)) continue;

    const boundId = (el as PlaitElement & { frameId?: string }).frameId;
    if (boundId && byFrame.has(boundId)) {
      byFrame.get(boundId)!.push(el);
      continue;
    }
    if (boundId) {
      continue;
    }
    unbound.push(el);
  }

  for (const el of unbound) {
    let rect: RectangleClient;
    try {
      rect = getRectangleByElements(board, [el], false);
    } catch {
      continue;
    }
    if (rect.width <= 0 || rect.height <= 0) continue;

    let bestId: string | null = null;
    let bestArea = 0;
    for (const f of frames) {
      const fr = frameRectMap.get(f.id)!;
      if (!RectangleClient.isHit(rect, fr)) continue;
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      if (!isPointInRect(center, fr, 2)) continue;
      const area = rectangleIntersectionArea(rect, fr);
      if (area > bestArea) {
        bestArea = area;
        bestId = f.id;
      }
    }
    if (bestId && bestArea > 0) {
      byFrame.get(bestId)!.push(el);
    }
  }

  return byFrame;
}

/** 与 FramePanel 一致：递归收集所有 Frame（含嵌套） */
function collectAllFramesFromBoard(board: PlaitBoard): PlaitFrame[] {
  const seen = new Set<string>();
  const out: PlaitFrame[] = [];
  const walk = (elements: PlaitElement[]) => {
    for (const el of elements) {
      if (isFrameElement(el)) {
        const f = el as PlaitFrame;
        if (!seen.has(f.id)) {
          seen.add(f.id);
          out.push(f);
        }
      }
      const ch = (el as PlaitElement & { children?: PlaitElement[] }).children;
      if (ch && ch.length > 0) {
        walk(ch);
      }
    }
  };
  walk(board.children as PlaitElement[]);
  return out;
}

function isRectContained(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
  epsilon = 0.5
): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

function isPointInRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  epsilon = 0.5
): boolean {
  return (
    point.x >= rect.x - epsilon &&
    point.y >= rect.y - epsilon &&
    point.x <= rect.x + rect.width + epsilon &&
    point.y <= rect.y + rect.height + epsilon
  );
}

function shouldSkipMediaAsRasterImage(element: PlaitElement): boolean {
  const anyEl = element as any;
  if (anyEl.isVideo) return true;
  const url = anyEl.url || anyEl.image?.url;
  if (typeof url !== 'string') return false;
  if (url.includes('#video') || url.includes('#merged-video')) return true;
  return /\.(mp4|webm|mov|mkv|avi)(\?|#|$)/i.test(url);
}

// ─── Core: convert one Frame into a PPT slide ───

async function addFrameSlide(
  pptx: PptxGenJS,
  board: PlaitBoard,
  frame: PlaitFrame,
  children: PlaitElement[]
): Promise<boolean> {
  if (!children.length) return false;

  const frameRect = RectangleClient.getRectangleByPoints(frame.points);
  const slide = pptx.addSlide();

  // Frame 背景图：用 addImage 铺满幻灯片并设置透明度，与画布预览保持一致（opacity=0.3）
  const backgroundUrl = frame.backgroundUrl;
  if (backgroundUrl) {
    try {
      const bgData = await ensureBase64Image(backgroundUrl);
      slide.addImage({
        data: bgData,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
        transparency: 70,
      });
    } catch {
      console.debug('[PPT Export] Frame background image load failed, using default');
    }
  }

  const ordered = sortElementsByPosition(board, children as PlaitElement[]);

  // 字号缩放：画布 px → PPT pt（保持视觉比例一致）
  // 1920px 宽的画布映射到 10 英寸（720pt）宽的幻灯片
  const fontScale = (SLIDE_WIDTH * 72) / frameRect.width;

  // 兜底字号（按缩放后）
  const defaultBodyPt = Math.max(6, Math.round(18 * fontScale));

  for (const element of ordered) {
    try {
      if (PlaitGroupElement.isGroup(element)) {
        continue;
      }

      const rect = getRectangleByElements(board, [element], false);
      const pos = computeSlidePosition(rect, frameRect);

      // --- Image element ---
      if (isImageElement(board, element)) {
        if (shouldSkipMediaAsRasterImage(element)) {
          continue;
        }
        const url = (element as any).url || (element as any).image?.url;
        if (!url) continue;
        try {
          const data = await ensureBase64Image(url);
          slide.addImage({ data, x: pos.x, y: pos.y, w: pos.w, h: pos.h });
        } catch {
          console.debug('[PPT Export] Image load failed, skipping');
        }
        continue;
      }

      // --- Geometry shape（须先于 isTextElement：形状工具创建的图形也带 Slate 的 element.text，空文案时走文本分支会既不 addText 也不 addShape）---
      if (
        PlaitDrawElement.isGeometry?.(element) &&
        !PlaitDrawElement.isText?.(element)
      ) {
        const shape = (element as any).shape || 'rectangle';
        const shapeType = mapShapeType(pptx, shape);
        const fillOpts = getElementFillOpts(board, element);
        const lineOpts = getElementLineOpts(board, element, frameRect.width);

        const baseOpts: Record<string, any> = {
          x: pos.x, y: pos.y, w: pos.w, h: pos.h,
          ...fillOpts, ...lineOpts,
        };

        const angle = (element as any).angle;
        if (typeof angle === 'number' && !Number.isNaN(angle) && angle !== 0) {
          baseOpts.rotate = angle;
        }

        if (
          shape === 'roundRectangle' ||
          shape === 'roundedRectangle' ||
          shape === 'round_rectangle'
        ) {
          baseOpts.rectRadius = 0.2;
        }

        const rich = extractElementRichText(element, fontScale);
        const plainText = extractTextFromElement(element, board);
        const isSingle = isShortSingleLine(plainText);
        if (rich) {
          slide.addText(rich.rows, {
            ...baseOpts,
            shape: shapeType,
            valign: 'middle',
            align: rich.align || 'center',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        } else if (plainText) {
          slide.addText(buildPlainTextRows(plainText, defaultBodyPt), {
            ...baseOpts,
            shape: shapeType,
            valign: 'middle',
            align: 'center',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        } else {
          slide.addShape(shapeType, baseOpts);
        }
        continue;
      }

      // --- PlaitText / 纯文本（排除已处理的几何形状）---
      if (isTextElement(board, element)) {
        const rawText = extractPlainTextWithLineBreaks(element, board);
        const isSingle = isShortSingleLine(rawText);
        const autoWrap = shouldEnableAutoWrap(rawText, isSingle);
        // 仅在允许自动换行时做轻微宽度冗余；手动换行时保持与画布等宽
        const textPos = computeSlidePosition(rect, frameRect, autoWrap ? 1.12 : 1);
        const rich = extractElementRichText(element, fontScale);
        if (rich) {
          slide.addText(rich.rows, {
            x: textPos.x,
            y: textPos.y,
            w: textPos.w,
            h: textPos.h,
            valign: 'top',
            wrap: autoWrap,
            align: rich.align || 'left',
            fontFace: DEFAULT_FONT_FACE,
            margin: 0,
            fit: 'none',
          });
        } else if (rawText) {
          const fallback = extractFallbackTextStyle(
            element,
            fontScale,
            defaultBodyPt,
            'left'
          );
          slide.addText(buildPlainTextRows(rawText, fallback.fontSizePt || defaultBodyPt), {
            x: textPos.x,
            y: textPos.y,
            w: textPos.w,
            h: textPos.h,
            valign: 'top',
            wrap: autoWrap,
            align: fallback.align || 'left',
            fontFace: DEFAULT_FONT_FACE,
            margin: 0,
            fit: 'none',
          });
        }
        continue;
      }

      // --- Arrow line / Vector line ---
      if (
        PlaitDrawElement.isArrowLine?.(element) ||
        PlaitDrawElement.isVectorLine?.(element)
      ) {
        const points = (element as any).points;
        if (!points || points.length < 2) continue;

        const startPt = points[0] as [number, number];
        const endPt = points[points.length - 1] as [number, number];

        const sx = ((startPt[0] - frameRect.x) / frameRect.width) * SLIDE_WIDTH;
        const sy = ((startPt[1] - frameRect.y) / frameRect.height) * SLIDE_HEIGHT;
        const ex = ((endPt[0] - frameRect.x) / frameRect.width) * SLIDE_WIDTH;
        const ey = ((endPt[1] - frameRect.y) / frameRect.height) * SLIDE_HEIGHT;

        const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
        const lineProps: Record<string, any> = {
          color: strokeColor || '333333',
          width: canvasStrokeWidthToPptPt(
            getStrokeWidthByElement(element as any),
            frameRect.width
          ),
        };

        if (PlaitDrawElement.isArrowLine?.(element)) {
          const source = (element as any).source;
          const target = (element as any).target;
          if (source?.marker && source.marker !== 'none') {
            lineProps.beginArrowType = 'triangle';
          }
          if (!target?.marker || target.marker !== 'none') {
            lineProps.endArrowType = 'triangle';
          }
        }

        slide.addShape(pptx.ShapeType.line, {
          x: Math.min(sx, ex),
          y: Math.min(sy, ey),
          w: Math.abs(ex - sx) || 0.01,
          h: Math.abs(ey - sy) || 0.01,
          flipH: ex < sx,
          flipV: ey < sy,
          line: lineProps,
        });
        continue;
      }

      // --- Freehand (画笔)：custGeom 折线/多边形 ---
      if (Freehand.isFreehand(element)) {
        const freehand = element as Freehand;
        const points = freehand.points;
        if (!points || points.length < 2) continue;

        const freehandRect = getFreehandRectangle(freehand);
        const fhPos = computeSlidePosition(freehandRect, frameRect);
        const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
        const lineOpts = {
          color: strokeColor || '333333',
          width: canvasStrokeWidthToPptPt(
            getStrokeWidthByElement(freehand as any),
            frameRect.width
          ),
        };

        // 将画布坐标转为形状局部坐标（与 ppt 形状 w×h 同单位）
        const toLocal = (p: [number, number]) => ({
          x: (p[0] - freehandRect.x) / freehandRect.width * fhPos.w,
          y: (p[1] - freehandRect.y) / freehandRect.height * fhPos.h,
        });

        const pathPoints: CustGeomPoint[] = [];
        pathPoints.push({ ...toLocal(points[0]), moveTo: true });
        for (let i = 1; i < points.length; i++) {
          pathPoints.push(toLocal(points[i]));
        }
        if (isClosedPoints(points)) {
          pathPoints.push({ close: true });
        }

        slide.addShape((pptx as any).ShapeType.custGeom, {
          x: fhPos.x,
          y: fhPos.y,
          w: fhPos.w,
          h: fhPos.h,
          line: lineOpts,
          fill: { color: 'FFFFFF', transparency: 100 },
          points: pathPoints,
        });
        continue;
      }

      // --- PenPath（钢笔/布尔生成的矢量形状）：custGeom 近似 ---
      if (PenPath.isPenPath(element)) {
        const pen = element as PenPath;
        const absoluteAnchors = getAbsoluteAnchors(pen);
        if (!absoluteAnchors.length) continue;

        const penRect = getPenPathRectangle(pen);
        const penPos = computeSlidePosition(penRect, frameRect);

        const strokeColor = toPptColor(getCurrentStrokeColor(board, element));
        const line = {
          color: strokeColor || '333333',
          width: canvasStrokeWidthToPptPt(
            getStrokeWidthByElement(pen as any),
            frameRect.width
          ),
        };

        const fillColor = toPptColor(pen.fill);
        const fill = pen.closed && fillColor
          ? { color: fillColor }
          : { color: 'FFFFFF', transparency: 100 };

        // 贝塞尔曲线按采样点近似为折线（PPT 兼容 & 实现简单）
        const samples = getPathSamplePoints(absoluteAnchors, pen.closed, 12);
        if (samples.length < 2) continue;

        const toLocal = (p: [number, number]) => ({
          x: (p[0] - penRect.x) / penRect.width * penPos.w,
          y: (p[1] - penRect.y) / penRect.height * penPos.h,
        });

        const pathPoints: CustGeomPoint[] = [];
        pathPoints.push({ ...toLocal(samples[0] as [number, number]), moveTo: true });
        for (let i = 1; i < samples.length; i++) {
          pathPoints.push(toLocal(samples[i] as [number, number]));
        }
        if (pen.closed) {
          pathPoints.push({ close: true });
        }

        slide.addShape((pptx as any).ShapeType.custGeom, {
          x: penPos.x,
          y: penPos.y,
          w: penPos.w,
          h: penPos.h,
          line,
          fill,
          points: pathPoints,
        });
        continue;
      }

      // --- Mind element ---
      if (MindElement.isMindElement?.(board, element)) {
        const rich = extractElementRichText(element, fontScale);
        const text = extractTextFromElement(element, board);
        const isSingle = isShortSingleLine(text);
        if (rich) {
          slide.addText(rich.rows, {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            valign: 'middle',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        } else if (text) {
          slide.addText(buildPlainTextRows(text, defaultBodyPt), {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            valign: 'middle',
            wrap: !isSingle,
            fontFace: DEFAULT_FONT_FACE,
          });
        }
        continue;
      }

      // --- Fallback ---
      const richFallback = extractElementRichText(element, fontScale);
      const fallbackText = extractTextFromElement(element, board);
      const isSingle = isShortSingleLine(fallbackText);
      const autoWrap = shouldEnableAutoWrap(fallbackText, isSingle);
      if (richFallback) {
        slide.addText(richFallback.rows, {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          valign: 'top',
          wrap: autoWrap,
          align: richFallback.align,
          fontFace: DEFAULT_FONT_FACE,
          margin: 0,
          fit: 'none',
        });
      } else if (fallbackText) {
        slide.addText(buildPlainTextRows(fallbackText, defaultBodyPt), {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          valign: 'top',
          wrap: autoWrap,
          fontFace: DEFAULT_FONT_FACE,
          margin: 0,
          fit: 'none',
        });
      }
    } catch (err) {
      console.debug('[PPT Export] Skipping element:', err);
    }
  }

  return true;
}

// ─── Public API ───

export async function exportFramesToPPT(
  board: PlaitBoard,
  frames: PlaitFrame[],
  options: ExportPPTOptions = {}
): Promise<void> {
  if (!frames.length) throw new Error('没有可导出的 Frame');

  const sortedFrames = sortFramesForPPT(frames);
  const partition = partitionElementsByExportFrames(board, sortedFrames);
  const pptx = new PptxGenJS();

  let addedCount = 0;
  for (const frame of sortedFrames) {
    const slideChildren = partition.get(frame.id) ?? [];
    const ok = await addFrameSlide(pptx, board, frame, slideChildren);
    if (ok) addedCount += 1;
  }

  if (addedCount === 0) throw new Error('PPT 导出失败：没有生成任何页面');

  const baseName =
    options.fileName ||
    (sortedFrames.length === 1 && sortedFrames[0].name
      ? sortedFrames[0].name
      : 'aitu-ppt');

  await pptx.writeFile({
    fileName: baseName.endsWith('.pptx') ? baseName : `${baseName}.pptx`,
  });
}

export async function exportAllPPTFrames(
  board: PlaitBoard,
  options: ExportPPTOptions = {}
): Promise<void> {
  const allFrames = collectAllFramesFromBoard(board);
  if (!allFrames.length) throw new Error('当前画布没有可导出的 Frame');
  await exportFramesToPPT(board, allFrames, options);
}
