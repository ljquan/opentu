import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { $view } from '@milkdown/kit/utils';
import { imageBlockConfig, type ImageBlockConfig } from '@milkdown/kit/component/image-block';
import { normalizeImageDataUrl } from '@aitu/utils';
import { subscribeAssetMap, getAssetMapSnapshot } from '../../../stores/asset-map-store';
import { AssetType } from '../../../types/asset.types';
import { extractAssetIdFromUrl } from '../../../utils/markdown-asset-embeds';
import { parseMarkdownImageAlt } from '../../../utils/markdown-image-blocks';
import { markdownImageBlockSchema } from './schema';

interface ImageBlockAttrs {
  src: string;
  alt: string;
  caption: string;
  ratio: number;
  width: number | null;
  height: number | null;
}

interface MarkdownImageBlockProps {
  attrs: ImageBlockAttrs;
  selected: boolean;
  readonly: boolean;
  config: ImageBlockConfig;
  updateAttrs: (attrs: Partial<ImageBlockAttrs>) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeDimension(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.round(value);
}

function EmptyImageBlock({
  attrs,
  readonly,
  config,
  updateAttrs,
}: Pick<MarkdownImageBlockProps, 'attrs' | 'readonly' | 'config' | 'updateAttrs'>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentLink, setCurrentLink] = useState(attrs.src || '');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    setCurrentLink(attrs.src || '');
  }, [attrs.src]);

  const confirmLink = useCallback(() => {
    updateAttrs({ src: currentLink.trim() });
  }, [currentLink, updateAttrs]);

  const handleUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const uploadedSrc = await config.onUpload(file);
      if (!uploadedSrc) {
        return;
      }
      setCurrentLink(uploadedSrc);
      updateAttrs({ src: uploadedSrc });
    } catch (error) {
      console.error('Failed to upload image block file', error);
    } finally {
      event.target.value = '';
    }
  }, [config, updateAttrs]);

  return (
    <div className="image-edit collimind-markdown-image-block__edit">
      <div className="image-icon">{config.imageIcon || '🌌'}</div>
      <div className={`link-importer ${isFocused ? 'focus' : ''}`}>
        <input
          className="link-input-area"
          value={currentLink}
          disabled={readonly}
          onChange={(event) => setCurrentLink(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              confirmLink();
            }
          }}
        />
        {!currentLink && (
          <div className="placeholder">
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              disabled={readonly}
              onChange={handleUpload}
            />
            <button
              type="button"
              className="uploader"
              disabled={readonly}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              {config.uploadButton || 'Upload'}
            </button>
            <span className="text">{config.uploadPlaceholderText}</span>
          </div>
        )}
      </div>
      {!!currentLink && (
        <button
          type="button"
          className="confirm"
          disabled={readonly}
          onMouseDown={(event) => event.preventDefault()}
          onClick={confirmLink}
        >
          {config.confirmButton || 'Confirm'}
        </button>
      )}
    </div>
  );
}

