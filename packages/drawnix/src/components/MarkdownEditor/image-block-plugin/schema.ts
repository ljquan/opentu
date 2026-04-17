import { $nodeSchema } from '@milkdown/kit/utils';
import {
  buildMarkdownImageTitle,
  isNumericImageRatioAlt,
  parseMarkdownImageTitle,
} from '../../../utils/markdown-image-blocks';

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export const markdownImageBlockSchema = $nodeSchema('image-block', () => ({
  inline: false,
  group: 'block',
  selectable: true,
  draggable: true,
  isolating: true,
  marks: '',
  atom: true,
  priority: 100,
  attrs: {
    src: { default: '' },
    alt: { default: '' },
    caption: { default: '' },
    ratio: { default: 1 },
    width: { default: null },
    height: { default: null },
  },
  parseMarkdown: {
    match: ({ type }: { type: string }) => type === 'image-block',
    runner: (state: any, node: any, type: any) => {
      const rawAlt = typeof node.alt === 'string' ? node.alt : '';
      const parsedTitle = parseMarkdownImageTitle(node.title as string | undefined);
      const ratio = isNumericImageRatioAlt(rawAlt)
        ? Number.parseFloat(rawAlt)
        : 1;

      state.addNode(type, {
        src: node.url as string,
        alt: isNumericImageRatioAlt(rawAlt) ? '' : rawAlt,
        caption: parsedTitle.caption,
        ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
        width: parsedTitle.width ?? null,
        height: parsedTitle.height ?? null,
      });
    },
  },
  toMarkdown: {
    match: (node: any) => node.type.name === 'image-block',
    runner: (state: any, node: any) => {
      const markdownTitle = buildMarkdownImageTitle({
        width: normalizeOptionalNumber(node.attrs.width),
        height: normalizeOptionalNumber(node.attrs.height),
        caption: node.attrs.caption,
      });

      const markdownAlt = node.attrs.alt
        || ((!node.attrs.width && !node.attrs.height && node.attrs.ratio && node.attrs.ratio !== 1)
          ? `${Number.parseFloat(String(node.attrs.ratio)).toFixed(2)}`
          : '');

      state.openNode('paragraph');
      state.addNode('image', undefined, undefined, {
        title: markdownTitle,
        url: node.attrs.src,
        alt: markdownAlt,
      });
      state.closeNode();
    },
  },
  toDOM: (node: any) => [
    'div',
    {
      'data-type': 'opentu-image-block',
      'data-src': node.attrs.src,
      'data-alt': node.attrs.alt,
      'data-caption': node.attrs.caption,
      'data-ratio': node.attrs.ratio,
      'data-width': node.attrs.width ?? '',
      'data-height': node.attrs.height ?? '',
    },
  ],
  parseDOM: [
    {
      tag: 'div[data-type="opentu-image-block"]',
      getAttrs: (dom: HTMLElement) => ({
        src: dom.getAttribute('data-src') || '',
        alt: dom.getAttribute('data-alt') || '',
        caption: dom.getAttribute('data-caption') || '',
        ratio: Number(dom.getAttribute('data-ratio') ?? 1) || 1,
        width: normalizeOptionalNumber(dom.getAttribute('data-width')),
        height: normalizeOptionalNumber(dom.getAttribute('data-height')),
      }),
    },
    {
      tag: 'img[data-type="image-block"]',
      getAttrs: (dom: HTMLElement) => ({
        src: dom.getAttribute('src') || '',
        alt: '',
        caption: dom.getAttribute('caption') || '',
        ratio: Number(dom.getAttribute('ratio') ?? 1) || 1,
        width: null,
        height: null,
      }),
    },
  ],
}));
