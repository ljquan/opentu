import type { ImgHTMLAttributes, VideoHTMLAttributes } from 'react';
import { useMediaIntersection } from '@/hooks/use-media-intersection';
import { useStoredImage, useStoredMedia } from '@/hooks/use-stored-media';

export function StoredImageThumbnail({ storageKey, src, onError, ...props }: ImgHTMLAttributes<HTMLImageElement> & { storageKey?: string }) {
    const { ref, visible } = useMediaIntersection<HTMLImageElement>();
    const media = useStoredImage(visible ? storageKey : undefined, visible ? src : undefined);
    return <img {...props} ref={ref} src={media.source} decoding="async" onError={event => { media.onError(); onError?.(event); }} />;
}

export function StoredVideoThumbnail({ storageKey, src, ...props }: VideoHTMLAttributes<HTMLVideoElement> & { storageKey?: string }) {
    const { ref, visible } = useMediaIntersection<HTMLVideoElement>();
    const source = useStoredMedia(visible ? storageKey : undefined, visible ? src : undefined, 'video');
    return <video {...props} ref={ref} src={source ? `${source}#t=0.1` : undefined} muted playsInline preload="metadata" />;
}
