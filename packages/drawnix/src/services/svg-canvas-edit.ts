import {
  idCreator,
  PlaitHistoryBoard,
  Transforms,
  type PlaitBoard,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { unifiedCacheService } from './unified-cache-service';
import {
  buildSvgSandboxDocument,
  getSvgViewBox,
  inspectSvgSource,
  parseSvgDocument,
  type SvgSource,
} from '../utils/svg-source';
import {
  placeImageColumn,
  IMAGE_LINEAGE_GAP,
} from '../utils/image-generation-lineage-placement';

const NS = 'http://www.w3.org/2000/svg';
const shapes = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'use',
]);
const styleNames = [
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  'writing-mode',
  'visibility',
  'display',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'paint-order',
  'transform-origin',
  'transform-box',
  'stop-color',
  'stop-opacity',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'color',
  'vector-effect',
];
type Bounds = { x: number; y: number; width: number; height: number };
export type SvgImageElement = PlaitElement & {
  url: string;
  points: [Point, Point];
  angle?: number;
  svgVectorPart?: SvgVectorPart;
  svgPlayback?: 'playing' | 'paused';
};
export interface SvgVectorPart {
  version: 1;
  sourceUrl: string;
  sourceElementId: string;
  partId: string;
  label: string;
  fill?: string;
  stroke?: string;
  text?: string;
}
export interface PreparedSvgPart {
  markup: string;
  bounds: Bounds;
  label: string;
  partId: string;
  fill?: string;
  stroke?: string;
  text?: string;
}

