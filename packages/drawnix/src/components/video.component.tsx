import React, { useRef, useEffect, useState } from 'react';
import { PlaitVideo } from '../interfaces/video';

interface VideoComponentProps {
  element: PlaitVideo;
  selected?: boolean;
  readonly?: boolean;
}

export const VideoComponent: React.FC<VideoComponentProps> = ({ 
  element, 
  selected = false, 
  readonly = false 
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const { url, width, height, poster } = element;
  
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const handleLoadedData = () => {
        setIsLoading(false);
        setVideoError(false);
      };
      
      const handleError = () => {
        setIsLoading(false);
        setVideoError(true);
      };

      video.addEventListener('loadeddata', handleLoadedData);
      video.addEventListener('error', handleError);

      return () => {
        video.removeEventListener('loadeddata', handleLoadedData);
        video.removeEventListener('error', handleError);
      };
    }

    return undefined;
  }, [url]);

  const handleVideoClick = (e: React.MouseEvent) => {
    if (readonly) {
      // 在只读模式下，点击视频在新窗口打开
      e.preventDefault();
      e.stopPropagation();
      window.open(url, '_blank');
    }
  };

  const containerStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    position: 'relative',
    border: selected ? '2px solid #0052d9' : '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: readonly ? 'pointer' : 'default',
    backgroundColor: '#000',
  };

  if (videoError) {
    return (
      <div style={containerStyle} data-track="video_click_open" onClick={handleVideoClick}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#666',
          backgroundColor: '#f5f5f5',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }}>🎬</div>
          <div style={{ fontSize: '14px', textAlign: 'center', padding: '0 16px' }}>
            Video failed to load
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
            Click to open in new window
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle} data-track="video_click_open" onClick={handleVideoClick}>
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
        ref={videoRef}
        src={url}
        poster={poster}
        width={width}
        height={height}
        controls={!readonly}
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
        onError={() => setVideoError(true)}
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
