import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Volume2, VolumeX } from 'lucide-react';

interface CanvasAudioPlayerVolumeProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
}

export const CanvasAudioPlayerVolume: React.FC<CanvasAudioPlayerVolumeProps> = ({
  volume,
  onVolumeChange,
}) => {
  const volumeRef = useRef<HTMLDivElement>(null);
  const collapseTimeoutRef = useRef<number | null>(null);
  const volumeTogglePointerDownRef = useRef(false);
  const volumeHoveredRef = useRef(false);
  const volumeDraggingRef = useRef(false);
  const [volumeExpanded, setVolumeExpanded] = useState(false);
  const [volumeHovered, setVolumeHovered] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);

  const volumePercentage = Math.round(volume * 100);
  const volumeStyle = {
    '--canvas-audio-progress': `${volume * 100}%`,
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
    if (volumeHoveredRef.current || volumeDraggingRef.current) return;
    collapseTimeoutRef.current = window.setTimeout(() => {
      setVolumeExpanded(false);
    }, 180);
  };

  useEffect(() => {
    volumeHoveredRef.current = volumeHovered;
  }, [volumeHovered]);

  useEffect(() => {
    volumeDraggingRef.current = volumeDragging;
  }, [volumeDragging]);

  useEffect(() => {
    return () => clearCollapseTimer();
  }, []);

  useEffect(() => {
    if (!volumeExpanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (volumeRef.current?.contains(event.target as Node)) return;
      clearCollapseTimer();
      setVolumeExpanded(false);
      setVolumeDragging(false);
      setVolumeHovered(false);
      volumeTogglePointerDownRef.current = false;
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [volumeExpanded]);

  useEffect(() => {
    if (!volumeDragging) return;
    const handlePointerUp = () => {
      volumeDraggingRef.current = false;
      setVolumeDragging(false);
      if (!volumeHoveredRef.current) {
        clearCollapseTimer();
        collapseTimeoutRef.current = window.setTimeout(() => {
          setVolumeExpanded(false);
        }, 180);
      }
    };
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, [volumeDragging]);

  return (
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
        if (nextTarget && volumeRef.current?.contains(nextTarget)) return;
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
            value={volume}
            onFocus={expandVolume}
            onPointerDown={(event) => {
              event.stopPropagation();
              volumeDraggingRef.current = true;
              setVolumeDragging(true);
              expandVolume();
            }}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
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
            if (volumeTogglePointerDownRef.current) return;
            expandVolume();
          }}
          onBlur={() => {
            volumeTogglePointerDownRef.current = false;
          }}
          aria-label="Volume controls"
          aria-expanded={volumeExpanded}
          data-tooltip="音量"
        >
          {volume <= 0.01 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
    </div>
  );
};
