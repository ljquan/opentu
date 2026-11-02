import React from 'react';
import { useThumbnailUrl } from '../../hooks/useThumbnailUrl';
import type { Asset } from '../../types/asset.types';
import { LazyImage } from '../lazy-image';

/** Use the same thumbnail/cache loading path as the media library's compact view. */
export function BatchLibraryThumbnail({
  asset,
}: {
  asset: Pick<Asset, 'url' | 'name'>;
}) {
  const thumbnailUrl = useThumbnailUrl(asset.url, 'image', 'small');

  return (
    <LazyImage
      src={thumbnailUrl || asset.url}
      alt={asset.name}
      objectFit="contain"
      rootMargin="100px"
    />
  );
}
