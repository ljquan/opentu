/**
 * remark 插件：将 asset:// 音频/视频素材引用转换为 assetEmbed 自定义节点
 *
 * 本插件注册在 Crepe 内置 remarkImageBlockPlugin 之后运行，
 * 需要同时匹配两种 MDAST 节点：
 * - `image`：尚未被 image-block 插件处理的 inline image
 * - `image-block`：已被 Crepe 的 remarkImageBlockPlugin 转换的块级图片
 */
import { $remark } from '@milkdown/kit/utils';
import { ASSET_URI_PREFIX } from '../../../utils/markdown-asset-embeds';
import { parseMarkdownImageAlt } from '../../../utils/markdown-image-blocks';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface MdastNode {
  type: string;
  url?: string;
  alt?: string;
  title?: string;
  children?: MdastNode[];
  [key: string]: any;
}

function tryConvertToAssetEmbed(node: MdastNode): MdastNode | null {
  const url = node.url;
  if (!url?.startsWith(ASSET_URI_PREFIX)) return null;
  const assetId = url.slice(ASSET_URI_PREFIX.length);
  const parsedAlt = parseMarkdownImageAlt(node.alt || '');
  const assetType = parsedAlt.assetType || 'image';
  if (assetType === 'image') return null;
  const label = parsedAlt.label || parsedAlt.rawAlt;
  return { type: 'assetEmbed', assetId, assetType, label };
}

/** 递归遍历 MDAST，将 asset:// 引用转换为 assetEmbed */
function transformAssetImages(node: MdastNode): void {
  if (!node.children) return;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    // 1. 已被 Crepe remarkImageBlockPlugin 转换的 image-block 节点
    if (child.type === 'image-block') {
      const embed = tryConvertToAssetEmbed(child);
      if (embed) { node.children[i] = embed; continue; }
    }

    // 2. paragraph 内含 asset:// image — 提取为独立 assetEmbed 节点
    if (child.type === 'paragraph' && child.children) {
      const embeds: MdastNode[] = [];
      const remaining: MdastNode[] = [];
      for (const img of child.children) {
        if (img.type === 'image') {
          const embed = tryConvertToAssetEmbed(img);
          if (embed) { embeds.push(embed); continue; }
        }
        remaining.push(img);
      }
      if (embeds.length > 0) {
        // 用 embeds 替换原 paragraph，保留非素材内容
        const replacements: MdastNode[] = [];
        if (remaining.length > 0) {
          replacements.push({ ...child, children: remaining });
        }
        replacements.push(...embeds);
        node.children.splice(i, 1, ...replacements);
        i += replacements.length - 1;
        continue;
      }
    }

    // 3. 独立 inline image
    if (child.type === 'image') {
      const embed = tryConvertToAssetEmbed(child);
      if (embed) { node.children[i] = embed; continue; }
    }

    transformAssetImages(child);
  }
}

export const remarkAssetEmbed = $remark('remarkAssetEmbed', () => () => transformAssetImages as any);
