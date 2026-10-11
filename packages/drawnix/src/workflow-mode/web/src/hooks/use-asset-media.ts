import type { Asset } from '@/stores/use-asset-store';
import { useState } from 'react';
import { useStoredMedia } from './use-stored-media';

export function useAssetMedia(asset: Asset | null, preview = false, loadVideo = true) {
    const [failedCover, setFailedCover] = useState<string>();
    const media = asset && asset.kind !== 'text' ? asset : undefined;
    const original = media?.kind === 'image' ? media.data.dataUrl : media?.data.url;
    const identity = `${media?.data.storageKey || ''}:${original || ''}:${media?.coverUrl || ''}`;
    const customCover = failedCover !== identity && media?.coverUrl && media.coverUrl !== original ? media.coverUrl : undefined;
    const loadOriginal = media?.kind !== 'video' || (loadVideo && !customCover);
    const source = useStoredMedia(loadOriginal ? media?.data.storageKey : undefined, loadOriginal ? original : undefined, media?.kind === 'video' ? 'video' : 'image', preview && failedCover !== identity);
    return { source, cover: customCover || (media?.kind === 'image' ? source : undefined), onCoverError: () => setFailedCover(identity) };
}
