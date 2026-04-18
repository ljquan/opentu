import { useEffect, useRef, useState } from 'react';

interface AudioDurationSource {
  audioUrl: string;
  duration?: number;
}

const resolvedDurationCache = new Map<string, number>();
const pendingDurationLoads = new Map<string, Promise<void>>();

function isValidDuration(duration?: number): duration is number {
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
}

function probeAudioDuration(audioUrl: string): Promise<void> {
  const existing = pendingDurationLoads.get(audioUrl);
  if (existing) {
    return existing;
  }

  const pending = new Promise<void>((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';

    const finalize = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.src = '';
      audio.load();
      pendingDurationLoads.delete(audioUrl);
      resolve();
    };

    const handleLoadedMetadata = () => {
      if (isValidDuration(audio.duration)) {
        resolvedDurationCache.set(audioUrl, audio.duration);
      }
      finalize();
    };

    const handleError = () => {
      finalize();
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);
    audio.src = audioUrl;
  });

  pendingDurationLoads.set(audioUrl, pending);
  return pending;
}

export function useResolvedAudioDurations(sources: AudioDurationSource[]) {
  const cacheRef = useRef<Map<string, number>>(resolvedDurationCache);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const pendingRefreshes: Promise<void>[] = [];

    sources.forEach((source) => {
      if (!source.audioUrl) {
        return;
      }

      if (isValidDuration(source.duration)) {
        resolvedDurationCache.set(source.audioUrl, source.duration);
        return;
      }

      if (resolvedDurationCache.has(source.audioUrl)) {
        return;
      }

      pendingRefreshes.push(
        probeAudioDuration(source.audioUrl).then(() => {
          if (!cancelled) {
            forceUpdate((value) => value + 1);
          }
        })
      );
    });

    return () => {
      cancelled = true;
    };
  }, [sources]);

  return cacheRef.current;
}
