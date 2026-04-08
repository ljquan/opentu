import React, { useMemo } from 'react';
import classNames from 'classnames';
import { Music4, Pause, Play } from 'lucide-react';
import type { PlaitAudioNode } from '../../types/audio-node.types';
import {
  useCanvasAudioPlaybackControls,
  useCanvasAudioPlaybackSelector,
} from '../../hooks/useCanvasAudioPlayback';
import {
  EMPTY_AUDIO_SPECTRUM,
  EMPTY_AUDIO_WAVEFORM,
} from '../../services/canvas-audio-playback-service';
import './audio-node-content.scss';

interface AudioNodeContentProps {
  element: PlaitAudioNode;
  selected: boolean;
}

interface RibbonSample {
  id: string;
  thickness: number;
  offset: number;
  delay: number;
  duration: number;
}

function createHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 33 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function formatDuration(duration?: number): string {
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return '--:--';
  }

  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function extractSemanticText(tags?: string, prompt?: string): string {
  if (tags) {
    const normalized = tags
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 2);

    if (normalized.length > 0) {
      return normalized.join(' · ');
    }
  }

  if (prompt) {
    const firstLine = prompt
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);

    if (firstLine) {
      return firstLine.replace(/[【】]/g, '');
    }
  }

  return '画布音频';
}

function extractPrimaryTag(tags?: string): string | undefined {
  if (!tags) {
    return undefined;
  }

  return tags
    .split(/[，,]/)
    .map((item) => item.trim())
    .find(Boolean);
}

