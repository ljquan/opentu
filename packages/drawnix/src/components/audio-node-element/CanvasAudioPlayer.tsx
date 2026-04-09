import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import {
  ChevronDown,
  PanelsTopLeft,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
  Rows3,
  Columns3,
} from 'lucide-react';
import { useCanvasAudioPlayback } from '../../hooks/useCanvasAudioPlayback';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import { LS_KEYS } from '../../constants/storage-keys';
import { toolWindowService } from '../../services/tool-window-service';
import { MUSIC_PLAYER_TOOL_ID } from '../../tools/tool-ids';
import { AudioCover } from '../shared/AudioCover';
import { CanvasAudioPlayerVolume } from './CanvasAudioPlayerVolume';
import { CanvasAudioPlayerPlaylist } from './CanvasAudioPlayerPlaylist';
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
  const playerRef = useRef<HTMLDivElement>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playerToolVisible, setPlayerToolVisible] = useState(() => {
    const state = toolWindowService.getToolState(MUSIC_PLAYER_TOOL_ID);
    return state?.status === 'open';
  });
  const [layout, setLayout] = useState<'horizontal' | 'vertical'>(() => {
    try {
      const stored = localStorage.getItem(LS_KEYS.AUDIO_PLAYER_LAYOUT);
      return stored === 'vertical' ? 'vertical' : 'horizontal';
    } catch {
      return 'horizontal';
    }
  });
  const [mobileAnchorRect, setMobileAnchorRect] = useState<{
    left: number;
    width: number;
    bottom: number;
  } | null>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const { position, isDragging, wasDraggedRef, elementRef, handlePointerDown } =
    useDraggablePosition({
      storageKey: LS_KEYS.AUDIO_PLAYER_POSITION,
      enabled: !isMobile,
    });

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
    playback.queue.length > 1 && playback.activeQueueIndex >= 0;
  const queueInfoLabel = hasQueueInfo
    ? `${playback.activeQueueIndex + 1}/${playback.queue.length}`
    : null;
  const subtitle = hasQueueInfo
    ? `${playback.queueSource === 'playlist' ? (playback.activePlaylistName || '播放列表') : '画布音频'} ${playback.activeQueueIndex + 1} / ${playback.queue.length}`
    : playback.queueSource === 'playlist' ? (playback.activePlaylistName || '播放列表') : '画布音频';
  const mobileSubtitle = queueInfoLabel
    ? `${queueInfoLabel} · ${currentTimeLabel} / ${durationLabel}`
    : `${currentTimeLabel} / ${durationLabel}`;

  const scrubberStyle = {
    '--canvas-audio-progress': `${progress}%`,
  } as React.CSSProperties;

  const toggleLayout = useCallback(() => {
    setLayout((prev) => {
      const next = prev === 'horizontal' ? 'vertical' : 'horizontal';
      try {
        localStorage.setItem(LS_KEYS.AUDIO_PLAYER_LAYOUT, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleToggle = useCallback(async () => {
    try {
      if (playback.playing) {
        playback.pausePlayback();
      } else {
        await playback.resumePlayback();
      }
    } catch {
      // Error feedback is surfaced globally from the playback store.
    }
  }, [playback]);

  useEffect(() => {
    if (!playback.activeAudioUrl) {
      setPlaylistOpen(false);
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
        ? new ResizeObserver(() => scheduleUpdate())
        : null;

    if (resizeObserver && inputContainer instanceof HTMLElement) {
      resizeObserver.observe(inputContainer);
    }
    if (resizeObserver && inputBar instanceof HTMLElement && inputBar !== inputContainer) {
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
    if (!playlistOpen) return;
    const handleClickOutside = (event: PointerEvent) => {
      if (playerRef.current?.contains(event.target as Node)) return;
      setPlaylistOpen(false);
    };
    document.addEventListener('pointerdown', handleClickOutside, true);
    return () => document.removeEventListener('pointerdown', handleClickOutside, true);
  }, [playlistOpen]);

  // Sync elementRef for drag
  useEffect(() => {
    elementRef.current = playerRef.current;
  });

  useEffect(() => {
    const subscription = toolWindowService.observeToolStates().subscribe(() => {
      const state = toolWindowService.getToolState(MUSIC_PLAYER_TOOL_ID);
      setPlayerToolVisible(state?.status === 'open');
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!playback.activeAudioUrl || playerToolVisible) {
    return null;
  }

  const positionStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y }
    : {};
  const mobileStyle = mobileAnchorRect
    ? ({
        '--canvas-audio-mobile-left': `${mobileAnchorRect.left}px`,
        '--canvas-audio-mobile-width': `${mobileAnchorRect.width}px`,
        '--canvas-audio-mobile-offset': `${mobileAnchorRect.bottom}px`,
      } as React.CSSProperties)
    : {};
  const playerStyle = { ...mobileStyle, ...positionStyle };

  return (
    <div
      ref={playerRef}
      className={classNames('canvas-audio-player', {
        'canvas-audio-player--playlist-open': playlistOpen,
        'canvas-audio-player--positioned': !!position,
        'canvas-audio-player--dragging': isDragging,
        'canvas-audio-player--vertical': layout === 'vertical',
      })}
      style={Object.keys(playerStyle).length > 0 ? playerStyle : undefined}
    >
      <button
        type="button"
        className="canvas-audio-player__queue-trigger"
        onPointerDown={handlePointerDown}
        onClick={() => {
          if (!wasDraggedRef.current) setPlaylistOpen((open) => !open);
        }}
        aria-expanded={playlistOpen}
        aria-label="切换播放列表"
      >
        <div className="canvas-audio-player__cover">
          <AudioCover
            src={playback.activePreviewImageUrl}
            alt={playback.activeTitle || 'Audio cover'}
            fallbackClassName="canvas-audio-player__cover-fallback"
            iconSize={16}
          />
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

        <span className="canvas-audio-player__queue-indicator" aria-hidden="true">
          <ChevronDown size={14} />
        </span>
      </button>

      <div className="canvas-audio-player__controls">
        <button
          type="button"
          className="canvas-audio-player__action canvas-audio-player__action--previous"
          onClick={() => void playback.playPrevious()}
          disabled={!canPlayPrevious}
          data-tooltip="上一首"
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          className="canvas-audio-player__action canvas-audio-player__action--primary"
          onClick={() => void handleToggle()}
          data-tooltip={playback.playing ? '暂停' : '播放'}
        >
          {playback.playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          className="canvas-audio-player__action canvas-audio-player__action--next"
          onClick={() => void playback.playNext()}
          disabled={!canPlayNext}
          data-tooltip="下一首"
        >
          <SkipForward size={14} />
        </button>
      </div>

      <div className="canvas-audio-player__progress">
        <span className="canvas-audio-player__time">{currentTimeLabel}</span>
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
        <span className="canvas-audio-player__time">{durationLabel}</span>
      </div>

      <CanvasAudioPlayerVolume
        volume={playback.volume}
        onVolumeChange={playback.setVolume}
      />

      <button
        type="button"
        className="canvas-audio-player__toggle canvas-audio-player__player-switch canvas-audio-player__switch-toggle"
        onClick={() => {
          void import('../../services/tool-launch-service').then(
            ({ openMusicPlayerTool }) => {
              openMusicPlayerTool();
            }
          );
        }}
        aria-label="打开播放器工具"
        data-tooltip="打开播放器工具"
      >
        <PanelsTopLeft size={14} />
      </button>

      <button
        type="button"
        className="canvas-audio-player__toggle canvas-audio-player__layout-toggle"
        onClick={toggleLayout}
        data-tooltip={layout === 'horizontal' ? '切换为垂直布局' : '切换为水平布局'}
      >
        {layout === 'horizontal' ? <Rows3 size={14} /> : <Columns3 size={14} />}
      </button>

      <button
        type="button"
        className="canvas-audio-player__close"
        onClick={playback.stopPlayback}
        data-tooltip="关闭播放器"
      >
        <X size={14} />
      </button>

      {playlistOpen ? (
        <CanvasAudioPlayerPlaylist
          queue={playback.queue}
          activeQueueIndex={playback.activeQueueIndex}
          queueSource={playback.queueSource}
          activePlaylistId={playback.activePlaylistId}
          onSelect={(item) => {
            void playback.togglePlayback(item);
            setPlaylistOpen(false);
          }}
        />
      ) : null}
    </div>
  );
};
