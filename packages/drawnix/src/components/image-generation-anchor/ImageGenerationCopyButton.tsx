import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Shared by the existing local-ID action and provider diagnostic fields. */
export const ImageGenerationCopyButton: React.FC<{
  label: string;
  value: string;
  detail?: boolean;
  className?: string;
}> = ({ label, value, detail = false, className }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => setState('idle'), [value]);
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <button
      type="button"
      className={className || `image-generation-anchor__copy-button${
        detail ? ' image-generation-anchor__copy-button--detail' : ''
      }`}
      aria-label={`复制 ${label}`}
      title={
        state === 'copied'
          ? '已复制'
          : state === 'failed'
          ? '复制失败，请选中文字手动复制'
          : `复制 ${label}`
      }
      onPointerDown={(event) => {
        stop(event);
        event.preventDefault();
      }}
      onMouseDown={(event) => {
        stop(event);
        event.preventDefault();
      }}
      onPointerUp={stop}
      onMouseUp={stop}
      onKeyDown={stop}
      onClick={async (event) => {
        stop(event);
        try {
          await navigator.clipboard.writeText(value);
          setState('copied');
        } catch {
          setState('failed');
        }
      }}
    >
      {state === 'copied' ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
};