function interpolateLevels(
  levels: readonly number[],
  targetCount: number
): number[] {
  if (targetCount <= 0) {
    return [];
  }

  if (levels.length === 0) {
    return Array.from({ length: targetCount }, () => 0);
  }

  if (levels.length === 1) {
    return Array.from({ length: targetCount }, () => levels[0] ?? 0);
  }

  return Array.from({ length: targetCount }, (_, index) => {
    const position =
      (index / Math.max(1, targetCount - 1)) * (levels.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(levels.length - 1, Math.ceil(position));
    const mix = position - lowerIndex;
    const lower = levels[lowerIndex] ?? 0;
    const upper = levels[upperIndex] ?? lower;
    return lower * (1 - mix) + upper * mix;
  });
}

interface WavePoint {
  x: number;
  y: number;
}

function buildSmoothPathSegments(points: readonly WavePoint[]): string {
  if (points.length < 2) {
    return '';
  }

  let path = '';

  for (let index = 0; index < points.length - 1; index++) {
    const current = points[index];
    const next = points[index + 1];

    if (!current || !next) {
      continue;
    }

    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;

    if (index === 0) {
      path += `Q ${current.x} ${current.y} ${midX} ${midY} `;
    } else {
      path += `T ${midX} ${midY} `;
    }
  }

  const last = points[points.length - 1];

  if (!last) {
    return path.trim();
  }

  path += `T ${last.x} ${last.y}`;
  return path.trim();
}

function buildWaveformAreaPath(
  samples: readonly Pick<RibbonSample, 'thickness' | 'offset'>[],
  step: number,
  centerY: number
): string {
  if (samples.length === 0) {
    return '';
  }

  const topPoints = samples.map((sample, index) => ({
    x: index * step + step / 2,
    y: centerY + sample.offset - sample.thickness / 2,
  }));
  const bottomPoints = samples
    .map((sample, index) => ({
      x: index * step + step / 2,
      y: centerY + sample.offset + sample.thickness / 2,
    }))
    .reverse();

  const topSegments = buildSmoothPathSegments(topPoints);
  const bottomSegments = buildSmoothPathSegments(bottomPoints);
  const topStart = topPoints[0];
  const bottomStart = bottomPoints[0];

  if (!topStart || !bottomStart) {
    return '';
  }

  return [
    `M ${topStart.x} ${topStart.y}`,
    topSegments,
    `L ${bottomStart.x} ${bottomStart.y}`,
    bottomSegments,
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

function createDecorativeWaveSignal(
  samples: readonly Pick<RibbonSample, 'thickness' | 'offset'>[],
  seed: number
): number[] {
  if (samples.length === 0) {
    return [];
  }

  const maxIndex = Math.max(1, samples.length - 1);
  const phase = ((seed % 2048) / 2048) * Math.PI * 2;

  return samples.map((sample, index) => {
    const normalized = index / maxIndex;
    const envelope = 0.56 + Math.sin(normalized * Math.PI) * 0.44;
    const primaryMotion = Math.sin(normalized * Math.PI * 4.3 + phase) * 0.74;
    const secondaryMotion =
      Math.sin(normalized * Math.PI * 8.9 + phase * 0.62) * 0.24;
    const thicknessLift = Math.max(
      -0.24,
      Math.min(0.24, (sample.thickness - 12) / 18)
    );

    return Math.max(
      -1,
      Math.min(1, (primaryMotion + secondaryMotion) * envelope + thicknessLift)
    );
  });
}

function buildWaveformLinePath(
  samples: readonly Pick<RibbonSample, 'thickness' | 'offset'>[],
  signalLevels: readonly number[],
  step: number,
  centerY: number,
  intensity = 1
): string {
  if (samples.length === 0) {
    return '';
  }

  const points = samples.map((sample, index) => ({
    x: index * step + step / 2,
    y: (() => {
      const signal = signalLevels[index] ?? 0;
      const previous = signalLevels[index - 1] ?? signal;
      const next = signalLevels[index + 1] ?? signal;
      const smoothedSignal = previous * 0.22 + signal * 0.56 + next * 0.22;
      const normalized = index / Math.max(1, samples.length - 1);
      const envelope = 0.82 + Math.sin(normalized * Math.PI) * 0.18;
      const amplitude = (sample.thickness * 0.36 + 3.1) * intensity * envelope;
      const nextY = centerY + sample.offset * 0.72 + smoothedSignal * amplitude;
      return Math.max(2, Math.min(centerY * 2 - 2, nextY));
    })(),
  }));
  const segments = buildSmoothPathSegments(points);
  const start = points[0];

  if (!start) {
    return '';
  }

  return [`M ${start.x} ${start.y}`, segments].filter(Boolean).join(' ');
}

export const AudioNodeContent: React.FC<AudioNodeContentProps> = ({
  element,
  selected,
}) => {
  const playback = useCanvasAudioPlaybackControls();
  const isActive = useCanvasAudioPlaybackSelector(
    (state) => state.activeElementId === element.id
  );
  const isPlaying = useCanvasAudioPlaybackSelector(
    (state) => state.activeElementId === element.id && state.playing
  );
  const currentTime = useCanvasAudioPlaybackSelector((state) =>
    state.activeElementId === element.id ? state.currentTime : 0
  );
  const activeDuration = useCanvasAudioPlaybackSelector((state) =>
    state.activeElementId === element.id ? state.duration : 0
  );
  const analysisAvailable = useCanvasAudioPlaybackSelector(
    (state) => state.activeElementId === element.id && state.analysisAvailable
  );
  const liveSpectrumLevels = useCanvasAudioPlaybackSelector((state) =>
    state.activeElementId === element.id && state.analysisAvailable
      ? state.spectrumLevels
      : EMPTY_AUDIO_SPECTRUM
  );
  const liveWaveformLevels = useCanvasAudioPlaybackSelector((state) =>
    state.activeElementId === element.id && state.analysisAvailable
      ? state.waveformLevels
      : EMPTY_AUDIO_WAVEFORM
  );
  const pulseLevel = useCanvasAudioPlaybackSelector((state) =>
    state.activeElementId === element.id ? state.pulseLevel : 0
  );

  const totalDuration =
    isActive && activeDuration > 0 ? activeDuration : element.duration;
  const progress =
    isActive && totalDuration
      ? Math.max(0, Math.min(100, (currentTime / totalDuration) * 100))
      : 0;
  const currentTimeLabel = isActive ? formatDuration(currentTime) : '0:00';
  const durationLabel = formatDuration(totalDuration);
  const primaryTimeLabel = isActive ? currentTimeLabel : durationLabel;
  const secondaryTimeLabel = isActive ? durationLabel : undefined;
  const nodeWidth = Math.abs(element.points[1][0] - element.points[0][0]);
  const titleMaxLength = nodeWidth >= 420 ? 38 : nodeWidth >= 320 ? 28 : 20;
  const subtitleMaxLength = nodeWidth >= 420 ? 72 : nodeWidth >= 320 ? 42 : 24;
  const waveformSeed = useMemo(
    () => createHash(`${element.id}-${element.title || ''}-${element.clipId || ''}`),
    [element.clipId, element.id, element.title]
  );

  const baseWaveformBars = useMemo<RibbonSample[]>(() => {
    const barCount = nodeWidth >= 420 ? 40 : nodeWidth >= 320 ? 34 : 28;
    const phase = ((waveformSeed % 4096) / 4096) * Math.PI * 2;

    return Array.from({ length: barCount }, (_, index) => {
      const normalized = index / Math.max(1, barCount - 1);
      const envelope = 0.26 + Math.sin(normalized * Math.PI) * 0.74;
      const jitter = ((waveformSeed >> index % 12) & 0xf) / 15;
      const drift = ((waveformSeed >> (index + 5) % 14) & 0xf) / 15 - 0.5;
      const harmonic =
        Math.sin(normalized * Math.PI * 3.8 + phase) * (1.05 + envelope * 2.2);
      const ripple =
        Math.sin(normalized * Math.PI * 8.6 + phase * 0.56) * 0.92;
      const thickness = Number(
        (8 + envelope * 7.8 + jitter * 1.8 + Math.abs(harmonic) * 1.16).toFixed(2)
      );
      const offset = Number((drift * (1.2 + envelope * 2.4)).toFixed(2));
      const waveOffset = Number(
        (offset + harmonic * 0.72 + ripple * 0.34).toFixed(2)
      );
      const delay = ((waveformSeed + index * 17) % 10) * 0.06;
      const duration = 1.12 + ((waveformSeed >> index % 7) & 0x7) * 0.07;

      return {
        id: `${element.id}-bar-${index}`,
        thickness,
        offset: waveOffset,
        delay,
        duration,
      };
    });
  }, [element.id, nodeWidth, waveformSeed]);

  const usesLiveSpectrum =
    isPlaying &&
    analysisAvailable &&
    liveSpectrumLevels !== EMPTY_AUDIO_SPECTRUM;
  const usesLiveWaveform =
    isPlaying &&
    analysisAvailable &&
    liveWaveformLevels !== EMPTY_AUDIO_WAVEFORM;
  const waveformBars = useMemo(() => {
    const interpolatedLevels = interpolateLevels(
      usesLiveSpectrum ? liveSpectrumLevels : EMPTY_AUDIO_SPECTRUM,
      baseWaveformBars.length
    );

    if (!usesLiveSpectrum) {
      return baseWaveformBars.map((bar) => ({
        ...bar,
        liveThickness: bar.thickness,
        liveOffset: bar.offset,
      }));
    }

    return baseWaveformBars.map((bar, index) => {
      const liveLevel = interpolatedLevels[index] ?? 0;
      const neighborLevel =
        ((interpolatedLevels[index - 1] ?? liveLevel) +
          liveLevel +
          (interpolatedLevels[index + 1] ?? liveLevel)) /
        3;
      const liveThickness = Number(
        Math.max(
          7.4,
          Math.min(18.5, bar.thickness * 0.76 + neighborLevel * 8.2)
        ).toFixed(2)
      );
      const liveOffset = Number(
        Math.max(
          -5,
          Math.min(5, bar.offset * 0.65 + (neighborLevel - 0.5) * 4.8)
        ).toFixed(2)
      );

      return {
        ...bar,
        liveThickness,
        liveOffset,
      };
    });
  }, [baseWaveformBars, liveSpectrumLevels, usesLiveSpectrum]);
  const decorativeWaveSignal = useMemo(
    () => createDecorativeWaveSignal(baseWaveformBars, waveformSeed),
    [baseWaveformBars, waveformSeed]
  );
  const liveWaveSignal = useMemo(() => {
    if (!usesLiveWaveform) {
      return decorativeWaveSignal;
    }

    const interpolatedLevels = interpolateLevels(
      liveWaveformLevels,
      baseWaveformBars.length
    );

    return baseWaveformBars.map((bar, index) => {
      const fallbackSignal = decorativeWaveSignal[index] ?? 0;
      const liveSignal = interpolatedLevels[index] ?? 0;
      const harmonicLift =
        ((waveformBars[index]?.liveThickness ?? bar.thickness) - bar.thickness) / 22;

      return Math.max(
        -1,
        Math.min(
          1,
          fallbackSignal * 0.2
            + liveSignal * (0.92 + pulseLevel * 0.26)
            + harmonicLift * 0.08
        )
      );
    });
  }, [
    baseWaveformBars,
    decorativeWaveSignal,
    liveWaveformLevels,
    pulseLevel,
    usesLiveWaveform,
    waveformBars,
  ]);
  const waveformStep = 4;
  const waveformCenterY = 18;

  const handleToggle = async (
    event:
      | React.MouseEvent<HTMLButtonElement>
      | React.PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await playback.togglePlayback({
        elementId: element.id,
        audioUrl: element.audioUrl,
        title: element.title,
        duration: element.duration,
        previewImageUrl: element.previewImageUrl,
        clipId: element.clipId,
        providerTaskId: element.providerTaskId,
        clipIds: element.clipIds,
      });
    } catch {
      // Error feedback is surfaced globally from the playback store.
    }
  };

  const subtitle = truncate(
    extractSemanticText(element.tags, element.prompt),
    subtitleMaxLength
  );
  const badgeLabel = extractPrimaryTag(element.tags) || '音频';
  const pulseStyle = isPlaying
    ? ({
        '--audio-node-pulse-scale': `${1 + pulseLevel * 0.038}`,
        '--audio-node-pulse-glow': `${0.12 + pulseLevel * 0.22}`,
      } as React.CSSProperties)
    : undefined;
  const waveformViewBoxWidth = Math.max(1, waveformBars.length * waveformStep - 1);
  const waveformGradientId = useMemo(
    () =>
      `audio-node-ribbon-gradient-${element.id.replace(
        /[^a-zA-Z0-9_-]/g,
        '-'
      )}`,
    [element.id]
  );
  const waveformGlowId = useMemo(
    () =>
      `audio-node-ribbon-glow-${element.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    [element.id]
  );
  const waveformAuraGradientId = useMemo(
    () =>
      `audio-node-ribbon-aura-${element.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    [element.id]
  );
  const waveformCoreGradientId = useMemo(
    () =>
      `audio-node-ribbon-core-${element.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    [element.id]
  );
  const waveformProgressGradientId = useMemo(
    () =>
      `audio-node-ribbon-progress-${element.id.replace(
        /[^a-zA-Z0-9_-]/g,
        '-'
      )}`,
    [element.id]
  );
  const waveformProgressClipId = useMemo(
    () =>
      `audio-node-ribbon-progress-clip-${element.id.replace(
        /[^a-zA-Z0-9_-]/g,
        '-'
      )}`,
    [element.id]
  );
  const baseWaveformPath = useMemo(
    () =>
      buildWaveformAreaPath(baseWaveformBars, waveformStep, waveformCenterY),
    [baseWaveformBars]
  );
  const liveWaveformPath = useMemo(
    () =>
      buildWaveformAreaPath(
        waveformBars.map((bar) => ({
          thickness: bar.liveThickness ?? bar.thickness,
          offset: bar.liveOffset ?? bar.offset,
        })),
        waveformStep,
        waveformCenterY
      ),
    [waveformBars]
  );
  const baseWaveformLinePath = useMemo(
    () =>
      buildWaveformLinePath(
        baseWaveformBars.map((bar) => ({
          thickness: bar.thickness,
          offset: bar.offset,
        })),
        decorativeWaveSignal,
        waveformStep,
        waveformCenterY,
        0.78
      ),
    [baseWaveformBars, decorativeWaveSignal]
  );
  const liveWaveformLinePath = useMemo(
    () =>
      buildWaveformLinePath(
        waveformBars.map((bar) => ({
          thickness: bar.liveThickness ?? bar.thickness,
          offset: bar.liveOffset ?? bar.offset,
        })),
        liveWaveSignal,
        waveformStep,
        waveformCenterY,
        usesLiveWaveform ? 1.08 + pulseLevel * 0.34 : 0.94
      ),
    [liveWaveSignal, pulseLevel, usesLiveWaveform, waveformBars]
  );
  const waveformProgressWidth = (waveformViewBoxWidth * progress) / 100;
  const waveformStyle = {
    '--audio-node-progress': `${progress}%`,
  } as React.CSSProperties;

  return (
    <div
      className={classNames('audio-node', {
        'audio-node--selected': selected,
        'audio-node--active': isActive,
        'audio-node--playing': isPlaying,
      })}
      style={pulseStyle}
    >
      <div className="audio-node__media">
        <button
          type="button"
          className="audio-node__artwork"
          onClick={handleToggle}
          onPointerDown={(event) => event.stopPropagation()}
          title={isPlaying ? 'Pause audio' : 'Play audio'}
        >
          {element.previewImageUrl ? (
            <img
              src={element.previewImageUrl}
              alt={element.title || 'Audio artwork'}
              draggable={false}
            />
          ) : (
            <div className="audio-node__artwork-fallback">
              <Music4 size={22} />
            </div>
          )}
          <div className="audio-node__artwork-overlay">
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </div>
        </button>
      </div>

      <div className="audio-node__body">
        <div className="audio-node__title-row">
          <div className="audio-node__title-group">
            <div className="audio-node__title">
              {truncate(element.title || '未命名音频', titleMaxLength)}
            </div>
            <div className="audio-node__subtitle">{subtitle}</div>
          </div>
          <div
            className={classNames('audio-node__badge', {
              'audio-node__badge--playing': isPlaying,
            })}
          >
            {badgeLabel}
          </div>
        </div>

        <div className="audio-node__wave-shell">
          <div
            className={classNames('audio-node__waveform', {
              'audio-node__waveform--active': isActive,
              'audio-node__waveform--reactive': usesLiveSpectrum || usesLiveWaveform,
              'audio-node__waveform--fallback':
                isPlaying && !usesLiveSpectrum && !usesLiveWaveform,
            })}
            aria-hidden="true"
            style={waveformStyle}
          >
            <svg
              className="audio-node__waveform-svg"
              viewBox={`0 0 ${waveformViewBoxWidth} 36`}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient
                  id={waveformGradientId}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="rgba(96, 165, 250, 0.42)" />
                  <stop offset="52%" stopColor="rgba(59, 130, 246, 0.86)" />
                  <stop offset="100%" stopColor="rgba(125, 211, 252, 0.58)" />
                </linearGradient>
                <linearGradient
                  id={waveformGlowId}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="rgba(191, 219, 254, 0)" />
                  <stop offset="42%" stopColor="rgba(147, 197, 253, 0.86)" />
                  <stop offset="100%" stopColor="rgba(186, 230, 253, 0)" />
                </linearGradient>
                <linearGradient
                  id={waveformAuraGradientId}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="rgba(191, 219, 254, 0)" />
                  <stop offset="28%" stopColor="rgba(147, 197, 253, 0.42)" />
                  <stop offset="58%" stopColor="rgba(96, 165, 250, 0.72)" />
                  <stop offset="100%" stopColor="rgba(186, 230, 253, 0)" />
                </linearGradient>
                <linearGradient
                  id={waveformCoreGradientId}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.84)" />
                  <stop offset="52%" stopColor="rgba(240, 249, 255, 0.98)" />
                  <stop offset="100%" stopColor="rgba(207, 250, 254, 0.86)" />
                </linearGradient>
                <linearGradient
                  id={waveformProgressGradientId}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="rgba(59, 130, 246, 0.84)" />
                  <stop offset="58%" stopColor="rgba(14, 165, 233, 0.98)" />
                  <stop offset="100%" stopColor="rgba(103, 232, 249, 0.9)" />
                </linearGradient>
                <clipPath id={waveformProgressClipId}>
                  <rect
                    x="0"
                    y="0"
                    width={Math.max(0, waveformProgressWidth)}
                    height="36"
                    rx="18"
                    ry="18"
                  />
                </clipPath>
              </defs>
              <path
                className="audio-node__wave-area audio-node__wave-area--base"
                d={baseWaveformPath}
              />
              <path
                className={classNames(
                  'audio-node__wave-aura audio-node__wave-aura--live',
                  {
                    'audio-node__wave-aura--animated':
                      isPlaying && !usesLiveSpectrum && !usesLiveWaveform,
                    'audio-node__wave-aura--reactive':
                      usesLiveSpectrum || usesLiveWaveform,
                  }
                )}
                d={liveWaveformPath}
                style={{ fill: `url(#${waveformAuraGradientId})` }}
              />
              <path
                className={classNames(
                  'audio-node__wave-area audio-node__wave-area--live',
                  {
                    'audio-node__wave-area--animated':
                      isPlaying && !usesLiveSpectrum,
                    'audio-node__wave-area--reactive': usesLiveSpectrum,
                  }
                )}
                d={liveWaveformPath}
                style={{ fill: `url(#${waveformGradientId})` }}
              />
              <path
                className="audio-node__wave-line audio-node__wave-line--base"
                d={baseWaveformLinePath}
              />
              <path
                className={classNames(
                  'audio-node__wave-line audio-node__wave-line--glow',
                  {
                    'audio-node__wave-line--animated':
                      isPlaying && !usesLiveSpectrum && !usesLiveWaveform,
                    'audio-node__wave-line--reactive':
                      usesLiveSpectrum || usesLiveWaveform,
                  }
                )}
                d={liveWaveformLinePath}
                style={{ stroke: `url(#${waveformGlowId})` }}
              />
              <path
                className={classNames(
                  'audio-node__wave-line audio-node__wave-line--live',
                  {
                    'audio-node__wave-line--animated':
                      isPlaying && !usesLiveSpectrum && !usesLiveWaveform,
                    'audio-node__wave-line--reactive':
                      usesLiveSpectrum || usesLiveWaveform,
                  }
                )}
                d={liveWaveformLinePath}
                style={{ stroke: `url(#${waveformGradientId})` }}
              />
              <path
                className={classNames(
                  'audio-node__wave-line audio-node__wave-line--core',
                  {
                    'audio-node__wave-line--animated':
                      isPlaying && !usesLiveSpectrum && !usesLiveWaveform,
                    'audio-node__wave-line--reactive':
                      usesLiveSpectrum || usesLiveWaveform,
                  }
                )}
                d={liveWaveformLinePath}
                style={{ stroke: `url(#${waveformCoreGradientId})` }}
              />
              {isActive && waveformProgressWidth > 0.5 ? (
                <>
                  <path
                    className="audio-node__wave-aura audio-node__wave-aura--progress"
                    d={liveWaveformPath}
                    clipPath={`url(#${waveformProgressClipId})`}
                    style={{
                      fill: `url(#${waveformAuraGradientId})`,
                    }}
                  />
                  <path
                    className="audio-node__wave-area audio-node__wave-area--progress"
                    d={liveWaveformPath}
                    clipPath={`url(#${waveformProgressClipId})`}
                    style={{
                      fill: `url(#${waveformProgressGradientId})`,
                    }}
                  />
                  <path
                    className="audio-node__wave-line audio-node__wave-line--progress-glow"
                    d={liveWaveformLinePath}
                    clipPath={`url(#${waveformProgressClipId})`}
                    style={{
                      stroke: `url(#${waveformGlowId})`,
                    }}
                  />
                  <path
                    className="audio-node__wave-line audio-node__wave-line--progress"
                    d={liveWaveformLinePath}
                    clipPath={`url(#${waveformProgressClipId})`}
                    style={{
                      stroke: `url(#${waveformProgressGradientId})`,
                    }}
                  />
                  <path
                    className="audio-node__wave-line audio-node__wave-line--progress-core"
                    d={liveWaveformLinePath}
                    clipPath={`url(#${waveformProgressClipId})`}
                    style={{
                      stroke: `url(#${waveformCoreGradientId})`,
                    }}
                  />
                </>
              ) : null}
            </svg>
          </div>
        </div>

        <div
          className={classNames('audio-node__time-cluster', {
            'audio-node__time-cluster--active': isActive,
          })}
        >
          <span
            className={classNames('audio-node__time audio-node__time--primary', {
              'audio-node__time--active': isActive,
            })}
          >
            {primaryTimeLabel}
          </span>
          {secondaryTimeLabel ? (
            <>
              <span className="audio-node__time-divider">/</span>
              <span className="audio-node__time">{secondaryTimeLabel}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
