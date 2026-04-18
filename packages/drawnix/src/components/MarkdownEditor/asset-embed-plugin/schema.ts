/**
 * assetEmbed ProseMirror 节点 schema
 *
 * 存储 assetId / assetType / label，
 * toMarkdown 还原为 ![type|label](asset://id) 标准图片语法。
 */
import { $nodeSchema } from '@milkdown/kit/utils';
import { ASSET_URI_PREFIX } from '../../../utils/markdown-asset-embeds';
import {
  buildMarkdownImageTitle,
  parseMarkdownImageAlt,
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

export const assetEmbedSchema = $nodeSchema('assetEmbed', () => ({
  inline: false,
  group: 'block',
  selectable: true,
  draggable: true,
  atom: true,
  attrs: {
    assetId: { default: '' },
    assetType: { default: 'image' },
    label: { default: '' },
    width: { default: null },
    height: { default: null },
  },
  parseMarkdown: {
    match: (node: { type: string; url?: string; alt?: string }) => {
      if (node.type === 'assetEmbed') return true;
      if (node.type === 'image-block' && node.url?.startsWith(ASSET_URI_PREFIX)) {
        const parsed = parseMarkdownImageAlt(node.alt);
        if (parsed.assetType && parsed.assetType !== 'image') return true;
      }
      return false;
    },
    runner: (state: any, node: any, type: any) => {
      if (node.type === 'assetEmbed') {
        state.addNode(type, {
          assetId: node.assetId as string,
          assetType: node.assetType as string,
          label: node.label as string,
          width: normalizeOptionalNumber(node.width),
          height: normalizeOptionalNumber(node.height),
        });
        return;
      }
      const assetId = (node.url as string).slice(ASSET_URI_PREFIX.length);
      const parsedAlt = parseMarkdownImageAlt(node.alt as string | undefined);
      const parsedTitle = parseMarkdownImageTitle(node.title as string | undefined);
      state.addNode(type, {
        assetId,
        assetType: parsedAlt.assetType || 'video',
        label: parsedAlt.label || '',
        width: normalizeOptionalNumber(parsedTitle.width),
        height: normalizeOptionalNumber(parsedTitle.height),
      });
    },
  },
  toMarkdown: {
    match: (node: any) => node.type.name === 'assetEmbed',
    runner: (state: any, node: any) => {
      const { assetId, assetType, label } = node.attrs;
      const alt = label ? `${assetType}|${label}` : assetType;
      const title = buildMarkdownImageTitle({
        width: normalizeOptionalNumber(node.attrs.width),
        height: normalizeOptionalNumber(node.attrs.height),
      });
      state.openNode('paragraph');
      state.addNode('image', undefined, undefined, {
        url: `${ASSET_URI_PREFIX}${assetId}`,
        alt,
        title,
      });
      state.closeNode();
    },
  },
  toDOM: (node: any) => [
    'div',
    {
      'data-type': 'asset-embed',
      'data-asset-id': node.attrs.assetId,
      'data-asset-type': node.attrs.assetType,
      'data-label': node.attrs.label,
      'data-width': node.attrs.width ?? '',
      'data-height': node.attrs.height ?? '',
    },
  ],
  parseDOM: [
    {
      tag: 'div[data-type="asset-embed"]',
      getAttrs: (dom: HTMLElement) => ({
        assetId: dom.getAttribute('data-asset-id') || '',
        assetType: dom.getAttribute('data-asset-type') || 'image',
        label: dom.getAttribute('data-label') || '',
        width: normalizeOptionalNumber(dom.getAttribute('data-width')),
        height: normalizeOptionalNumber(dom.getAttribute('data-height')),
      }),
    },
  ],
}));
