import React, { useEffect, useState } from 'react';
import { Music4 } from 'lucide-react';
import { normalizeImageDataUrl } from '@aitu/utils';

interface AudioCoverProps {
  src?: string;
  fallbackSrc?: string;
  alt: string;
  imageClassName?: string;
  fallbackClassName: string;
  iconSize?: number;
  draggable?: boolean;
  loading?: 'eager' | 'lazy';
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>['referrerPolicy'];
}

export const AudioCover: React.FC<AudioCoverProps> = ({
  src,
  fallbackSrc,
  alt,
  imageClassName,
  fallbackClassName,
  iconSize = 18,
  draggable = false,
  loading,
  referrerPolicy = 'no-referrer',
}) => {
  const normalizeSafeImageSrc = (value?: string): string | undefined => {
    if (!value) {
      return undefined;
    }

    const normalized = normalizeImageDataUrl(value);
    if (!normalized) {
      return undefined;
    }

    if (
      normalized.startsWith('data:') ||
      normalized.startsWith('blob:') ||
      normalized.startsWith('/') ||
      normalized.startsWith('./') ||
      normalized.startsWith('../')
    ) {
      return normalized;
    }

    try {
      const parsed = new URL(normalized, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      return undefined;
    }

    return undefined;
  };

  const [currentSrc, setCurrentSrc] = useState(() => normalizeSafeImageSrc(src));
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(normalizeSafeImageSrc(src));
    setLoadFailed(false);
  }, [src]);

  if (!currentSrc || loadFailed) {
    return (
      <div className={fallbackClassName} aria-label={alt}>
        <Music4 size={iconSize} />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={imageClassName}
      draggable={draggable}
      loading={loading}
      referrerPolicy={referrerPolicy}
      onError={() => {
        const safeFallbackSrc = normalizeSafeImageSrc(fallbackSrc);
        if (safeFallbackSrc && currentSrc !== safeFallbackSrc) {
          setCurrentSrc(safeFallbackSrc);
          return;
        }
        setLoadFailed(true);
      }}
    />
  );
};
