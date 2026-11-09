import { useEffect, useState } from 'react';
import { readSvgCanvasSource } from '../services/svg-canvas-source';
import { isSvgUrl, type SvgSource } from '../utils/svg-source';

type State = {
  url: string;
  status: 'loading' | 'ready' | 'error';
  source?: SvgSource;
  error?: string;
};

export function useSvgCanvasSource(url: string): State | null {
  const [state, setState] = useState<State>();
  const candidate = isSvgUrl(url);
  useEffect(() => {
    if (!candidate) return;
    const controller = new AbortController();
    setState({ url, status: 'loading' });
    void readSvgCanvasSource(url, controller.signal).then(
      (source) => {
        if (!controller.signal.aborted)
          setState({ url, status: 'ready', source });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({
            url,
            status: 'error',
            error:
              error instanceof Error ? error.message : 'SVG 原文件读取失败',
          });
      }
    );
    return () => controller.abort();
  }, [url, candidate]);
  return candidate
    ? state?.url === url
      ? state
      : { url, status: 'loading' }
    : null;
}
