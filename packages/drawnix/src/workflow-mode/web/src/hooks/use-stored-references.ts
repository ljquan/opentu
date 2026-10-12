import { useEffect, useState } from 'react';
import type { CanvasResourceReference } from '@/lib/canvas/canvas-resource-references';
import { getImageBlob, getImagePreviewBlob } from '@/services/image-storage';
import { imageLeaseCache, type MediaLease } from '@/services/media-leases';

export function useStoredReferences<T extends Pick<CanvasResourceReference, 'kind' | 'previewUrl' | 'storageKey'>>(references: T[]) {
    const [loaded, setLoaded] = useState<{ references: T[]; resolved: T[]; activation: { active: boolean } }>();
    useEffect(() => {
        const activation = { active: true };
        const leases: MediaLease[] = [];
        void Promise.all(references.map(async reference => {
            if (reference.kind !== 'image' || !reference.storageKey) return reference;
            const key = reference.storageKey;
            const suffix = reference.previewUrl || '';
            let lease: MediaLease | undefined;
            try {
                lease = await imageLeaseCache.acquire(`${key}:preview:${suffix}`, () => getImagePreviewBlob(key))
                    || await imageLeaseCache.acquire(`${key}:original:${suffix}`, () => getImageBlob(key));
            } catch { return reference; }
            if (!activation.active) { lease?.release(); return reference; }
            if (lease) leases.push(lease);
            return { ...reference, previewUrl: lease?.url || (reference.previewUrl?.startsWith('blob:') ? undefined : reference.previewUrl) };
        })).then(resolved => { if (activation.active) setLoaded({ references, resolved, activation }); }, () => undefined);
        return () => { activation.active = false; leases.forEach(lease => lease.release()); };
    }, [references]);
    return loaded?.references === references && loaded.activation.active ? loaded.resolved : references;
}
