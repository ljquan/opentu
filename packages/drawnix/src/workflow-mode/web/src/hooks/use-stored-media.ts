import { useEffect, useState, useSyncExternalStore } from 'react';
import { getImageBlob, getImagePreviewBlob } from '@/services/image-storage';
import { getMediaBlob } from '@/services/file-storage';
import { imageLeaseCache, mediaLeaseCache, type MediaLease } from '@/services/media-leases';

export function useStoredImage(key: string | undefined, fallback: string | undefined, preview = true) {
    const identity = `${key || ''}:${fallback || ''}`;
    const [failedPreview, setFailedPreview] = useState<string>();
    const source = useStoredMedia(key, fallback, 'image', preview && failedPreview !== identity);
    return { source, onError: () => { if (preview) setFailedPreview(identity); } };
}

export function useStoredMedia(key: string | undefined, fallback: string | undefined, kind: 'image' | 'video' | 'audio', preview = false) {
    const cache = kind === 'image' ? imageLeaseCache : mediaLeaseCache;
    const revision = useSyncExternalStore(cache.subscribe, () => key ? cache.revision(`${key}:`) : 0);
    const identity = `${kind}:${key || ''}:${fallback || ''}:${preview}:${revision}`;
    const [loaded, setLoaded] = useState<{ identity: string; url?: string; activation: { active: boolean } }>();
    useEffect(() => {
        if (!key) return;
        const activation = { active: true };
        let lease: MediaLease | undefined;
        const read = async () => {
            if (preview && kind === 'image') {
                const result = await imageLeaseCache.acquire(`${key}:preview:${fallback || ''}`, () => getImagePreviewBlob(key));
                if (result) return result;
            }
            return (kind === 'image' ? imageLeaseCache : mediaLeaseCache).acquire(
                `${key}:original:${fallback || ''}`, () => kind === 'image' ? getImageBlob(key) : getMediaBlob(key)
            );
        };
        void read().then(result => {
            if (!activation.active) { result?.release(); return; }
            lease = result;
            setLoaded({ identity, url: result?.url || (fallback?.startsWith('blob:') ? undefined : fallback), activation });
        }, () => { if (activation.active) setLoaded({ identity, url: fallback?.startsWith('blob:') ? undefined : fallback, activation }); });
        return () => { activation.active = false; lease?.release(); };
    }, [key, fallback, kind, preview, identity]);
    return key ? loaded?.identity === identity && loaded.activation.active ? loaded.url : undefined : fallback;
}
