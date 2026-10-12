import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateCanvasImages, hydrateAssistantImages } from '../src/lib/canvas/canvas-generation-helpers';
import { CanvasNodeType, type CanvasNodeData, type CanvasAssistantSession } from '../src/types/canvas';

const read = vi.hoisted(() => ({ image: vi.fn(), media: vi.fn(), upload: vi.fn(), preview: vi.fn() }));
vi.mock('../src/services/image-storage', () => ({ resolveImageUrl: read.image, uploadImage: read.upload, ensureImagePreview: read.preview, deleteStoredImages: vi.fn() }));
vi.mock('../src/services/file-storage', () => ({ resolveMediaUrl: read.media }));
beforeEach(() => { vi.clearAllMocks(); read.image.mockResolvedValue('blob:restored-image'); read.media.mockResolvedValue('blob:restored-media'); });

describe('deferred project restoration', () => {
    const nodes = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].map((type, i) => ({ id: `node-${i}`, type, metadata: { content: 'blob:previous-session', storageKey: `${type}:old`, images: [{ id: 'slot', content: 'blob:old-slot', storageKey: 'image:slot' }] } } as CanvasNodeData));
    it('retains old metadata and batch slots without reading every original on startup', async () => {
        const snapshot = JSON.stringify(nodes);
        expect(await hydrateCanvasImages(nodes, true)).toEqual(nodes);
        expect(JSON.stringify(nodes)).toBe(snapshot);
        expect(read.image).not.toHaveBeenCalled(); expect(read.media).not.toHaveBeenCalled();
    });
    it('preserves the eager restoration contract for callers that need resolved originals', async () => {
        const result = await hydrateCanvasImages(nodes);
        expect(result[0].metadata?.content).toBe('blob:restored-image');
        expect(result[1].metadata?.content).toBe('blob:restored-media');
        expect(result[2].metadata?.content).toBe('blob:restored-media');
        expect(read.image).toHaveBeenCalledWith('image:slot', 'blob:old-slot');
    });
    it('keeps saved assistant references compatible with deferred and eager consumers', async () => {
        const sessions = [{ id: 'chat', messages: [{ references: [{ storageKey: 'image:old', dataUrl: 'blob:old', name: 'original.png' }] }] }] as unknown as CanvasAssistantSession[];
        expect(await hydrateAssistantImages(sessions, true)).toEqual(sessions);
        expect(read.image).not.toHaveBeenCalled();
        const restored = await hydrateAssistantImages(sessions);
        expect(restored[0].messages[0].references?.[0].dataUrl).toBe('blob:restored-image');
    });
});
