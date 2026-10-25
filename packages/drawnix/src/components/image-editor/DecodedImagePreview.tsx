import React, { useEffect, useRef } from 'react';

/** Draw the decoded source; its temporary URL may already have been released. */
export const DecodedImagePreview: React.FC<{
  image: HTMLImageElement;
  label?: string;
  style?: React.CSSProperties;
  maxSize?: number;
}> = ({ image, label, style, maxSize = 2048 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(1, maxSize / width, maxSize / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas
      .getContext('2d')
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return () => {
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [image, width, height, maxSize]);

  return (
    <canvas
      ref={canvasRef}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width, height, ...style }}
    />
  );
};
