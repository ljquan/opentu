import type { ImageProps } from '@plait/common';
import { RectangleClient } from '@plait/core';
import { Loading, MessagePlugin } from 'tdesign-react';
import classNames from 'classnames';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Video } from './video';
import { generateImage } from '../../mcp/tools/image-generation';
import { getImageRegion } from '../../services/ppt';
import {
  insertMediaIntoFrame,
  removePPTImagePlaceholder,
  setFramePPTImageStatus,
  setPPTImagePlaceholderStatus,
} from '../../utils/frame-insertion-utils';
import {
  clearVirtualUrlImageError,
  handleVirtualUrlImageError,
  isVirtualUrl,
} from '../../utils/asset-cleanup';
import { unifiedCacheService } from '../../services/unified-cache-service';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';
import {
  getImage3DSourceRectangle,
  getImage3DSvgOverlayGeometry,
  isOrdinary3DTransformImage,
  sanitizeImage3DTransform,
} from '../../utils/image-3d-transform';
import { RetryImage } from '../../components/retry-image';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const EXTERNAL_IMAGE_RETRY_DELAYS = [500, 1500, 3000];

const image3DForeignObjectOverflowRefs = new WeakMap<
  SVGForeignObjectElement,
  { count: number; previousOverflow: string }
>();
const image3DForeignObjectVisibilityRefs = new WeakMap<
  SVGForeignObjectElement,
  { count: number; previousVisibility: string; previousPointerEvents: string }
>();

interface Image3DOverlayRef {
  group: SVGGElement;
  image: SVGImageElement;
  clipPath: SVGClipPathElement;
  clipPolygon: SVGPolygonElement;
}

function setImage3DForeignObjectOverflowVisible(
  foreignObject: SVGForeignObjectElement
): () => void {
  const current = image3DForeignObjectOverflowRefs.get(foreignObject);
  if (current) {
    current.count += 1;
    foreignObject.style.overflow = 'visible';
    return () => {
      current.count -= 1;
      if (current.count <= 0) {
        foreignObject.style.overflow = current.previousOverflow;
        image3DForeignObjectOverflowRefs.delete(foreignObject);
      }
    };
  }

  const previousOverflow = foreignObject.style.overflow;
  image3DForeignObjectOverflowRefs.set(foreignObject, {
    count: 1,
    previousOverflow,
  });
  foreignObject.style.overflow = 'visible';
  return () => {
    const latest = image3DForeignObjectOverflowRefs.get(foreignObject);
    if (!latest) {
      return;
    }
    latest.count -= 1;
    if (latest.count <= 0) {
      foreignObject.style.overflow = latest.previousOverflow;
      image3DForeignObjectOverflowRefs.delete(foreignObject);
    }
  };
}

function setImage3DForeignObjectHidden(
  foreignObject: SVGForeignObjectElement
): () => void {
  const current = image3DForeignObjectVisibilityRefs.get(foreignObject);
  if (current) {
    current.count += 1;
    foreignObject.style.visibility = 'hidden';
    foreignObject.style.pointerEvents = 'none';
    return () => {
      current.count -= 1;
      if (current.count <= 0) {
        foreignObject.style.visibility = current.previousVisibility;
        foreignObject.style.pointerEvents = current.previousPointerEvents;
        image3DForeignObjectVisibilityRefs.delete(foreignObject);
      }
    };
  }

  const previousVisibility = foreignObject.style.visibility;
  const previousPointerEvents = foreignObject.style.pointerEvents;
  image3DForeignObjectVisibilityRefs.set(foreignObject, {
    count: 1,
    previousVisibility,
    previousPointerEvents,
  });
  foreignObject.style.visibility = 'hidden';
  foreignObject.style.pointerEvents = 'none';

  return () => {
    const latest = image3DForeignObjectVisibilityRefs.get(foreignObject);
    if (!latest) {
      return;
    }
    latest.count -= 1;
    if (latest.count <= 0) {
      foreignObject.style.visibility = latest.previousVisibility;
      foreignObject.style.pointerEvents = latest.previousPointerEvents;
      image3DForeignObjectVisibilityRefs.delete(foreignObject);
    }
  };
}

