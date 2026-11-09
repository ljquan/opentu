import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaitBoard } from '@plait/core';
import { useSvgCanvasSource } from '../hooks/useSvgCanvasSource';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import {
  buildSvgSandboxDocument,
  controlSvgAnimation,
  supportsSvgPlayback,
} from '../utils/svg-source';
import { setSvgPlaybackState } from '../services/svg-playback-state';

export function SvgAnimationOverlay({
  board,
  elementId,
  url,
  playback,
  onVisibleChange,
}: {
  board: PlaitBoard;
  elementId: string;
  url: string;
  playback?: 'playing' | 'paused';
  onVisibleChange: (visible: boolean) => void;
}) {
  const state = useSvgCanvasSource(url);
  const source = state?.source;
  const reduceMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canPlay = !!source && supportsSvgPlayback(source);
  const content = useMemo(
    () => (canPlay && source ? buildSvgSandboxDocument(source) : undefined),
    [canPlay, source]
  );
  const paused =
    playback === 'paused' ||
    (playback !== 'playing' && reduceMotion) ||
    !visible;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [url]);
  useEffect(() => {
    if (canPlay)
      setSvgPlaybackState(board, elementId, {
        url,
        status: failed ? 'error' : ready ? 'ready' : 'loading',
      });
    return () => setSvgPlaybackState(board, elementId);
  }, [board, elementId, url, canPlay, ready, failed]);
  useEffect(() => {
    onVisibleChange(ready && !failed);
    return () => onVisibleChange(false);
  }, [ready, failed, onVisibleChange]);
  const updatePlayback = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc?.querySelector('svg'))
      controlSvgAnimation(doc, pausedRef.current || document.hidden);
  }, []);
  useEffect(() => {
    if (ready) updatePlayback();
  }, [paused, ready, updatePlayback]);
  useEffect(() => {
    document.addEventListener('visibilitychange', updatePlayback);
    return () =>
      document.removeEventListener('visibilitychange', updatePlayback);
  }, [updatePlayback]);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((entry) => entry.isIntersecting))
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [content]);
  if (!content || failed) return null;
  return (
    <iframe
      ref={frameRef}
      title="SVG 自带动画"
      sandbox="allow-same-origin"
      srcDoc={content}
      aria-hidden="true"
      tabIndex={-1}
      onLoad={() => {
        try {
          const doc = frameRef.current?.contentDocument;
          const root = doc?.querySelector('svg');
          if (!doc || !root) throw new Error('SVG 动画文档不可用');
          root.getBoundingClientRect();
          if (source?.animation.css && !doc.getAnimations?.().length)
            throw new Error('SVG 样式动画未成功加载');
          controlSvgAnimation(doc, pausedRef.current || document.hidden, true);
          setReady(true);
        } catch {
          setFailed(true);
        }
      }}
      onError={() => setFailed(true)}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 0,
        pointerEvents: 'none',
        visibility: ready ? 'visible' : 'hidden',
      }}
    />
  );
}
