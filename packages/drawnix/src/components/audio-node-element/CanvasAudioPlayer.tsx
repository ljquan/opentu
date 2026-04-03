import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import {
  Music4,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCanvasAudioPlayback } from '../../hooks/useCanvasAudioPlayback';
import './canvas-audio-player.scss';

function formatDuration(duration?: number): string {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }

  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const CanvasAudioPlayer: React.FC = () => {
  const playback = useCanvasAudioPlayback();
  const volumeRef = useRef<HTMLDivElement>(null);
  const collapseTimeoutRef = useRef<number | null>(null);
  const volumeHoveredRef = useRef(false);
  const volumeDraggingRef = useRef(false);
  const [volumeExpanded, setVolumeExpanded] = useState(false);
  const [volumeHovered, setVolumeHovered] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);

  const progress = useMemo(() => {
    if (!playback.duration || playback.duration <= 0) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(100, (playback.currentTime / playback.duration) * 100)
    );
  }, [playback.currentTime, playback.duration]);

  const currentTime = Number.isFinite(playback.currentTime) ? playback.currentTime : 0;
  const duration = Number.isFinite(playback.duration) ? playback.duration : 0;
  const canPlayPrevious = playback.activeQueueIndex > 0;
  const canPlayNext =
    playback.activeQueueIndex >= 0 &&
    playback.activeQueueIndex < playback.queue.length - 1;
  const subtitle =
    playback.queue.length > 1 && playback.activeQueueIndex >= 0
      ? `画布音频 ${playback.activeQueueIndex + 1} / ${playback.queue.length}`
      : '画布音频';

  const scrubberStyle = {
    '--canvas-audio-progress': `${progress}%`,
  } as React.CSSProperties;
  const volumeStyle = {
    '--canvas-audio-progress': `${playback.volume * 100}%`,
  } as React.CSSProperties;

  const clearCollapseTimer = () => {
    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  };

  const expandVolume = () => {
    clearCollapseTimer();
    setVolumeExpanded(true);
  };

  const scheduleCollapse = () => {
    clearCollapseTimer();
    if (
      volumeHoveredRef.current ||
      volumeDraggingRef.current
    ) {
      return;
    }
    collapseTimeoutRef.current = window.setTimeout(() => {
      setVolumeExpanded(false);
    }, 180);
  };

  const handleToggle = async () => {
    try {
      if (playback.playing) {
        playback.pausePlayback();
      } else {
        await playback.resumePlayback();
      }
    } catch {
      // Error feedback is surfaced globally from the playback store.
    }
  };

  useEffect(() => {
    volumeHoveredRef.current = volumeHovered;
  }, [volumeHovered]);

  useEffect(() => {
    volumeDraggingRef.current = volumeDragging;
  }, [volumeDragging]);

  useEffect(() => {
    return () => {
      clearCollapseTimer();
    };
  }, []);

  useEffect(() => {
    if (playback.activeAudioUrl) {
      return;
    }

    clearCollapseTimer();
    volumeHoveredRef.current = false;
    volumeDraggingRef.current = false;
    setVolumeExpanded(false);
    setVolumeHovered(false);
    setVolumeDragging(false);
  }, [playback.activeAudioUrl]);

  useEffect(() => {
    if (!volumeExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (volumeRef.current?.contains(event.target as Node)) {
        return;
      }
      clearCollapseTimer();
      setVolumeExpanded(false);
      setVolumeDragging(false);
      setVolumeHovered(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [volumeExpanded]);

  useEffect(() => {
    if (!volumeDragging) {
      return;
    }

    const handlePointerUp = () => {
      volumeDraggingRef.current = false;
      setVolumeDragging(false);
      if (!volumeHoveredRef.current) {
        scheduleCollapse();
      }
    };

    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [volumeDragging]);

  if (!playback.activeAudioUrl) {
    return null;
  }

  return (
    <div className="canvas-audio-player">
      <div className="canvas-audio-player__cover">
        {playback.activePreviewImageUrl ? (
          <img
            src={playback.activePreviewImageUrl}
            alt={playback.activeTitle || 'Audio cover'}
            draggable={false}
          />
        ) : (
          <div className="canvas-audio-player__cover-fallback">
            <Music4 size={18} />
          </div>
        )}
      </div>

      <div className="canvas-audio-player__meta">
        <div className="canvas-audio-player__title">
          {playback.activeTitle || '未命名音频'}
        </div>
        <div className="canvas-audio-player__subtitle">{subtitle}</div>
      </div>

      <div className="canvas-audio-player__controls">
        <button
          type="button"
          className="canvas-audio-player__action"
          onClick={() => {
            void playback.playPrevious();
          }}
          disabled={!canPlayPrevious}
          title="Previous track"
        >
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          className="canvas-audio-player__action canvas-audio-player__action--primary"
          onClick={() => {
            void handleToggle();
          }}
          title={playback.playing ? 'Pause audio' : 'Play audio'}
        >
          {playback.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          className="canvas-audio-player__action"
          onClick={() => {
            void playback.playNext();
          }}
          disabled={!canPlayNext}
          title="Next track"
        >
          <SkipForward size={16} />
        </button>
      </div>

      <div className="canvas-audio-player__progress">
        <span className="canvas-audio-player__time">
          {formatDuration(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(event) => playback.seekTo(Number(event.target.value))}
          className="canvas-audio-player__slider canvas-audio-player__slider--progress"
          style={scrubberStyle}
          aria-label="Audio progress"
        />
        <span className="canvas-audio-player__time">
          {formatDuration(duration)}
        </span>
      </div>

      <div
        ref={volumeRef}
        className={classNames('canvas-audio-player__volume', {
          'canvas-audio-player__volume--expanded': volumeExpanded,
        })}
        onMouseEnter={() => {
          volumeHoveredRef.current = true;
          setVolumeHovered(true);
          clearCollapseTimer();
        }}
        onMouseLeave={() => {
          volumeHoveredRef.current = false;
          setVolumeHovered(false);
          scheduleCollapse();
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (nextTarget && volumeRef.current?.contains(nextTarget)) {
            return;
          }
          scheduleCollapse();
        }}
      >
        <div className="canvas-audio-player__volume-shell">
          <div className="canvas-audio-player__volume-slider-wrap">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={playback.volume}
              onFocus={expandVolume}
              onPointerDown={() => {
                volumeDraggingRef.current = true;
                setVolumeDragging(true);
                expandVolume();
              }}
              onChange={(event) => playback.setVolume(Number(event.target.value))}
              className="canvas-audio-player__slider canvas-audio-player__slider--volume"
              style={volumeStyle}
              aria-label="Playback volume"
            />
          </div>
          <button
            type="button"
            className="canvas-audio-player__volume-toggle"
            onClick={() => {
              if (volumeExpanded) {
                clearCollapseTimer();
                setVolumeExpanded(false);
              } else {
                expandVolume();
              }
            }}
            onFocus={expandVolume}
            aria-label="Volume controls"
            aria-expanded={volumeExpanded}
          >
            {playback.volume <= 0.01 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      <button
        type="button"
        className="canvas-audio-player__close"
        onClick={playback.stopPlayback}
        title="Close player"
      >
        <X size={16} />
      </button>
    </div>
  );
};