// 检查是否为视频元素（通过URL标识、扩展名或元数据）
const isVideoElement = (imageItem: any): boolean => {
  // 检查是否有视频标识属性
  if (imageItem.isVideo === true || imageItem.videoType) {
    return true;
  }

  const url = imageItem.url || '';

  // 检查 URL hash 标识符（用于 ObjectURL 的视频识别）
  // 格式：blob:http://...#video 或 blob:http://...#merged-video-{timestamp}
  if (url.includes('#video') || url.includes('#merged-video-')) {
    return true;
  }

  // 检查URL扩展名（用于普通 URL 的视频识别）
  const videoExtensions = [
    '.mp4',
    '.avi',
    '.mov',
    '.wmv',
    '.flv',
    '.webm',
    '.mkv',
  ];
  return videoExtensions.some((ext) => url.toLowerCase().includes(ext));
};

export const Image: React.FC<ImageProps> = (props: ImageProps) => {
  const currentImageUrlRef = useRef(props.imageItem.url);
  const cleanupSWRecoveryRef = useRef<(() => void) | null>(null);
  const fallbackBlobUrlRef = useRef<string | null>(null);
  const fallbackAttemptedUrlRef = useRef<string | null>(null);
  const externalImageRetryAttemptRef = useRef(0);
  const externalImageRetryTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgOverlayRef = useRef<Image3DOverlayRef | null>(null);
  const pptImageGenerationLockRef = useRef(false);
  const [resolvedImageUrl, setResolvedImageUrl] = useState(props.imageItem.url);

  const clearSWRecovery = useCallback(() => {
    cleanupSWRecoveryRef.current?.();
    cleanupSWRecoveryRef.current = null;
  }, []);

  const clearFallbackBlobUrl = useCallback(() => {
    if (fallbackBlobUrlRef.current) {
      URL.revokeObjectURL(fallbackBlobUrlRef.current);
      fallbackBlobUrlRef.current = null;
    }
  }, []);

  const clearExternalImageRetry = useCallback(() => {
    if (externalImageRetryTimerRef.current !== null) {
      window.clearTimeout(externalImageRetryTimerRef.current);
      externalImageRetryTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    currentImageUrlRef.current = props.imageItem.url;
    setResolvedImageUrl(props.imageItem.url);
    fallbackAttemptedUrlRef.current = null;
    externalImageRetryAttemptRef.current = 0;
    clearFallbackBlobUrl();
    return () => {
      clearSWRecovery();
      clearExternalImageRetry();
      clearFallbackBlobUrl();
    };
  }, [
    props.imageItem.url,
    clearExternalImageRetry,
    clearFallbackBlobUrl,
    clearSWRecovery,
  ]);

  const handleResolvedImageUrlChange = useCallback((src: string) => {
    setResolvedImageUrl(src);
  }, []);

  const retryExternalImage = useCallback(
    (imageElement: HTMLImageElement) => {
      if (!/^https?:\/\//i.test(props.imageItem.url)) {
        return;
      }

      const delay =
        EXTERNAL_IMAGE_RETRY_DELAYS[externalImageRetryAttemptRef.current];
      if (delay === undefined) {
        return;
      }

      externalImageRetryAttemptRef.current += 1;
      clearExternalImageRetry();
      externalImageRetryTimerRef.current = window.setTimeout(() => {
        externalImageRetryTimerRef.current = null;
        if (
          !imageElement.isConnected ||
          currentImageUrlRef.current !== props.imageItem.url
        ) {
          return;
        }

        imageElement.referrerPolicy = 'no-referrer';
        imageElement.src = props.imageItem.url;
      }, delay);
    },
    [clearExternalImageRetry, props.imageItem.url]
  );

  const retryImageAfterSWClaim = useCallback(
    (imageElement: HTMLImageElement) => {
      if (
        typeof navigator === 'undefined' ||
        !('serviceWorker' in navigator) ||
        navigator.serviceWorker.controller
      ) {
        return;
      }

      clearSWRecovery();

      let settled = false;
      const retry = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearSWRecovery();

        if (
          !imageElement.isConnected ||
          currentImageUrlRef.current !== props.imageItem.url
        ) {
          return;
        }

        imageElement.src = `${props.imageItem.url}${
          props.imageItem.url.includes('?') ? '&' : '?'
        }_sw_ready=${Date.now()}`;
      };

      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        clearSWRecovery();
      }, 10_000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        navigator.serviceWorker.removeEventListener('controllerchange', retry);
      };

      cleanupSWRecoveryRef.current = cleanup;
      navigator.serviceWorker.addEventListener('controllerchange', retry, {
        once: true,
      });
      navigator.serviceWorker.ready
        .then(() => {
          if (navigator.serviceWorker.controller) {
            retry();
          }
        })
        .catch(() => undefined);
    },
    [clearSWRecovery, props.imageItem.url]
  );

  // 处理图片加载失败
  const handleImageError = useCallback(
    async (event: any) => {
      const imageElement = event.currentTarget as HTMLImageElement;
      imageElement.style.visibility = 'hidden';
      if (
        isVirtualMediaUrl(props.imageItem.url) &&
        fallbackAttemptedUrlRef.current !== props.imageItem.url
      ) {
        fallbackAttemptedUrlRef.current = props.imageItem.url;
        const cachedBlob = await unifiedCacheService.getCachedBlob(
          props.imageItem.url
        );
        if (
          cachedBlob &&
          cachedBlob.size > 0 &&
          imageElement.isConnected &&
          currentImageUrlRef.current === props.imageItem.url
        ) {
          clearFallbackBlobUrl();
          const blobUrl = URL.createObjectURL(cachedBlob);
          fallbackBlobUrlRef.current = blobUrl;
          imageElement.src = blobUrl;
          return;
        }
      }

      if (!/^https?:\/\//i.test(props.imageItem.url)) {
        retryImageAfterSWClaim(imageElement);
      }

      const retry = handleVirtualUrlImageError(
        props.board,
        props.element,
        props.imageItem.url
      );
      if (retry) {
        window.setTimeout(() => {
          if (!imageElement.isConnected) {
            return;
          }
          imageElement.src = retry.retryUrl;
        }, retry.delay);
        return;
      }

      retryExternalImage(imageElement);
    },
    [
      clearFallbackBlobUrl,
      props.board,
      props.element,
      props.imageItem.url,
      retryExternalImage,
      retryImageAfterSWClaim,
    ]
  );
  const handleImageLoad = useCallback(
    (event: any) => {
      const imageElement = event.currentTarget as HTMLImageElement;
      imageElement.style.visibility = '';
      externalImageRetryAttemptRef.current = 0;
      clearExternalImageRetry();
      clearSWRecovery();
      clearVirtualUrlImageError(
        props.board,
        props.element,
        props.imageItem.url
      );
    },
    [
      clearExternalImageRetry,
      clearSWRecovery,
      props.board,
      props.element,
      props.imageItem.url,
    ]
  );

  const elementData = props.element as any;
  const pptStatus = elementData?.pptImageStatus as
    | 'placeholder'
    | 'loading'
    | 'generated'
    | undefined;
  const pptPrompt = elementData?.pptImagePrompt as string | undefined;
  const pptFrameId = elementData?.frameId as string | undefined;
  const isLegacyAudioElement =
    elementData?.isAudio === true ||
    elementData?.audioType === 'music-card' ||
    (typeof elementData?.audioUrl === 'string' &&
      elementData.audioUrl.length > 0);
  const isVideo = isVideoElement(props.imageItem);
  const shouldContainFrameImage =
    !isLegacyAudioElement &&
    !isVideo &&
    typeof elementData?.frameId === 'string';
  const image3DTransform = isOrdinary3DTransformImage(props.element as any)
    ? sanitizeImage3DTransform(elementData?.transform3d)
    : undefined;
  const hasImage3DTransform = !!image3DTransform;
  const image3DRectangle = image3DTransform
    ? getImage3DSourceRectangle(props.element)
    : undefined;
  const image3DRotateX = image3DTransform?.rotateX;
  const image3DRotateY = image3DTransform?.rotateY;
  const image3DPerspective = image3DTransform?.perspective;
  const generationPrompt =
    typeof elementData?.generationPrompt === 'string' &&
    elementData.generationPrompt.trim()
      ? elementData.generationPrompt.trim()
      : typeof elementData?.aiPrompt === 'string' && elementData.aiPrompt.trim()
      ? elementData.aiPrompt.trim()
      : '';
  const showGenerationPrompt =
    Boolean(generationPrompt) &&
    !isVideo &&
    !isLegacyAudioElement &&
    !shouldContainFrameImage &&
    !hasImage3DTransform;

  useLayoutEffect(() => {
    if (!showGenerationPrompt || !rootRef.current) {
      return;
    }

    const foreignObject = rootRef.current.closest(
      'foreignObject'
    ) as SVGForeignObjectElement | null;
    if (!foreignObject) {
      return;
    }

    return setImage3DForeignObjectOverflowVisible(foreignObject);
  }, [showGenerationPrompt]);

  useLayoutEffect(() => {
    if (!hasImage3DTransform || !rootRef.current) {
      return;
    }

    const foreignObject = rootRef.current.closest(
      'foreignObject'
    ) as SVGForeignObjectElement | null;
    if (!foreignObject) {
      return;
    }

    const releaseForeignObjectOverflow =
      setImage3DForeignObjectOverflowVisible(foreignObject);

    const parentG = foreignObject.parentElement as SVGGElement | null;
    if (!parentG) {
      releaseForeignObjectOverflow();
      return;
    }

    const releaseForeignObjectVisibility =
      setImage3DForeignObjectHidden(foreignObject);
    const overlayGroup = document.createElementNS(SVG_NS, 'g');
    const clipPath = document.createElementNS(SVG_NS, 'clipPath');
    const clipPolygon = document.createElementNS(SVG_NS, 'polygon');
    const overlayImage = document.createElementNS(SVG_NS, 'image');
    const clipPathId = `image-3d-clip-${
      elementData?.id || 'image'
    }-${Date.now()}`;

    overlayGroup.classList.add('image-3d-svg-overlay');
    overlayGroup.setAttribute('data-image-3d-overlay', 'true');
    overlayGroup.setAttribute('pointer-events', 'none');
    clipPath.setAttribute('id', clipPathId);
    clipPath.append(clipPolygon);
    overlayImage.setAttribute('clip-path', `url(#${clipPathId})`);
    overlayImage.setAttribute('preserveAspectRatio', 'none');
    overlayGroup.append(clipPath, overlayImage);
    parentG.insertBefore(overlayGroup, foreignObject.nextSibling);
    svgOverlayRef.current = {
      group: overlayGroup,
      image: overlayImage,
      clipPath,
      clipPolygon,
    };

    return () => {
      if (svgOverlayRef.current?.group === overlayGroup) {
        svgOverlayRef.current = null;
      }
      overlayGroup.remove();
      releaseForeignObjectVisibility();
      releaseForeignObjectOverflow();
    };
  }, [elementData?.id, hasImage3DTransform]);

  useLayoutEffect(() => {
    if (
      image3DRotateX === undefined ||
      image3DRotateY === undefined ||
      image3DPerspective === undefined ||
      !image3DRectangle ||
      !rootRef.current
    ) {
      return;
    }

    const foreignObject = rootRef.current.closest(
      'foreignObject'
    ) as SVGForeignObjectElement | null;
    if (!foreignObject) {
      return;
    }

    const currentTransform = {
      rotateX: image3DRotateX,
      rotateY: image3DRotateY,
      perspective: image3DPerspective,
    };
    const overlayGroup =
      svgOverlayRef.current ||
      (() => {
        const group = foreignObject.parentElement?.querySelector<SVGGElement>(
          'g[data-image-3d-overlay="true"]'
        );
        const image = group?.querySelector<SVGImageElement>('image') || null;
        const clipPath =
          group?.querySelector<SVGClipPathElement>('clipPath') || null;
        const clipPolygon =
          group?.querySelector<SVGPolygonElement>('clipPath polygon') || null;
        return group && image && clipPath && clipPolygon
          ? { group, image, clipPath, clipPolygon }
          : null;
      })();
    if (!overlayGroup) {
      return;
    }
    svgOverlayRef.current = overlayGroup;

    const overlayGeometry = getImage3DSvgOverlayGeometry(
      image3DRectangle,
      currentTransform
    );
    overlayGroup.clipPolygon.setAttribute(
      'points',
      overlayGeometry.pointsAttribute
    );
    const canRenderResolvedSource =
      resolvedImageUrl &&
      (!isVirtualUrl(props.imageItem.url) ||
        resolvedImageUrl !== props.imageItem.url ||
        (typeof navigator !== 'undefined' &&
          !!navigator.serviceWorker?.controller));

    if (canRenderResolvedSource) {
      overlayGroup.image.setAttribute('href', resolvedImageUrl);
      overlayGroup.image.setAttributeNS(XLINK_NS, 'href', resolvedImageUrl);
    } else {
      overlayGroup.image.removeAttribute('href');
      overlayGroup.image.removeAttributeNS(XLINK_NS, 'href');
    }
    overlayGroup.image.setAttribute('x', String(overlayGeometry.boundingBox.x));
    overlayGroup.image.setAttribute('y', String(overlayGeometry.boundingBox.y));
    overlayGroup.image.setAttribute(
      'width',
      String(overlayGeometry.boundingBox.width)
    );
    overlayGroup.image.setAttribute(
      'height',
      String(overlayGeometry.boundingBox.height)
    );
    if (overlayGeometry.textureTransform) {
      overlayGroup.image.setAttribute(
        'transform',
        overlayGeometry.textureTransform
      );
    } else {
      overlayGroup.image.removeAttribute('transform');
    }
  }, [
    elementData?.id,
    image3DRectangle?.height,
    image3DRectangle?.x,
    image3DRectangle?.y,
    image3DRectangle?.width,
    image3DPerspective,
    image3DRotateX,
    image3DRotateY,
    props.imageItem.url,
    resolvedImageUrl,
  ]);

  const handlePPTImageGenerate = useCallback(async () => {
    if (
      !props.board ||
      !pptFrameId ||
      !pptPrompt ||
      pptStatus === 'loading' ||
      pptImageGenerationLockRef.current
    )
      return;

    pptImageGenerationLockRef.current = true;
    setPPTImagePlaceholderStatus(props.board, pptFrameId, 'loading');
    setFramePPTImageStatus(props.board, pptFrameId, 'loading');

    try {
      const result = await generateImage({
        prompt: pptPrompt,
        size: '16x9',
      });

      if (result.success && (result.data as any)?.url) {
        removePPTImagePlaceholder(props.board, pptFrameId);

        const frame = props.board.children.find(
          (el: any) => el.id === pptFrameId
        );
        if (frame) {
          const frameRect = RectangleClient.getRectangleByPoints(frame.points!);
          const imgRegion = getImageRegion({
            x: frameRect.x,
            y: frameRect.y,
            width: frameRect.width,
            height: frameRect.height,
          });
          await insertMediaIntoFrame(
            props.board,
            (result.data as any).url,
            'image',
            pptFrameId,
            { width: frameRect.width, height: frameRect.height },
            { width: 800, height: 450 },
            imgRegion
          );
        }
        setFramePPTImageStatus(props.board, pptFrameId, 'generated');
      } else {
        setPPTImagePlaceholderStatus(props.board, pptFrameId, 'placeholder');
        setFramePPTImageStatus(props.board, pptFrameId, 'placeholder');
        MessagePlugin.error(result.error || '图片生成失败');
      }
    } catch (error: any) {
      setPPTImagePlaceholderStatus(props.board, pptFrameId, 'placeholder');
      setFramePPTImageStatus(props.board, pptFrameId, 'placeholder');
      MessagePlugin.error(error?.message || '图片生成失败');
    } finally {
      pptImageGenerationLockRef.current = false;
    }
  }, [props.board, pptFrameId, pptPrompt, pptStatus]);

  if (elementData?.pptImagePlaceholder) {
    const isLoading = pptStatus === 'loading';

    return (
      <div
        className="ppt-image-placeholder"
        onClick={isLoading ? undefined : handlePPTImageGenerate}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '8px',
          borderRadius: '8px',
          border: '1px dashed #d9d9d9',
          backgroundColor: 'rgba(245,245,245,0.85)',
          color: '#999',
          fontSize: '13px',
          cursor: isLoading ? 'default' : 'pointer',
          userSelect: 'none',
        }}
      >
        {isLoading ? <Loading size="small" /> : null}
        <span>{isLoading ? '生成配图中…' : '点击生成配图'}</span>
      </div>
    );
  }

  // 如果是视频元素，使用视频组件渲染
  if (isVideo) {
    return (
      <Video
        videoItem={{
          url: props.imageItem.url,
          width: props.imageItem.width,
          height: props.imageItem.height,
          videoType: (props.imageItem as any).videoType,
          poster: (props.imageItem as any).poster,
        }}
        isFocus={props.isFocus}
        isSelected={(props as any).isSelected}
        readonly={(props as any).readonly}
      />
    );
  }

  // 否则使用原来的图片渲染
  const imgProps: {
    src: string;
    draggable: boolean;
    referrerPolicy: 'no-referrer';
    width?: string;
    style?: React.CSSProperties;
  } = {
    src: props.imageItem.url,
    draggable: false,
    referrerPolicy: 'no-referrer' as const,
    ...(shouldContainFrameImage
      ? {
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'contain' as const,
            display: 'block',
          },
        }
      : {
          width: '100%',
          style: undefined,
        }),
  };
  const elementOpacity =
    typeof (props.element as any)?.opacity === 'number'
      ? Math.min(1, Math.max(0, (props.element as any).opacity))
      : undefined;
  const semanticLayerHidden =
    (props.element as any)?.metadata?.semanticLayer?.hidden === true;
  if (elementOpacity !== undefined) {
    imgProps.style = {
      ...(imgProps.style || {}),
      opacity: elementOpacity,
    };
  }
  return (
    <div
      ref={rootRef}
      data-slideshow-legacy-audio={isLegacyAudioElement ? 'true' : undefined}
      style={
        semanticLayerHidden ||
        image3DTransform ||
        shouldContainFrameImage ||
        showGenerationPrompt
          ? {
              width: '100%',
              height: '100%',
              display: semanticLayerHidden ? 'none' : undefined,
              overflow: showGenerationPrompt ? 'visible' : undefined,
              position: showGenerationPrompt ? 'relative' : undefined,
            }
          : undefined
      }
    >
      <RetryImage
        {...imgProps}
        alt=""
        className={classNames('image-origin', {
          'image-origin--focus': props.isFocus,
        })}
        eager
        showSkeleton={false}
        preferCachedBlob
        initialRetryDelay={500}
        bypassSWAfterRetries={1}
        onSourceChange={handleResolvedImageUrlChange}
        style={imgProps.style}
        onError={handleImageError}
        onLoad={handleImageLoad}
      />
    </div>
  );
};