function localReferences(value: string): string {
  return value.replace(/url\(["']?[^)]*#([\w:.-]+)["']?\)/g, 'url(#$1)');
}

function measureBounds(
  node: SVGGraphicsElement,
  root: SVGSVGElement,
  view: Window
): Bounds {
  const box = node.getBBox();
  const matrix = node.getCTM(),
    rootMatrix = root.getCTM();
  if (!matrix || !rootMatrix) throw new Error('SVG 图形尺寸暂不可读取');
  const m = rootMatrix.inverse().multiply(matrix);
  const style = view.getComputedStyle(node);
  const stroke = style.getPropertyValue('stroke');
  const join = style.getPropertyValue('stroke-linejoin');
  const miter =
    !join || join === 'miter'
      ? Math.max(
          1,
          parseFloat(style.getPropertyValue('stroke-miterlimit')) || 4
        )
      : 1;
  const padding =
    stroke && stroke !== 'none'
      ? ((parseFloat(style.getPropertyValue('stroke-width')) || 1) / 2) * miter
      : 0;
  let x = box.x - padding,
    y = box.y - padding,
    width = box.width + 2 * padding,
    height = box.height + 2 * padding;
  const filterValue = localReferences(
    style.getPropertyValue('filter') || node.getAttribute('filter') || ''
  );
  const filterId = filterValue.match(/^url\(#([\w:.-]+)\)$/)?.[1];
  if (filterId) {
    const filter = root.querySelectorAll('[id]');
    const definition = Array.from(filter).find((item) => item.id === filterId);
    if (
      !definition ||
      definition.getAttribute('filterUnits') === 'userSpaceOnUse'
    )
      throw new Error('SVG 使用了暂不支持拆分的滤镜坐标，原图已保留');
    const fraction = (key: string, fallback: string) => {
      const value = definition.getAttribute(key) || fallback;
      if (!/^-?(?:\d*\.)?\d+%?$/.test(value))
        throw new Error('SVG 滤镜范围无效');
      return parseFloat(value) / (value.endsWith('%') ? 100 : 1);
    };
    x = box.x + box.width * fraction('x', '-10%');
    y = box.y + box.height * fraction('y', '-10%');
    width = box.width * fraction('width', '120%');
    height = box.height * fraction('height', '120%');
  }
  const points = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
  const xs = points.map((point) => point[0]),
    ys = points.map((point) => point[1]);
  const result = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  // getBBox() omits descendant strokes. Filters have their own output region.
  if (!filterId && ['g', 'svg'].includes(node.localName)) {
    for (const child of Array.from(node.children)) {
      if (
        !shapes.has(child.localName) &&
        !['g', 'svg'].includes(child.localName)
      )
        continue;
      if (view.getComputedStyle(child).display === 'none') continue;
      const bounds = measureBounds(child as SVGGraphicsElement, root, view);
      const right = Math.max(result.x + result.width, bounds.x + bounds.width);
      const bottom = Math.max(
        result.y + result.height,
        bounds.y + bounds.height
      );
      result.x = Math.min(result.x, bounds.x);
      result.y = Math.min(result.y, bounds.y);
      result.width = right - result.x;
      result.height = bottom - result.y;
    }
  }
  if (node.localName === 'use') {
    // References may have transformed strokes. Keep their source viewport
    // rather than guessing and cropping referenced content.
    const [x, y, width, height] = getSvgViewBox(root);
    return { x, y, width, height };
  }
  return result;
}

function partTargets(root: SVGSVGElement, view: Window): SVGGraphicsElement[] {
  const result: SVGGraphicsElement[] = [];
  const visit = (node: Element) => {
    const style = view.getComputedStyle(node);
    if (style.display === 'none') return;
    if (node.localName === 'g' || node.localName === 'svg') {
      const atomic =
        node !== root &&
        (Number(style.opacity || '1') !== 1 ||
          ['filter', 'mask', 'clip-path'].some((key) => {
            const value = style.getPropertyValue(key) || node.getAttribute(key);
            return value && value !== 'none';
          }));
      if (atomic) result.push(node as SVGGraphicsElement);
      else Array.from(node.children).forEach(visit);
    } else if (shapes.has(node.localName) && style.visibility !== 'hidden')
      result.push(node as SVGGraphicsElement);
  };
  visit(root);
  if (result.length > 200)
    throw new Error('SVG 部件超过 200 个，保留原图以避免画布卡顿');
  return result;
}

/** Called only on a script-free, isolated SVG document after native geometry is ready. */
export function prepareSvgVectorParts(
  doc: Document,
  source: SvgSource,
  clipToViewBox = true
): PreparedSvgPart[] {
  if (!source.canConvert)
    throw new Error(source.conversionReason || '此 SVG 暂不能转换');
  const root = doc.querySelector('svg') as SVGSVGElement | null;
  const view = doc.defaultView;
  if (!root || !view || typeof root.getBBox !== 'function')
    throw new Error('浏览器不支持读取 SVG 矢量尺寸');
  if (
    root.hasAttribute('transform') ||
    (view.getComputedStyle(root).transform &&
      view.getComputedStyle(root).transform !== 'none')
  )
    throw new Error('SVG 根节点变换暂不支持拆分，原图已保留');
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  const rootStyle = view.getComputedStyle(root);
  if (
    Number(rootStyle.opacity || '1') !== 1 ||
    ['filter', 'mask', 'clip-path'].some((key) => {
      const value = rootStyle.getPropertyValue(key) || root.getAttribute(key);
      return value && value !== 'none';
    })
  )
    throw new Error('SVG 根节点合成效果暂不支持拆分，原图已保留');
  // These structures depend on the original viewport or selector context. Keep
  // the original instead of changing their appearance when each part is cropped.
  const geometryStyle =
    /(?:^|[;{])\s*(?:x|y|cx|cy|r|rx|ry|width|height|d|translate|rotate|scale)\s*:/i;
  const supportedStyles = new Set([
    ...styleNames,
    'transform',
    'cursor',
    'pointer-events',
  ]);
  for (const node of all) {
    const style = view.getComputedStyle(node);
    const declarations =
      node.localName === 'style'
        ? node.textContent || ''
        : node.getAttribute('style') || '';
    const unsupportedStyle =
      /\\/.test(declarations) ||
      Array.from(declarations.matchAll(/(?:^|[;{])\s*([-\w]+)\s*:/g), (match) =>
        match[1].toLowerCase()
      ).some((name) => !name.startsWith('--') && !supportedStyles.has(name));
    if (
      (node !== root && node.localName === 'svg') ||
      unsupportedStyle ||
      geometryStyle.test(node.getAttribute('style') || '') ||
      (node.localName === 'style' &&
        geometryStyle.test(node.textContent || '')) ||
      ['mix-blend-mode', 'isolation', 'vector-effect'].some((key) => {
        const value = style.getPropertyValue(key);
        return value && !['normal', 'auto', 'none'].includes(value);
      }) ||
      (node !== root &&
        [
          'x',
          'y',
          'x1',
          'y1',
          'x2',
          'y2',
          'cx',
          'cy',
          'r',
          'rx',
          'ry',
          'width',
          'height',
          'font-size',
          'dx',
          'dy',
          'stroke-width',
        ].some((key) =>
          /%|(?:em|ex|rem|vw|vh)\b|(?:var|calc)\(/i.test(
            node.getAttribute(key) || ''
          )
        ))
    ) {
      throw new Error(
        'SVG 含依赖视口或复杂样式的结构，暂不支持保真拆分，原图已保留'
      );
    }
  }
  const targets = partTargets(root, view);
  const byId = new Map(
    all.filter((node) => node.id).map((node) => [node.id, node])
  );
  const parts: PreparedSvgPart[] = [];
  for (const [index, target] of targets.entries()) {
    const measured = measureBounds(target, root, view);
    const [vx, vy, vw, vh] = source.viewBox;
    const x = Math.max(vx, measured.x),
      y = Math.max(vy, measured.y);
    const bounds = clipToViewBox
      ? {
          x,
          y,
          width: Math.min(vx + vw, measured.x + measured.width) - x,
          height: Math.min(vy + vh, measured.y + measured.height) - y,
        }
      : measured;
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    )
      throw new Error('SVG 图形尺寸无效');
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    const clone = root.cloneNode(true) as SVGSVGElement;
    const clonedAll = [clone, ...Array.from(clone.querySelectorAll('*'))];
    const selected = clonedAll[all.indexOf(target)];
    const ancestors = new Set<Element>();
    for (let node: Element | null = selected; node; node = node.parentElement)
      ancestors.add(node);
    const prune = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.localName === 'style') child.remove();
        else if (
          child.localName === 'defs' ||
          child === selected ||
          selected.contains(child)
        )
          continue;
        else if (ancestors.has(child)) prune(child);
        else child.remove();
      }
    };
    // Freeze computed paint before removing selector context (including nth-child rules).
    for (const [i, original] of all.entries()) {
      const copy = clonedAll[i];
      if (original.localName === 'style') continue;
      const computed = view.getComputedStyle(original);
      copy.removeAttribute('style');
      for (const name of styleNames) {
        const value = computed.getPropertyValue(name);
        if (value) copy.setAttribute(name, localReferences(value));
      }
      const transform = computed.getPropertyValue('transform');
      if (transform && transform !== 'none')
        copy.setAttribute('transform', transform);
    }
    prune(clone);
    clone.querySelectorAll('style').forEach((node) => node.remove());
    // A <use> can reference a visible sibling, not only nodes already under defs.
    const definitions =
      clone.querySelector('defs') ||
      clone.insertBefore(doc.createElementNS(NS, 'defs'), clone.firstChild);
    for (let pass = 0; pass < 32; pass++) {
      let added = false;
      const known = new Set(
        Array.from(clone.querySelectorAll('[id]')).map((node) => node.id)
      );
      for (const node of Array.from(clone.querySelectorAll('*'))) {
        for (const attr of Array.from(node.attributes)) {
          const ids =
            attr.localName === 'href' && attr.value.startsWith('#')
              ? [attr.value.slice(1)]
              : Array.from(
                  attr.value.matchAll(/url\(#([\w:.-]+)\)/g),
                  (match) => match[1]
                );
          for (const id of ids) {
            if (known.has(id)) continue;
            const original = byId.get(id);
            if (!original) throw new Error('SVG 内部引用缺失，原图已保留');
            const reference = clonedAll[all.indexOf(original)].cloneNode(true);
            definitions.appendChild(reference);
            known.add(id);
            added = true;
          }
        }
      }
      if (!added) break;
      if (pass === 31) throw new Error('SVG 引用层级过深，原图已保留');
    }
    const partId = `svg-part-${idCreator()}`;
    selected.setAttribute('data-svg-part', partId);
    clone.setAttribute(
      'viewBox',
      `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`
    );
    clone.setAttribute('width', String(bounds.width));
    clone.setAttribute('height', String(bounds.height));
    const painted = shapes.has(selected.localName)
      ? [selected]
      : Array.from(
          selected.querySelectorAll(
            'path,rect,circle,ellipse,line,polyline,polygon,text,use'
          )
        );
    const uniform = (name: string) => {
      if (
        painted.some(
          (node) =>
            node.localName === 'use' ||
            (node.localName === 'text' && node.children.length > 0)
        )
      )
        return undefined;
      const values = new Set(
        painted.map(
          (node) =>
            node.getAttribute(name) || (name === 'fill' ? 'black' : 'none')
        )
      );
      const value = values.size === 1 ? [...values][0] : undefined;
      return value && !value.includes('url(') ? value : undefined;
    };
    const markup = new XMLSerializer().serializeToString(clone);
    inspectSvgSource(markup);
    parts.push({
      markup,
      bounds,
      partId,
      label: target.id || `${target.localName} ${index + 1}`,
      fill: uniform('fill'),
      stroke: uniform('stroke'),
      ...(target.localName === 'text' && target.children.length === 0
        ? { text: target.textContent || '' }
        : {}),
    });
  }
  if (!parts.length) throw new Error('没有可显示的矢量部件，原图已保留');
  return parts;
}

export async function measureSvgVectorParts(
  source: SvgSource,
  signal?: AbortSignal,
  clipToViewBox = true
): Promise<PreparedSvgPart[]> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('title', 'SVG 部件尺寸读取');
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '800px',
    height: '800px',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(new Error('SVG 转换已取消'));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () => reject(new Error('SVG 尺寸读取超时，原图已保留')),
        10_000
      );
      frame.onload = () => {
        try {
          signal?.throwIfAborted();
          if (!frame.contentDocument) throw new Error('SVG 尺寸文档不可用');
          resolve(
            prepareSvgVectorParts(frame.contentDocument, source, clipToViewBox)
          );
        } catch (error) {
          reject(error);
        }
      };
      signal?.throwIfAborted();
      frame.srcdoc = buildSvgSandboxDocument(source);
      document.body.appendChild(frame);
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
    frame.remove();
  }
}

async function cacheSvg(markup: string): Promise<string> {
  inspectSvgSource(markup);
  const url = `/__aitu_cache__/image/svg-edit-${idCreator()}.svg`;
  await unifiedCacheService.cacheMediaFromBlob(
    url,
    new Blob([markup], { type: 'image/svg+xml' }),
    'image'
  );
  const stored = await unifiedCacheService.getCachedBlob(url, {
    allowNetwork: false,
  });
  if (!stored || !stored.size)
    throw new Error('SVG 保存到本地缓存失败，原图已保留');
  return url;
}

export async function insertEditableSvgParts(
  board: PlaitBoard,
  image: SvgImageElement,
  source: SvgSource,
  parts: PreparedSvgPart[],
  isCurrent: () => boolean
): Promise<number> {
  const assertCurrent = () => {
    if (
      !isCurrent() ||
      !board.children.some(
        (node) => node.id === image.id && node.url === image.url
      )
    )
      throw new Error('画布或原图已变化，请重新选择 SVG');
  };
  assertCurrent();
  if (!source.canConvert || !parts.length || parts.length > 200)
    throw new Error(source.conversionReason || 'SVG 部件不可用');
  if (image.angle || image.image3DTransform)
    throw new Error('请先恢复 SVG 的二维原始方向，再转换为可编辑元素');
  if (typeof image.opacity === 'number' && image.opacity !== 1)
    throw new Error('请先将 SVG 画布透明度恢复为 100%，再转换为可编辑元素');
  const sourceUrl = /^\/(?:__aitu_cache__|asset-library)\//.test(image.url)
    ? image.url
    : await cacheSvg(source.markup);
  assertCurrent();
  const staged = [];
  for (const part of parts) {
    staged.push({ part, url: await cacheSvg(part.markup) });
    assertCurrent();
  }
  const current = board.children.find(
    (node) => node.id === image.id
  ) as SvgImageElement;
  const [[x1, y1], [x2, y2]] = current.points;
  const width = Math.abs(x2 - x1),
    height = Math.abs(y2 - y1);
  const [vx, vy, vw, vh] = source.viewBox;
  const aspect =
    parseSvgDocument(source.markup).documentElement.getAttribute(
      'preserveAspectRatio'
    ) || 'xMidYMid meet';
  const align = aspect.replace(/^defer\s+/, '').trim();
  const uniformScale = align.includes('slice')
    ? Math.max(width / vw, height / vh)
    : Math.min(width / vw, height / vh);
  const sx = align === 'none' ? width / vw : uniformScale;
  const sy = align === 'none' ? height / vh : uniformScale;
  const offsetX =
    align === 'none' || align.includes('xMin')
      ? 0
      : (width - vw * sx) * (align.includes('xMax') ? 1 : 0.5);
  const offsetY =
    align === 'none' || align.includes('YMin')
      ? 0
      : (height - vh * sy) * (align.includes('YMax') ? 1 : 0.5);
  if (align.includes('slice'))
    throw new Error('SVG 使用了裁切式宽高比，暂不支持拆分，原图已保留');
  const [origin] = placeImageColumn(
    board,
    [Math.max(x1, x2) + IMAGE_LINEAGE_GAP, Math.min(y1, y2)],
    [{ width, height }]
  );
  const elements = staged.map(({ part, url }) => {
    const x = origin[0] + offsetX + (part.bounds.x - vx) * sx,
      y = origin[1] + offsetY + (part.bounds.y - vy) * sy;
    return {
      id: idCreator(),
      type: 'image',
      url,
      points: [
        [x, y],
        [x + part.bounds.width * sx, y + part.bounds.height * sy],
      ],
      svgVectorPart: {
        version: 1,
        sourceUrl,
        sourceElementId: image.id,
        partId: part.partId,
        label: part.label,
        ...(part.fill !== undefined ? { fill: part.fill } : {}),
        ...(part.stroke !== undefined ? { stroke: part.stroke } : {}),
        ...(part.text !== undefined ? { text: part.text } : {}),
      },
    } as SvgImageElement;
  });
  assertCurrent();
  const history = board.history
    ? { undos: [...board.history.undos], redos: [...board.history.redos] }
    : undefined;
  let failed = false;
  let failure: unknown;
  PlaitHistoryBoard.withNewBatch(board, () => {
    try {
      for (const element of elements)
        Transforms.insertNode(board, element, [board.children.length]);
    } catch (error) {
      failed = true;
      failure = error;
      PlaitHistoryBoard.withoutSaving(board, () => {
        for (const element of [...elements].reverse()) {
          const index = board.children.findIndex(
            (node) => node.id === element.id
          );
          if (index >= 0) Transforms.removeNode(board, [index]);
        }
      });
    }
  });
  if (failed) {
    if (history) {
      board.history.undos = history.undos;
      board.history.redos = history.redos;
    }
    throw failure;
  }
  return elements.length;
}

export async function updateSvgVectorPart(
  board: PlaitBoard,
  image: SvgImageElement,
  source: SvgSource,
  changes: { fill?: string; stroke?: string; text?: string },
  isCurrent: () => boolean,
  measure = measureSvgVectorParts,
  signal?: AbortSignal
): Promise<void> {
  const metadata = image.svgVectorPart;
  if (!metadata || metadata.version !== 1)
    throw new Error('SVG 部件信息不可用');
  if (image.angle || image.image3DTransform)
    throw new Error('请先恢复 SVG 部件的二维原始方向，再修改颜色或文字');
  const doc = parseSvgDocument(source.markup);
  const target = Array.from(doc.querySelectorAll('[data-svg-part]')).find(
    (node) => node.getAttribute('data-svg-part') === metadata.partId
  );
  if (!target) throw new Error('SVG 原始部件已变化，请重新选择');
  const painted = shapes.has(target.localName)
    ? [target]
    : Array.from(
        target.querySelectorAll(
          'path,rect,circle,ellipse,line,polyline,polygon,text,use'
        )
      );
  for (const key of ['fill', 'stroke'] as const) {
    const value = changes[key];
    if (value === undefined) continue;
    const probe = document.createElement('span').style;
    probe.color = value.trim();
    if (
      metadata[key] === undefined ||
      !value.trim() ||
      value.length > 100 ||
      (value !== 'none' && !probe.color)
    )
      throw new Error('请输入有效的 SVG 颜色');
    for (const node of painted) node.setAttribute(key, value.trim());
  }
  if (changes.text !== undefined) {
    if (
      metadata.text === undefined ||
      target.localName !== 'text' ||
      changes.text.length > 2000
    )
      throw new Error('此 SVG 文字结构暂不支持直接修改');
    target.textContent = changes.text;
  }
  const updatedSource = inspectSvgSource(
    new XMLSerializer().serializeToString(doc.documentElement)
  );
  const measured = await measure(updatedSource, signal, false);
  if (measured.length !== 1)
    throw new Error('SVG 部件结构已变化，原部件已保留');
  const updated = measured[0];
  if (!isCurrent()) throw new Error('画布或图片已变化，请重新选择');
  const url = await cacheSvg(updated.markup);
  const index = board.children.findIndex(
    (node) => node.id === image.id && node.url === image.url
  );
  if (!isCurrent() || index < 0)
    throw new Error('画布或图片已变化，请重新选择');
  const current = board.children[index] as SvgImageElement;
  const [vx, vy, vw, vh] = source.viewBox;
  const [[x1, y1], [x2, y2]] = current.points;
  const sx = (x2 - x1) / vw,
    sy = (y2 - y1) / vh;
  const x = x1 + (updated.bounds.x - vx) * sx,
    y = y1 + (updated.bounds.y - vy) * sy;
  const points: [Point, Point] = [
    [x, y],
    [x + updated.bounds.width * sx, y + updated.bounds.height * sy],
  ];
  PlaitHistoryBoard.withNewBatch(board, () =>
    Transforms.setNode(
      board,
      {
        url,
        points,
        svgVectorPart: { ...metadata, ...changes, partId: updated.partId },
      } as Partial<SvgImageElement>,
      [index]
    )
  );
}
