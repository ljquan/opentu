import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PlayCircleIcon } from 'tdesign-icons-react';
import { useThumbnailUrl } from '../../hooks/useThumbnailUrl';
import './VideoPosterPreview.scss';

const THUMBNAIL_PLACEHOLDER_SIZE = 1;
const MAX_THUMBNAIL_RETRIES = 4;
const FAILED_POSTER_TTL_MS = 10 * 60 * 1000;
const RESOLVED_POSTER_TTL_MS = 10 * 60 * 1000;
const failedPosterCache = new Map<string, number>();
const resolvedPosterCache = new Map<string, { resolvedPoster: string; resolvedAt: number }>();

function cleanupFailedPosterCache(now: number): void {
  failedPosterCache.forEach((failedAt, url) => {
    if (now - failedAt > FAILED_POSTER_TTL_MS) {
      failedPosterCache.delete(url);
    }
  });
}

function markPosterAsFailed(url: string): void {
  const now = Date.now();
  cleanupFailedPosterCache(now);
  failedPosterCache.set(url, now);
}

function hasRecentFailedPoster(url: string): boolean {
  const now = Date.now();
  cleanupFailedPosterCache(now);
  const failedAt = failedPosterCache.get(url);
  return typeof failedAt === 'number' && now - failedAt <= FAILED_POSTER_TTL_MS;
}

function cleanupResolvedPosterCache(now: number): void {
  resolvedPosterCache.forEach((entry, url) => {
    if (now - entry.resolvedAt > RESOLVED_POSTER_TTL_MS) {
      resolvedPosterCache.delete(url);
    }
  });
}

function cacheResolvedPoster(url: string, resolvedPoster: string): void {
  const now = Date.now();
  cleanupResolvedPosterCache(now);
  resolvedPosterCache.set(url, { resolvedPoster, resolvedAt: now });
}

function getCachedResolvedPoster(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  const now = Date.now();
  cleanupResolvedPosterCache(now);
  const entry = resolvedPosterCache.get(url);
  if (!entry) {
    return null;
  }

  return now - entry.resolvedAt <= RESOLVED_POSTER_TTL_MS ? entry.resolvedPoster : null;
}

