/**
 * assetEmbed NodeView — React 渲染
 *
 * 通过 useSyncExternalStore 订阅 global asset store，
 * 资产加载后自动重新渲染，无需 DOM hack。
 */
import React, { useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { $view } from '@milkdown/kit/utils';
import { normalizeImageDataUrl } from '@aitu/utils';
import { subscribeAssetMap, getAssetMapSnapshot } from '../../../stores/asset-map-store';
import { AssetType } from '../../../types/asset.types';
import { MarkdownAudioAssetCard } from '../MarkdownAudioAssetCard';
import { VideoPosterPreview } from '../../shared/VideoPosterPreview';
import { assetEmbedSchema } from './schema';

interface AssetEmbedViewProps {
  assetId: string;
  assetType: string;
  label: string;
}

const AssetEmbedView: React.FC<AssetEmbedViewProps> = ({ assetId, assetType, label }) => {
  const assetMap = useSyncExternalStore(subscribeAssetMap, getAssetMapSnapshot);
  const asset = assetMap.get(assetId);

  // asset map 为空说明资产还在加载中，显示占位而非"已删除"
  if (!asset) {
    if (assetMap.size === 0) {
      return <div className="collimind-asset-embed__loading" />;
    }
    return (
      <div className="collimind-asset-embed__missing">
        素材不存在或已删除 ({assetId.slice(0, 8)}…)
      </div>
    );
  }

  if (asset.type === AssetType.IMAGE) {
    return (
      <img
        className="collimind-asset-embed__image"
        src={normalizeImageDataUrl(asset.url)}
        alt={label || asset.name || '素材图片'}
      />
    );
  }

  if (asset.type === AssetType.VIDEO) {
    return (
      <div className="collimind-asset-embed__video-wrap">
        <VideoPosterPreview
          className="collimind-asset-embed__video"
          src={asset.url}
          poster={asset.thumbnail}
          alt={label || asset.name || '素材视频'}
          thumbnailSize="large"
          activateVideoOnClick
          playOnActivate
          videoProps={{
            controls: true,
            preload: 'metadata',
            playsInline: true,
          }}
        />
        {(label || asset.name) && (
          <div className="collimind-asset-embed__caption">{label || asset.name}</div>
        )}
      </div>
    );
  }

  if (asset.type === AssetType.AUDIO) {
    return <MarkdownAudioAssetCard asset={asset} />;
  }

  return null;
};

export const assetEmbedView = $view(assetEmbedSchema.node, () => {
  return (initialNode: any) => {
    const dom = document.createElement('div');
    dom.className = 'collimind-asset-embed';
    dom.setAttribute('data-asset-id', initialNode.attrs.assetId);

    let reactRoot: Root | null = createRoot(dom);

    const renderNode = (node: any) => {
      reactRoot?.render(
        <AssetEmbedView
          assetId={node.attrs.assetId}
          assetType={node.attrs.assetType}
          label={node.attrs.label}
        />
      );
    };
    renderNode(initialNode);

    return {
      dom,
      update: (updatedNode: any) => {
        if (updatedNode.type !== initialNode.type) return false;
        renderNode(updatedNode);
        return true;
      },
      destroy: () => {
        if (reactRoot) {
          // 延迟 unmount 避免在 React 渲染期间同步卸载
          const root = reactRoot;
          reactRoot = null;
          setTimeout(() => root.unmount(), 0);
        }
      },
    };
  };
});
