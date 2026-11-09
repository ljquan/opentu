import { sha256 } from '@noble/hashes/sha256';

const NS = 'http://www.w3.org/2000/svg';
export const SVG_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export const SVG_SOURCE_MAX_NODES = 2000;
const graphics = new Set([
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
const allowed = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  ...graphics,
  'tspan',
  'title',
  'desc',
  'style',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'image',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feFlood',
  'feComposite',
  'feMerge',
  'feMergeNode',
  'feColorMatrix',
  'feBlend',
  'feDropShadow',
  'feComponentTransfer',
  'feFuncR',
  'feFuncG',
  'feFuncB',
  'feFuncA',
  'animate',
  'animateTransform',
  'animateMotion',
  'mpath',
  'set',
]);
const animationAttributes = new Set([
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
  'opacity',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dashoffset',
  'transform',
  'd',
  'points',
  'visibility',
]);

export interface SvgSource {
  markup: string;
  viewBox: [number, number, number, number];
  vectorCount: number;
  hasRaster: boolean;
  animation: { smil: boolean; css: boolean; detected: boolean };
  canConvert: boolean;
  conversionReason?: string;
}

export function isSvgUrl(url: string): boolean {
  return /^data:image\/svg\+xml[;,]/i.test(url) || /\.svg(?:[?#]|$)/i.test(url);
}

function decodeCss(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(
      /\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
      (_, hex: string, escaped: string) =>
        hex
          ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff))
          : escaped
    );
}