function withPosterRetryParam(url: string, attempt: number): string {
  if (attempt <= 0 || !url) {
    return url;
  }

  try {
    const resolved = new URL(url, window.location.origin);
    resolved.searchParams.set('_poster_retry', String(attempt));
    return resolved.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_poster_retry=${attempt}`;
  }
}

export interface VideoPosterPreviewProps {
  src: string;
  poster?: string;
  alt?: string;
  className?: string;
  thumbnailSize?: 'small' | 'large';
  imageLoading?: 'lazy' | 'eager';
  activateVideoOnClick?: boolean;
  playOnActivate?: boolean;
  onClick?: React.MouseEventHandler<HTMLImageElement | HTMLVideoElement>;
  videoProps?: Omit<
    React.VideoHTMLAttributes<HTMLVideoElement>,
    'src' | 'poster' | 'className' | 'onClick'
  >;
}

function renderPreviewWithOverlay(
  media: React.ReactNode,
  showPlayOverlay: boolean
): React.ReactElement {
  return (
    <div className="video-poster-preview">
      {media}
      {showPlayOverlay && (
        <div className="video-poster-preview__play-overlay" aria-hidden="true">
          <PlayCircleIcon size="32px" />
        </div>
      )}
    </div>
  );
}

export const VideoPosterPreview: React.FC<VideoPosterPreviewProps> = ({
  src,
  poster,
  alt = '',
  className,
  thumbnailSize = 'small',
  imageLoading = 'lazy',
  activateVideoOnClick = false,
  playOnActivate = false,
  onClick,
  videoProps,
}) => {
  const normalizedPoster = useMemo(
    () => (typeof poster === 'string' && poster.trim() ? poster.trim() : undefined),
    [poster]
  );
  const shouldIgnoreExplicitPoster = useMemo(
    () => (normalizedPoster ? hasRecentFailedPoster(normalizedPoster) : false),
    [normalizedPoster]
  );
  const generatedPoster = useThumbnailUrl(
    src,
    'video',
    thumbnailSize
  );
  const [preferGeneratedPoster, setPreferGeneratedPoster] = useState(shouldIgnoreExplicitPoster);
  const posterCandidate = preferGeneratedPoster ? generatedPoster : (normalizedPoster || generatedPoster);
  const hasExplicitPoster = Boolean(normalizedPoster && !preferGeneratedPoster);
  const canRetryGeneratedPoster = Boolean(
    posterCandidate && posterCandidate === generatedPoster && posterCandidate !== src
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const activatedByClickRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const [resolvedPoster, setResolvedPoster] = useState<string | null>(() => getCachedResolvedPoster(posterCandidate));
  const [retryCount, setRetryCount] = useState(0);
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    setPreferGeneratedPoster(shouldIgnoreExplicitPoster);
  }, [shouldIgnoreExplicitPoster]);

  useEffect(() => {
    setResolvedPoster(getCachedResolvedPoster(posterCandidate));
    setRetryCount(0);
    setShowVideo(false);
    activatedByClickRef.current = false;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [src, posterCandidate, activateVideoOnClick, generatedPoster, normalizedPoster, thumbnailSize]);

  useEffect(() => {
    if (showVideo || (resolvedPoster && resolvedPoster === posterCandidate)) {
      return;
    }

    if (!posterCandidate) {
      setShowVideo(true);
      return;
    }

    const imageUrl = hasExplicitPoster
      ? posterCandidate
      : withPosterRetryParam(posterCandidate, retryCount);
    let cancelled = false;
    const probeImage = new Image();

    const scheduleRetry = () => {
      if (!canRetryGeneratedPoster || retryCount >= MAX_THUMBNAIL_RETRIES) {
        setShowVideo(true);
        return;
      }

      retryTimerRef.current = window.setTimeout(() => {
        setRetryCount((value) => value + 1);
      }, 180 + retryCount * 220);
    };

    probeImage.onload = () => {
      if (cancelled) {
        return;
      }

      if (
        hasExplicitPoster ||
        probeImage.naturalWidth > THUMBNAIL_PLACEHOLDER_SIZE ||
        probeImage.naturalHeight > THUMBNAIL_PLACEHOLDER_SIZE
      ) {
        cacheResolvedPoster(posterCandidate, posterCandidate);
        setResolvedPoster(posterCandidate);
        return;
      }

      scheduleRetry();
    };

    probeImage.onerror = () => {
      if (cancelled) {
        return;
      }

      if (hasExplicitPoster && normalizedPoster) {
        markPosterAsFailed(normalizedPoster);
        setPreferGeneratedPoster(true);
        setResolvedPoster(null);
        setRetryCount(0);
        return;
      }

      scheduleRetry();
    };

    probeImage.src = imageUrl;

    return () => {
      cancelled = true;
      probeImage.onload = null;
      probeImage.onerror = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [
    src,
    posterCandidate,
    retryCount,
    hasExplicitPoster,
    canRetryGeneratedPoster,
    showVideo,
    normalizedPoster,
    resolvedPoster,
  ]);

  useEffect(() => {
    if (!showVideo || !playOnActivate || !activatedByClickRef.current) {
      return;
    }

    activatedByClickRef.current = false;
    videoRef.current?.play().catch(() => {
      // 浏览器策略可能阻止自动播放，保留 controls 让用户继续点播
    });
  }, [showVideo, playOnActivate]);

  const handlePosterClick: React.MouseEventHandler<HTMLImageElement> = (event) => {
    if (activateVideoOnClick) {
      activatedByClickRef.current = true;
      setShowVideo(true);
    }
    onClick?.(event);
  };

  const handleVideoClick: React.MouseEventHandler<HTMLVideoElement> = (event) => {
    onClick?.(event);
  };
  const showPlayOverlay = activateVideoOnClick && !showVideo;

  if (!showVideo && resolvedPoster) {
    return renderPreviewWithOverlay(
      <img
        src={resolvedPoster}
        alt={alt}
        className={`video-poster-preview__media${className ? ` ${className}` : ''}`}
        loading={imageLoading}
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onClick={handlePosterClick}
      />,
      showPlayOverlay
    );
  }

  if (!showVideo && !resolvedPoster) {
    return renderPreviewWithOverlay(
      <div className={`video-poster-preview__placeholder${className ? ` ${className}` : ''}`} aria-hidden="true" />,
      showPlayOverlay
    );
  }

  return renderPreviewWithOverlay(
    <video
      ref={videoRef}
      src={src}
      poster={resolvedPoster || normalizedPoster}
      className={`video-poster-preview__media${className ? ` ${className}` : ''}`}
      playsInline
      {...videoProps}
      onClick={handleVideoClick}
    />,
    false
  );
};
