import React, { useRef, useEffect, useState } from 'react';
import classNames from 'classnames';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';

export interface VideoItem {
  url: string;
  width?: number;
  height?: number;
  poster?: string;
  videoType?: string;
}

export interface VideoProps {
  videoItem: VideoItem;
  isFocus?: boolean;
  isSelected?: boolean;
  readonly?: boolean;
}

export const Video: React.FC<VideoProps> = (props) => {
  // A new source needs a fresh player, including its loading/error state.
  const url = props.videoItem.url?.replace('#video', '') || '';
  return <VideoPlayer key={url} {...props} url={url} />;
};

const VideoPlayer: React.FC<VideoProps & { url: string }> = (props) => {
  const {
    videoItem,
    url,
    isFocus = false,
    isSelected = false,
    readonly = false,
  } = props;
  const { poster } = videoItem;
  const fallbackBlobUrlRef = useRef<string | null>(null);
  const fallbackAttemptedRef = useRef(false);
  const fallbackPendingRef = useRef(false);
  const loadAttemptRef = useRef(0);
  const [videoError, setVideoError] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(url));
  const [playbackUrl, setPlaybackUrl] = useState(url);

  useEffect(() => {
    return () => {
      // Ignore pending cache reads after this source is removed.
      loadAttemptRef.current += 1;
      if (fallbackBlobUrlRef.current) {
        URL.revokeObjectURL(fallbackBlobUrlRef.current);
        fallbackBlobUrlRef.current = null;
      }
    };
  }, []);

  const handleVideoError = async () => {
    if (fallbackPendingRef.current) return;
    const attempt = loadAttemptRef.current;
    if (isVirtualMediaUrl(url) && !fallbackAttemptedRef.current) {
      fallbackAttemptedRef.current = true;
      fallbackPendingRef.current = true;
      setIsLoading(true);
      try {
        const { unifiedCacheService } = await import(
          '../../services/unified-cache-service'
        );
        if (attempt !== loadAttemptRef.current) return;
        const cachedBlob = await unifiedCacheService.getCachedBlob(url, {
          allowNetwork: false,
        });
        if (attempt !== loadAttemptRef.current) return;
        if (cachedBlob?.size) {
          const blobUrl = URL.createObjectURL(cachedBlob);
          fallbackBlobUrlRef.current = blobUrl;
          setPlaybackUrl(blobUrl);
          return;
        }
      } catch {
        // Cache failures use the same visible error as a failed media request.
      } finally {
        fallbackPendingRef.current = false;
      }
    }
    if (attempt === loadAttemptRef.current) {
      setIsLoading(false);
      setVideoError(true);
    }
  };

  const stopCanvasPropagation = (e: React.SyntheticEvent) => {
    if (readonly) {
      e.stopPropagation();
    }
  };

  const handleVideoClick = (e: React.MouseEvent) => {
    if (readonly) {
      e.stopPropagation();
      // 在只读模式下，点击视频在新窗口打开
      e.preventDefault();
      window.open(playbackUrl, '_blank');
    }
  };

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    borderRadius: '4px',
    overflow: 'hidden',
  };

  if (videoError) {
    return (
      <div
        style={containerStyle}
        data-slideshow-media-control="true"
        onClick={handleVideoClick}
        onPointerDown={stopCanvasPropagation}
        onPointerUp={stopCanvasPropagation}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#666',
          backgroundColor: '#f5f5f5',
          cursor: readonly ? 'pointer' : 'default',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }}>🎬</div>
          <div style={{ fontSize: '14px', textAlign: 'center', padding: '0 16px' }}>
            Video failed to load
          </div>
          {readonly && (
            <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
              Click to open in new window
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={containerStyle}
      data-slideshow-media-control="true"
      onClick={handleVideoClick}
      onPointerDown={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
    >
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          zIndex: 1,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
            <div style={{ fontSize: '14px' }}>Loading video...</div>
          </div>
        </div>
      )}
      <video
        data-slideshow-media-control="true"
        src={playbackUrl || undefined}
        poster={poster}
        width="100%"
        height="100%"
        controls={!readonly}
        muted
        playsInline
        draggable={false}
        className={classNames('video-origin', {
          'video-origin--focus': isFocus,
          'video-origin--selected': isSelected,
        })}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
        onPointerDown={stopCanvasPropagation}
        onPointerUp={stopCanvasPropagation}
        onLoadedData={() => {
          setIsLoading(false);
          setVideoError(false);
        }}
        onError={handleVideoError}
      />
      {readonly && (
        <div style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          pointerEvents: 'none',
        }}>
          🎬 Video
        </div>
      )}
    </div>
  );
};
