import { useEffect, useState } from 'react';
import type { NodeGenerationInput } from '@/components/canvas/canvas-node-generation';
import { getImageBlob, getImagePreviewBlob } from '@/services/image-storage';
import { imageLeaseCache, type MediaLease } from '@/services/media-leases';

export function useStoredInputs(inputs: NodeGenerationInput[], selectedIds?: Set<string>) {
    const [loaded, setLoaded] = useState<{ inputs: NodeGenerationInput[]; selectedIds?: Set<string>; resolved: NodeGenerationInput[]; activation: { active: boolean } }>();
    useEffect(() => {
        const activation = { active: true };
        const leases: MediaLease[] = [];
        const resolve = async (input: NodeGenerationInput): Promise<NodeGenerationInput> => {
            // Groups, video and audio chips show labels/icons and need no media read.
            if (input.type !== 'image' || !input.image?.storageKey || (selectedIds && !selectedIds.has(input.nodeId))) return input;
            const key = input.image.storageKey;
            const fallback = input.image.dataUrl;
            let lease: MediaLease | undefined;
            try {
                lease = await imageLeaseCache.acquire(`${key}:preview:${fallback}`, () => getImagePreviewBlob(key))
                    || await imageLeaseCache.acquire(`${key}:original:${fallback}`, () => getImageBlob(key));
            } catch { return input; }
            if (!lease) return input;
            if (!activation.active) { lease.release(); return input; }
            leases.push(lease);
            return { ...input, image: { ...input.image, dataUrl: lease.url } };
        };
        void Promise.all(inputs.map(resolve)).then(resolved => { if (activation.active) setLoaded({ inputs, selectedIds, resolved, activation }); }, () => undefined);
        return () => { activation.active = false; leases.forEach(lease => lease.release()); };
    }, [inputs, selectedIds]);
    return loaded?.inputs === inputs && loaded.selectedIds === selectedIds && loaded.activation.active ? loaded.resolved : inputs;
}
