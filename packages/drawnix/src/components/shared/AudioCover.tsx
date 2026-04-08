import React, { useEffect, useState } from 'react';
import { Music4 } from 'lucide-react';

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
  const [currentSrc, setCurrentSrc] = useState(src);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
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
        if (fallbackSrc && currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc);
          return;
        }
        setLoadFailed(true);
      }}
    />
  );
};