function checkCss(value: string): void {
  const decoded = decodeCss(value);
  if (/@import|@font-face|expression\s*\(|javascript\s*:|[<>]/i.test(decoded)) {
    throw new Error('SVG 含不支持的脚本或外部样式，保留原图显示');
  }
  let remaining = decoded.replace(/url\(\s*(["']?)#[\w:.-]+\1\s*\)/gi, '');
  if (/url\s*\(/i.test(remaining))
    throw new Error('SVG 引用了外部资源，暂不能安全编辑或控制动画');
  remaining = remaining.replace(/@(?:-webkit-)?keyframes\b/gi, '');
  if (/@/.test(remaining))
    throw new Error('SVG 含暂不支持的条件样式，保留原图显示');
}

export function parseSvgDocument(markup: string): XMLDocument {
  if (new TextEncoder().encode(markup).length > SVG_SOURCE_MAX_BYTES)
    throw new Error('SVG 超过 2 MB，保留原图显示');
  if (/<!DOCTYPE|<!ENTITY/i.test(markup))
    throw new Error('SVG 含外部实体声明，保留原图显示');
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (
    doc.querySelector('parsererror') ||
    root.localName !== 'svg' ||
    root.namespaceURI !== NS
  )
    throw new Error('SVG 原文件格式无效');
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
  if (nodes.length > SVG_SOURCE_MAX_NODES)
    throw new Error('SVG 元素过多，保留原图显示');
  for (const node of nodes) {
    if (node.namespaceURI !== NS || !allowed.has(node.localName))
      throw new Error(`SVG 含暂不支持的 ${node.localName} 元素，保留原图显示`);
    if (node.localName === 'style') checkCss(node.textContent || '');
    for (const attr of Array.from(node.attributes)) {
      const name = attr.localName.toLowerCase();
      if (
        /^on/i.test(name) ||
        name === 'base' ||
        /javascript\s*:/i.test(decodeCss(attr.value))
      )
        throw new Error('SVG 含脚本属性，保留原图显示');
      if (name === 'href') {
        if (
          !/^#[\w:.-]+$/.test(attr.value) &&
          !(
            node.localName === 'image' &&
            /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(
              attr.value
            )
          )
        ) {
          throw new Error('SVG 引用了外部资源，暂不能安全编辑或控制动画');
        }
      }
      if (name === 'style' || /url\s*\(|\\/i.test(attr.value))
        checkCss(attr.value);
    }
    if (
      ['animate', 'set'].includes(node.localName) &&
      !animationAttributes.has(node.getAttribute('attributeName') || '')
    ) {
      throw new Error('SVG 动画修改了不支持的属性，保留原图显示');
    }
    if (
      node.localName === 'animateTransform' &&
      node.getAttribute('attributeName') !== 'transform'
    ) {
      throw new Error('SVG 变换动画的目标属性不受支持，保留原图显示');
    }
  }
  return doc;
}

export function getSvgViewBox(root: Element): [number, number, number, number] {
  const raw = root.getAttribute('viewBox');
  if (raw) {
    const values = raw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2] > 0 &&
      values[3] > 0
    )
      return values as [number, number, number, number];
    throw new Error('SVG viewBox 无效');
  }
  const read = (key: string) => {
    const value = root.getAttribute(key) || '';
    return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : NaN;
  };
  const width = read('width'),
    height = read('height');
  if (!(width > 0 && height > 0)) throw new Error('SVG 缺少可用尺寸');
  return [0, 0, width, height];
}

function hasCssAnimation(root: Element): boolean {
  const styles = Array.from(root.querySelectorAll('style'))
    .map((node) => node.textContent || '')
    .join('\n');
  const keyframes = new Set(
    Array.from(
      styles.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g),
      (match) => match[1]
    )
  );
  if (!keyframes.size) return false;
  const animated = (value: string) => {
    const declaration = document.createElement('span').style;
    declaration.cssText = value.includes('{')
      ? value.slice(value.indexOf('{') + 1, value.lastIndexOf('}'))
      : value;
    const durations = declaration
      .getPropertyValue('animation-duration')
      .split(',')
      .map((part) => parseFloat(part));
    const names = declaration
      .getPropertyValue('animation-name')
      .split(',')
      .map((part) => part.trim());
    if (names.some((name) => keyframes.has(name)))
      return names.some(
        (name, index) =>
          keyframes.has(name) && durations[index % durations.length] > 0
      );
    return declaration
      .getPropertyValue('animation')
      .split(',')
      .some((part) => {
        const duration = part.match(/(-?(?:\d*\.)?\d+)(?:ms|s)\b/);
        return (
          duration &&
          Number(duration[1]) > 0 &&
          part
            .trim()
            .split(/\s+/)
            .some((token) => keyframes.has(token))
        );
      });
  };
  const rendered = (node: Element) =>
    !node.closest('defs, symbol, clipPath, mask, pattern, filter, style');
  if (
    [root, ...Array.from(root.querySelectorAll('[style]'))].some(
      (node) =>
        rendered(node) && animated(decodeCss(node.getAttribute('style') || ''))
    )
  )
    return true;
  // Parse balanced CSS rules using an inert sheet; an unused keyframe is not an animation.
  const sheet = new CSSStyleSheet();
  try {
    const rules = styles.match(/[^{}]+\{[^{}]*\}/g) || [];
    for (const rule of rules) {
      if (!/animation(?:-name)?\s*:/.test(rule) || !animated(rule)) continue;
      try {
        const index = sheet.insertRule(rule, sheet.cssRules.length);
        const css = sheet.cssRules[index] as CSSStyleRule;
        if (
          css.selectorText &&
          (root.matches(css.selectorText) ||
            Array.from(root.querySelectorAll(css.selectorText)).some(rendered))
        )
          return true;
      } catch {
        /* Unsupported selectors cannot advertise working playback. */
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function inspectSvgSource(markup: string): SvgSource {
  const doc = parseSvgDocument(markup),
    root = doc.documentElement;
  const visible = Array.from(root.querySelectorAll('*')).filter(
    (node) => !node.closest('defs, symbol, clipPath, mask, pattern, filter')
  );
  const vectorCount = visible.filter((node) =>
    graphics.has(node.localName)
  ).length;
  const hasRaster = !!root.querySelector('image');
  const animations = Array.from(
    root.querySelectorAll('animate, animateTransform, animateMotion, set')
  );
  const smil = animations.some(
    (node) =>
      !node.closest('defs, symbol, clipPath, mask, pattern, filter') &&
      /^(?:\d*\.)?\d+(?:ms|s|min|h)$/.test(node.getAttribute('dur') || '') &&
      parseFloat(node.getAttribute('dur') || '0') > 0 &&
      (!node.hasAttribute('begin') ||
        /^(?:\d*\.)?\d+(?:ms|s|min|h)?$/.test(node.getAttribute('begin') || ''))
  );
  const css = hasCssAnimation(root);
  const detected =
    animations.length > 0 ||
    /(?:animation(?:-name)?\s*:|@(?:-webkit-)?keyframes)/i.test(markup);
  const canConvert = vectorCount > 0 && !hasRaster && !detected;
  return {
    markup: new XMLSerializer().serializeToString(root),
    viewBox: getSvgViewBox(root),
    vectorCount,
    hasRaster,
    animation: { smil, css, detected },
    canConvert,
    conversionReason: canConvert
      ? undefined
      : hasRaster
      ? 'SVG 中含位图，保留完整原图，不能作为纯矢量拆分'
      : detected
      ? '此 SVG 含动画定义，保留原文件；当前仅转换静态 SVG'
      : '没有可独立编辑的矢量图形',
  };
}

export function buildSvgSandboxDocument(source: SvgSource): string {
  const root = parseSvgDocument(source.markup).documentElement;
  const layout =
    'html,body{margin:0;width:100%;height:100%;overflow:hidden}body>svg{width:100%;height:100%;display:block}';
  const styles = [
    layout,
    ...Array.from(
      root.querySelectorAll('style'),
      (node) => node.textContent || ''
    ),
    ...[root, ...Array.from(root.querySelectorAll('[style]'))]
      .map((node) => node.getAttribute('style') || '')
      .filter(Boolean),
  ];
  const hashes = [...new Set(styles)]
    .map(
      (style) =>
        `'sha256-${btoa(
          String.fromCharCode(...sha256(new TextEncoder().encode(style)))
        )}'`
    )
    .join(' ');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-hashes' ${hashes}; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'"><style>${layout}</style></head><body>${source.markup}</body></html>`;
}

export function controlSvgAnimation(
  doc: Document,
  paused: boolean,
  reset = false
): void {
  const root = doc.querySelector('svg');
  if (!root) throw new Error('SVG 文档未就绪');
  const svg = root as SVGSVGElement;
  if (typeof svg.pauseAnimations === 'function') {
    if (reset && typeof svg.setCurrentTime === 'function')
      svg.setCurrentTime(0);
    if (paused) svg.pauseAnimations();
    else svg.unpauseAnimations();
  }
  if (typeof doc.getAnimations === 'function') {
    for (const animation of doc.getAnimations()) {
      if (reset) animation.currentTime = 0;
      if (paused) animation.pause();
      else animation.play();
    }
  }
}

export function supportsSvgPlayback(source: SvgSource): boolean {
  return (
    (!source.animation.smil ||
      typeof SVGSVGElement.prototype.pauseAnimations === 'function') &&
    (!source.animation.css || typeof document.getAnimations === 'function') &&
    (source.animation.smil || source.animation.css)
  );
}
