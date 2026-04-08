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
  const volumeTogglePointerDownRef = useRef(false);
  const volumeHoveredRef = useRef(false);
  const volumeDraggingRef = useRef(false);
  const [volumeExpanded, setVolumeExpanded] = useState(false);
  const [volumeHovered, setVolumeHovered] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);
  const [mobileAnchorRect, setMobileAnchorRect] = useState<{
    left: number;
    width: number;
    bottom: number;
  } | null>(null);

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
  const currentTimeLabel = formatDuration(currentTime);
  const durationLabel = formatDuration(duration);
  const canPlayPrevious = playback.activeQueueIndex > 0;
  const canPlayNext =
    playback.activeQueueIndex >= 0 &&
    playback.activeQueueIndex < playback.queue.length - 1;
  const hasQueueInfo =
    playback.queue.length > 1 && playback.activeQueueIndex >= 0
      ? true
      : false;
  const queueInfoLabel = hasQueueInfo
    ? `${playback.activeQueueIndex + 1}/${playback.queue.length}`
    : null;
  const subtitle = hasQueueInfo
    ? `画布音频 ${playback.activeQueueIndex + 1} / ${playback.queue.length}`
    : '画布音频';
  const mobileSubtitle = queueInfoLabel
    ? `${queueInfoLabel} · ${currentTimeLabel} / ${durationLabel}`
    : `${currentTimeLabel} / ${durationLabel}`;
  const volumePercentage = Math.round(playback.volume * 100);

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

  const toggleVolumeExpanded = () => {
    clearCollapseTimer();
    setVolumeExpanded((expanded) => !expanded);
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
      volumeTogglePointerDownRef.current = false;
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [volumeExpanded]);

  useEffect(() => {
    if (!playback.activeAudioUrl) {
      setMobileAnchorRect(null);
      return;
    }

    let frameId = 0;
    const updateMobileAnchorRect = () => {
      const inputContainer = document.querySelector('.ai-input-bar__container');
      if (!(inputContainer instanceof HTMLElement)) {
        setMobileAnchorRect(null);
        return;
      }

      const rect = inputContainer.getBoundingClientRect();
      const nextRect = {
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        bottom: Math.max(0, Math.round(window.innerHeight - rect.top)),
      };

      setMobileAnchorRect((previousRect) => {
        if (
          previousRect &&
          previousRect.left === nextRect.left &&
          previousRect.width === nextRect.width &&
          previousRect.bottom === nextRect.bottom
        ) {
          return previousRect;
        }

        return nextRect;
      });
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateMobileAnchorRect);
    };

    const inputContainer = document.querySelector('.ai-input-bar__container');
    const inputBar = document.querySelector('.ai-input-bar');
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleUpdate();
          })
        : null;

    if (resizeObserver && inputContainer instanceof HTMLElement) {
      resizeObserver.observe(inputContainer);
    }

    if (
      resizeObserver &&
      inputBar instanceof HTMLElement &&
      inputBar !== inputContainer
    ) {
      resizeObserver.observe(inputBar);
    }

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [playback.activeAudioUrl]);

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

  const playerStyle = mobileAnchorRect
    ? ({
        '--canvas-audio-mobile-left': `${mobileAnchorRect.left}px`,
        '--canvas-audio-mobile-width': `${mobileAnchorRect.width}px`,
        '--canvas-audio-mobile-offset': `${mobileAnchorRect.bottom}px`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="canvas-audio-player" style={playerStyle}>
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
        <div className="canvas-audio-player__subtitle">
          <span className="canvas-audio-player__subtitle-text canvas-audio-player__subtitle-text--desktop">
            {subtitle}
          </span>
          <span className="canvas-audio-player__subtitle-text canvas-audio-player__subtitle-text--mobile">
            {mobileSubtitle}
          </span>
        </div>
      </div>

      <div className="canvas-audio-player__controls">
        <button
          type="button"
          className="canvas-audio-player__action canvas-audio-player__action--previous"
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
          className="canvas-audio-player__action canvas-audio-player__action--next"
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
          {currentTimeLabel}
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
          {durationLabel}
        </span>
      </div>

      <div
        ref={volumeRef}
        className={classNames('canvas-audio-player__volume', {
          'canvas-audio-player__volume--expanded': volumeExpanded,
        })}
        onPointerDown={(event) => event.stopPropagation()}
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
              onPointerDown={(event) => {
                event.stopPropagation();
                volumeDraggingRef.current = true;
                setVolumeDragging(true);
                expandVolume();
              }}
              onChange={(event) => playback.setVolume(Number(event.target.value))}
              className="canvas-audio-player__slider canvas-audio-player__slider--volume"
              style={volumeStyle}
              aria-label="Playback volume"
              aria-valuetext={`${volumePercentage}%`}
            />
          </div>
          <span className="canvas-audio-player__volume-value">
            {volumePercentage}%
          </span>
          <button
            type="button"
            className="canvas-audio-player__volume-toggle"
            onPointerDown={(event) => {
              event.stopPropagation();
              volumeTogglePointerDownRef.current = true;
            }}
            onClick={() => {
              volumeTogglePointerDownRef.current = false;
              toggleVolumeExpanded();
            }}
            onFocus={() => {
              if (volumeTogglePointerDownRef.current) {
                return;
              }
              expandVolume();
            }}
            onBlur={() => {
              volumeTogglePointerDownRef.current = false;
            }}
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
