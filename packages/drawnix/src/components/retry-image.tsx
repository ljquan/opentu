/**
 * RetryImage Component
 *
 * An image component that automatically retries loading on failure.
 * Features:
 * - Retries up to 5 times with exponential backoff
 * - Automatically bypasses Service Worker on timeout or repeated failures
 * - Shows skeleton loading state during download
 * - Smooth fade-in animation when loaded
 * - Lazy loading and async decoding for performance
 * - Graceful degradation for virtual paths when SW is unavailable
 */

import React, {
  forwardRef,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { unifiedCacheService } from '../services/unified-cache-service';
import { normalizeImageDataUrl } from '@aitu/utils';
import {
  IMAGE_CACHE_TIMEOUT_MS,
  ImageOperationTimeoutError,
  withImageOperationTimeout,
} from '../utils/image-operation-timeout';

export interface RetryImageProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Image source URL */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
  /** Initial retry delay in ms (default: 1000) */
  initialRetryDelay?: number;
  /** Callback when image loads successfully */
  onLoadSuccess?: () => void;
  /** Callback when all retries fail */
  onLoadFailure?: (error: Error) => void;
  /** Optional fallback element to display on failure */
  fallback?: React.ReactNode;
  /** Show skeleton loading state (default: true) */
  showSkeleton?: boolean;
  /** Number of retries before bypassing SW (default: 2) */
  bypassSWAfterRetries?: number;
  /** Use eager loading for cached images (default: auto-detect from URL) */
  eager?: boolean;
  /** Optional wrapper class name */
  wrapperClassName?: string;
  /** Optional wrapper style */
  wrapperStyle?: React.CSSProperties;
  /** Prefer a Blob URL from Cache Storage before loading the original URL. */
  preferCachedBlob?: boolean;
  /** Skip Cache Storage fallback when retrying a known-bad cached image. */
  skipCacheFallback?: boolean;
  /** Reports the URL currently used by the underlying image element. */
  onSourceChange?: (src: string) => void;
  /** Defer cache reads for offscreen canvas media while keeping its DOM source. */
  deferCacheRead?: boolean;
  /** Total loading budget, including retries. Opt in only for eager previews. */
  loadTimeoutMs?: number;
}

/**
 * Skeleton loading component
 */
const ImageSkeleton: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) => (
  <div
    className={className}
    style={{
      ...style,
      background:
        'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
      borderRadius: '8px',
      minHeight: '100px',
      width: '100%',
    }}
  >
    <style>
      {`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}
    </style>
  </div>
);

/**
 * Add bypass_sw parameter to URL to skip Service Worker interception
 */
function addBypassSWParam(url: string): string {
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  try {
    const urlObj = new URL(url, window.location.origin);
    // 避免重复添加
    if (!urlObj.searchParams.has('bypass_sw')) {
      urlObj.searchParams.set('bypass_sw', '1');
    }
    return urlObj.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}bypass_sw=1`;
  }
}

/**
 * RetryImage component - displays an image with automatic retry on load failure
 */
/**
 * 检测 URL 是否来自缓存（应该立即加载）
 */
function isCachedUrl(url: string): boolean {
  return (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.includes('/__aitu_cache__/') ||
    url.includes('/asset-library/') ||
    url.includes('thumbnail=')
  );
}

/**
 * 检测 URL 是否是虚拟路径（需要 SW 拦截）
 */
function isVirtualUrl(url: string): boolean {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    return (
      pathname.startsWith('/__aitu_cache__/') ||
      pathname.startsWith('/asset-library/')
    );
  } catch {
    return (
      url.startsWith('/__aitu_cache__/') || url.startsWith('/asset-library/')
    );
  }
}

function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Re-trigger an external image request without changing its signed query.
 * URL fragments are not sent to the server, so they do not affect signature validation.
 */
function addRetryFragment(url: string): string {
  const hashIndex = url.indexOf('#');
  const baseUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  return `${baseUrl}#retry=${Date.now()}`;
}

/**
 * 检测 Service Worker 是否可用
 */
function isSWAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    !!navigator.serviceWorker.controller
  );
}