function RenderedImageBlock({
  attrs,
  selected,
  readonly,
  updateAttrs,
}: Pick<MarkdownImageBlockProps, 'attrs' | 'selected' | 'readonly' | 'updateAttrs'>) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const assetMap = useSyncExternalStore(subscribeAssetMap, getAssetMapSnapshot);
  const [draftSize, setDraftSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setDraftSize(null);
  }, [attrs.width, attrs.height]);

  const assetId = useMemo(() => extractAssetIdFromUrl(attrs.src), [attrs.src]);
  const asset = assetId ? assetMap.get(assetId) : undefined;
  const parsedAlt = useMemo(() => parseMarkdownImageAlt(attrs.alt), [attrs.alt]);

  const displayAlt = assetId
    ? (parsedAlt.label || asset?.name || '素材图片')
    : (attrs.alt || '图片');

  const resolvedSrc = useMemo(() => {
    if (assetId) {
      if (!asset) {
        return null;
      }
      if (asset.type !== AssetType.IMAGE) {
        return null;
      }
      return normalizeImageDataUrl(asset.url);
    }

    return normalizeImageDataUrl(attrs.src);
  }, [asset, assetId, attrs.src]);

  const explicitWidth = draftSize?.width ?? normalizeDimension(attrs.width);
  const explicitHeight = draftSize?.height ?? normalizeDimension(attrs.height);

  const frameStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {};
    if (explicitWidth) {
      style.width = `${explicitWidth}px`;
    } else {
      style.maxWidth = 'min(100%, 420px)';
    }
    if (explicitHeight) {
      style.height = `${explicitHeight}px`;
    }
    return style;
  }, [explicitHeight, explicitWidth]);

  const imageStyle = useMemo<CSSProperties>(() => {
    if (explicitWidth && explicitHeight) {
      return {
        width: '100%',
        height: '100%',
        objectFit: 'fill',
      };
    }

    if (explicitWidth) {
      return {
        width: '100%',
        height: 'auto',
      };
    }

    if (explicitHeight) {
      return {
        width: 'auto',
        height: '100%',
      };
    }

    return {
      width: '100%',
      height: 'auto',
    };
  }, [explicitHeight, explicitWidth]);

  const startResize = useCallback((handle: 'right' | 'bottom' | 'corner') => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readonly) {
      return;
    }

    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const editorRoot = frame.closest('.ProseMirror');
    const maxWidth = Math.max(120, (editorRoot?.getBoundingClientRect().width ?? rect.width) - 32);
    const startState = {
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    };

    let nextSize = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startState.x;
      const dy = moveEvent.clientY - startState.y;

      const width = handle === 'bottom'
        ? startState.width
        : clamp(startState.width + dx, 80, maxWidth);
      const height = handle === 'right'
        ? startState.height
        : clamp(startState.height + dy, 80, 1600);

      nextSize = {
        width: Math.round(width),
        height: Math.round(height),
      };
      setDraftSize(nextSize);
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      setDraftSize(nextSize);
      updateAttrs({
        width: nextSize.width,
        height: nextSize.height,
      });
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp, { once: true });
  }, [readonly, updateAttrs]);

  if (assetId && !asset && assetMap.size === 0) {
    return <div className="collimind-markdown-image-block__loading" />;
  }

  if (!resolvedSrc) {
    return (
      <div className="collimind-markdown-image-block__missing">
        {assetId ? `图片素材不存在或已删除 (${assetId.slice(0, 8)}…)` : '图片地址无效'}
      </div>
    );
  }

  return (
    <div
      className={`collimind-markdown-image-block__shell ${selected ? 'is-selected' : ''}`}
      data-asset-id={assetId || undefined}
    >
      <div ref={frameRef} className="collimind-markdown-image-block__frame" style={frameStyle}>
        <img
          className="collimind-markdown-image-block__image"
          src={resolvedSrc}
          alt={displayAlt}
          draggable={false}
          style={imageStyle}
        />
        {!readonly && selected && (
          <>
            <button
              type="button"
              data-resize-handle="right"
              className="collimind-markdown-image-block__handle collimind-markdown-image-block__handle--right"
              onPointerDown={startResize('right')}
              aria-label="调整图片宽度"
            />
            <button
              type="button"
              data-resize-handle="bottom"
              className="collimind-markdown-image-block__handle collimind-markdown-image-block__handle--bottom"
              onPointerDown={startResize('bottom')}
              aria-label="调整图片高度"
            />
            <button
              type="button"
              data-resize-handle="corner"
              className="collimind-markdown-image-block__handle collimind-markdown-image-block__handle--corner"
              onPointerDown={startResize('corner')}
              aria-label="同时调整图片宽高"
            />
          </>
        )}
      </div>
      {attrs.caption && (
        <div className="collimind-markdown-image-block__caption">{attrs.caption}</div>
      )}
    </div>
  );
}

function MarkdownImageBlock(props: MarkdownImageBlockProps) {
  if (!props.attrs.src) {
    return <EmptyImageBlock {...props} />;
  }

  return <RenderedImageBlock {...props} />;
}

export const markdownImageBlockView = $view(markdownImageBlockSchema.node, (ctx) => {
  const config = ctx.get(imageBlockConfig.key);

  return (initialNode: any, view: any, getPos: () => number | undefined) => {
    const dom = document.createElement('div');
    dom.className = 'milkdown-image-block collimind-markdown-image-block';
    dom.draggable = true;

    let currentNode = initialNode;
    let selected = false;
    let reactRoot: Root | null = createRoot(dom);

    const updateAttrs = (attrs: Partial<ImageBlockAttrs>) => {
      if (!view.editable) {
        return;
      }

      const pos = getPos();
      if (pos == null) {
        return;
      }

      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
        ...currentNode.attrs,
        ...attrs,
      }));
    };

    const renderNode = () => {
      reactRoot?.render(
        <MarkdownImageBlock
          attrs={currentNode.attrs as ImageBlockAttrs}
          selected={selected}
          readonly={!view.editable}
          config={config}
          updateAttrs={updateAttrs}
        />
      );
    };

    renderNode();

    return {
      dom,
      update: (updatedNode: any) => {
        if (updatedNode.type !== initialNode.type) {
          return false;
        }

        currentNode = updatedNode;
        renderNode();
        return true;
      },
      stopEvent: (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        return Boolean(
          target.closest('.image-edit')
          || target.closest('[data-resize-handle]')
        );
      },
      selectNode: () => {
        selected = true;
        dom.classList.add('selected');
        renderNode();
      },
      deselectNode: () => {
        selected = false;
        dom.classList.remove('selected');
        renderNode();
      },
      destroy: () => {
        if (reactRoot) {
          const root = reactRoot;
          reactRoot = null;
          setTimeout(() => root.unmount(), 0);
        }
      },
    };
  };
});