export const RetryImage = forwardRef<HTMLImageElement, RetryImageProps>(
  (
    {
      src,
      alt,
      maxRetries = 5,
      initialRetryDelay = 1000,
      onLoadSuccess,
      onLoadFailure,
      fallback,
      showSkeleton = true,
      bypassSWAfterRetries = 2,
      eager,
      wrapperClassName,
      wrapperStyle,
      preferCachedBlob = false,
      skipCacheFallback = false,
      onSourceChange,
      deferCacheRead = false,
      loadTimeoutMs,
      onLoad,
      onError,
      ...imgProps
    },
    ref
  ) => {
    // 存量数据可能存有原始 base64，先统一转为 data URL
    const normalizedSrc = useMemo(() => normalizeImageDataUrl(src), [src]);
    // 自动检测是否应该 eager 加载
    const shouldEagerLoad = eager ?? isCachedUrl(normalizedSrc);

    const [imageSrc, setImageSrc] = useState<string>(normalizedSrc);
    const [retryCount, setRetryCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [hasError, setHasError] = useState<boolean>(false);
    const [bypassSW, setBypassSW] = useState<boolean>(false);
    const shouldHideWhileLoading = showSkeleton && isLoading;
    // 存储降级创建的 blob URL，用于清理
    const blobUrlRef = useRef<string | null>(null);
    const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const settledRef = useRef(false);
    const externalRecoveryRef = useRef<{
      element: HTMLImageElement;
      failedSrc: string | null;
    } | null>(null);
    const cacheFallbackTriedRef = useRef(false);
    const failureCallbackRef = useRef(onLoadFailure);
    failureCallbackRef.current = onLoadFailure;
    const currentSourceRef = useRef(normalizedSrc);
    const mountedRef = useRef(true);
    const sourceVersionRef = useRef(0);
    const imageElementRef = useRef<HTMLImageElement | null>(null);
    const setImageElementRef = useCallback(
      (element: HTMLImageElement | null) => {
        imageElementRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      },
      [ref]
    );
    currentSourceRef.current = normalizedSrc;

    const clearLoadTimeout = useCallback(() => {
      if (loadTimeoutRef.current !== null) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    }, []);

    const isCurrentSource = useCallback(
      (source: string, sourceVersion?: number) =>
        mountedRef.current &&
        currentSourceRef.current === source &&
        (sourceVersion === undefined ||
          sourceVersionRef.current === sourceVersion),
      []
    );

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const adoptBlobUrl = useCallback(
      (source: string, blobUrl: string, sourceVersion?: number): boolean => {
        if (!isCurrentSource(source, sourceVersion)) {
          URL.revokeObjectURL(blobUrl);
          return false;
        }

        if (blobUrlRef.current && blobUrlRef.current !== blobUrl) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        blobUrlRef.current = blobUrl;
        setImageSrc(blobUrl);
        return true;
      },
      [isCurrentSource]
    );

    useEffect(() => {
      onSourceChange?.(imageSrc);
    }, [imageSrc, onSourceChange]);

    /**
     * 尝试将虚拟路径降级为 blob URL
     * 当 SW 不可用时，直接从 Cache Storage 读取并创建 blob URL
     */
    const tryFallbackToBlobUrl = useCallback(
      async (url: string): Promise<string | null> => {
        if (!isVirtualUrl(url) && !isExternalUrl(url)) {
          return null;
        }

        try {
          const blob = await withImageOperationTimeout(
            () =>
              unifiedCacheService.getCachedImageBlobWithThumbnailFallback(url),
            IMAGE_CACHE_TIMEOUT_MS,
            '图片缓存读取超时（20秒）'
          );
          if (blob && blob.size > 0) {
            const blobUrl = URL.createObjectURL(blob);
            return blobUrl;
          }
        } catch (error) {
          console.warn(
            '[RetryImage] Failed to get blob for virtual URL:',
            url,
            error
          );
        }
        return null;
      },
      []
    );

    // Calculate exponential backoff delay
    const getRetryDelay = useCallback(
      (attemptNumber: number): number => {
        return initialRetryDelay * Math.pow(2, attemptNumber);
      },
      [initialRetryDelay]
    );

    // Handle image load success
    const handleLoad = useCallback(
      (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
        if (!isCurrentSource(normalizedSrc)) return;
        if (settledRef.current) {
          const recovery = externalRecoveryRef.current;
          const recoveredSrc = event.currentTarget.getAttribute('src');
          // Canvas may adopt a fresh fallback URL from its onError handler.
          // Only that new attempt may recover a failed, already-settled image.
          if (
            !recovery ||
            recovery.element !== event.currentTarget ||
            !recoveredSrc ||
            recovery.failedSrc === recoveredSrc
          )
            return;
          setImageSrc(recoveredSrc);
        }
        externalRecoveryRef.current = null;
        settledRef.current = true;
        // Invalidate pending cache reads and retry callbacks after success.
        sourceVersionRef.current += 1;
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        clearLoadTimeout();
        setIsLoading(false);
        setHasError(false);
        onLoad?.(event);
        onLoadSuccess?.();
      },
      [clearLoadTimeout, isCurrentSource, normalizedSrc, onLoad, onLoadSuccess]
    );

    // Handle image load error with retry logic
    const handleError = useCallback(
      async (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
        if (deferCacheRead || settledRef.current) return;
        const sourceAtError = normalizedSrc;
        const sourceVersionAtError = sourceVersionRef.current;
        if (!isCurrentSource(sourceAtError, sourceVersionAtError)) {
          return;
        }

        if (sourceAtError.startsWith('data:')) {
          settledRef.current = true;
          sourceVersionRef.current += 1;
          setIsLoading(false);
          setHasError(true);
          externalRecoveryRef.current = {
            element: event.currentTarget,
            failedSrc: event.currentTarget.getAttribute('src'),
          };
          onError?.(event);
          onLoadFailure?.(new Error('Failed to load inline data image'));
          return;
        }

        if (retryCount < maxRetries) {
          const delay = getRetryDelay(retryCount);
          const nextRetryCount = retryCount + 1;

          // 检查是否应该绕过 SW
          const shouldBypassSW =
            nextRetryCount >= bypassSWAfterRetries && !bypassSW;

          if (shouldBypassSW) {
            setBypassSW(true);
          }

          // 优先读取 Cache Storage，避免虚拟路径或远程签名 URL 失效后白板空白。
          if (
            !skipCacheFallback &&
            (isVirtualUrl(sourceAtError) || isExternalUrl(sourceAtError)) &&
            !cacheFallbackTriedRef.current
          ) {
            cacheFallbackTriedRef.current = true;
            const blobUrl = await tryFallbackToBlobUrl(sourceAtError);
            if (
              blobUrl &&
              adoptBlobUrl(sourceAtError, blobUrl, sourceVersionAtError)
            ) {
              setRetryCount(nextRetryCount);
              return;
            }
          }

          if (!isCurrentSource(sourceAtError, sourceVersionAtError)) {
            return;
          }

          // A failed cached Blob must not be retried forever. Give the original
          // source a chance (it may already be readable in the browser).
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
          }

          // Schedule retry
          retryTimeoutRef.current = setTimeout(() => {
            if (!isCurrentSource(sourceAtError, sourceVersionAtError)) {
              return;
            }
            setRetryCount(nextRetryCount);

            // 外部签名 URL 不能追加参数，否则会破坏签名。
            let retryUrl = sourceAtError;
            if (isExternalUrl(sourceAtError)) {
              // 只改变 fragment，保留签名 query，同时让浏览器重新加载。
              retryUrl = addRetryFragment(sourceAtError);
            } else {
              if (shouldBypassSW || bypassSW) {
                retryUrl = addBypassSWParam(retryUrl);
              }
              const separator = retryUrl.includes('?') ? '&' : '?';
              retryUrl = `${retryUrl}${separator}_retry=${Date.now()}`;
            }

            setImageSrc(retryUrl);
          }, delay);
        } else {
          // All retries exhausted
          settledRef.current = true;
          sourceVersionRef.current += 1;
          setIsLoading(false);
          setHasError(true);
          externalRecoveryRef.current = {
            element: event.currentTarget,
            failedSrc: event.currentTarget.getAttribute('src'),
          };
          onError?.(event);
          const error = new Error(
            `Failed to load image after ${maxRetries} retries`
          );
          onLoadFailure?.(error);
        }
      },
      [
        retryCount,
        maxRetries,
        normalizedSrc,
        getRetryDelay,
        onError,
        onLoadFailure,
        bypassSW,
        bypassSWAfterRetries,
        tryFallbackToBlobUrl,
        adoptBlobUrl,
        isCurrentSource,
        deferCacheRead,
        skipCacheFallback,
      ]
    );

    // Reset state when src changes and handle virtual path fallback
    useEffect(() => {
      // 清理之前的 blob URL
      sourceVersionRef.current += 1;
      const sourceVersion = sourceVersionRef.current;
      settledRef.current = false;
      externalRecoveryRef.current = null;
      cacheFallbackTriedRef.current = skipCacheFallback;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      setRetryCount(0);
      setIsLoading(true);
      setHasError(false);
      setBypassSW(false);
      setImageSrc(normalizedSrc);
      clearLoadTimeout();

      let active = true;
      const shouldReadCachedBlob =
        !deferCacheRead &&
        !skipCacheFallback &&
        ((preferCachedBlob &&
          (isVirtualUrl(normalizedSrc) || isExternalUrl(normalizedSrc))) ||
          (isVirtualUrl(normalizedSrc) && !isSWAvailable()));

      if (shouldReadCachedBlob) {
        cacheFallbackTriedRef.current = true;
        tryFallbackToBlobUrl(normalizedSrc).then((blobUrl) => {
          if (!active || !isCurrentSource(normalizedSrc, sourceVersion)) {
            if (blobUrl) {
              URL.revokeObjectURL(blobUrl);
            }
            return;
          }
          if (blobUrl) {
            adoptBlobUrl(normalizedSrc, blobUrl, sourceVersion);
          }
        });
      } else {
        setImageSrc(normalizedSrc);
      }

      // Clear any pending retry timeouts
      return () => {
        active = false;
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        clearLoadTimeout();
      };
    }, [
      adoptBlobUrl,
      isCurrentSource,
      normalizedSrc,
      preferCachedBlob,
      tryFallbackToBlobUrl,
      deferCacheRead,
      skipCacheFallback,
      clearLoadTimeout,
    ]);

    // Browser-cached images can finish before the component subscribes/reset
    // effects settle. A decoded image must still acknowledge the canvas load.
    useEffect(() => {
      const image = imageElementRef.current;
      if (
        !settledRef.current &&
        image?.complete &&
        image.naturalWidth > 0 &&
        image.getAttribute('src') === imageSrc &&
        (imageSrc === normalizedSrc || imageSrc === blobUrlRef.current)
      ) {
        image.dispatchEvent(new Event('load'));
      }
    }, [
      imageSrc,
      normalizedSrc,
      preferCachedBlob,
      deferCacheRead,
      skipCacheFallback,
    ]);

    // One deadline for the entire eager preview, including retry delays and
    // cache reads. Lazy/offscreen images keep the existing loading behavior.
    useEffect(() => {
      if (
        !loadTimeoutMs ||
        !shouldEagerLoad ||
        deferCacheRead ||
        !isLoading ||
        hasError
      ) {
        return;
      }
      const sourceVersion = sourceVersionRef.current;
      loadTimeoutRef.current = setTimeout(() => {
        loadTimeoutRef.current = null;
        if (
          !isCurrentSource(normalizedSrc, sourceVersion) ||
          settledRef.current
        )
          return;
        settledRef.current = true;
        sourceVersionRef.current += 1;
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        setIsLoading(false);
        setHasError(true);
        failureCallbackRef.current?.(
          new ImageOperationTimeoutError('图片预览加载超时，可重试加载已有结果')
        );
      }, loadTimeoutMs);
      return clearLoadTimeout;
    }, [
      clearLoadTimeout,
      deferCacheRead,
      hasError,
      isCurrentSource,
      isLoading,
      loadTimeoutMs,
      normalizedSrc,
      preferCachedBlob,
      shouldEagerLoad,
    ]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
        clearLoadTimeout();
        // 清理 blob URL
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    }, [clearLoadTimeout]);

    // Render fallback if all retries failed
    if (hasError && fallback) {
      return <>{fallback}</>;
    }

    const needsWrapper =
      showSkeleton || Boolean(wrapperClassName) || Boolean(wrapperStyle);
    const imageElement = (
      <img
        {...imgProps}
        ref={setImageElementRef}
        src={imageSrc}
        alt={alt}
        loading={shouldEagerLoad ? 'eager' : 'lazy'}
        decoding={imgProps.decoding || 'async'}
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        onError={handleError}
        style={{
          ...imgProps.style,
          opacity: shouldHideWhileLoading ? 0 : 1,
          transition: 'opacity 0.3s ease-out',
          ...(needsWrapper ? { width: '100%', height: '100%' } : null),
        }}
      />
    );

    if (!needsWrapper) {
      return imageElement;
    }

    // Render image with skeleton loading state
    return (
      <div
        className={wrapperClassName}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          ...wrapperStyle,
        }}
      >
        {/* Skeleton shown while loading */}
        {isLoading && showSkeleton && (
          <ImageSkeleton
            className={imgProps.className}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              ...imgProps.style,
            }}
          />
        )}
        {/* Actual image with fade-in effect */}
        {imageElement}
      </div>
    );
  }
);

RetryImage.displayName = 'RetryImage';
