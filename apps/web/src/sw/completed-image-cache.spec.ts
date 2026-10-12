import { describe, expect, it } from 'vitest';
import { cacheCompletedImage, trimCompletedImages, type CompletedImageEntry } from './completed-image-cache';
describe('completed image response cache', () => {
    it('uses the byte size supplied by the SW buffered image response', () => {
        const entries = new Map<string, CompletedImageEntry>();
        cacheCompletedImage(entries, 'stored', new Response('image', { headers: { 'sw-image-size': '5' } }));
        expect(entries.get('stored')?.bytes).toBe(5);
    });
    it('does not keep an unknown-size unconsumed response tee', () => {
        const entries = new Map<string, CompletedImageEntry>();
        cacheCompletedImage(entries, 'unknown', new Response('image'));
        expect(entries.size).toBe(0);
    });
    it('limits encoded bytes while preserving the original response for its caller', async () => {
        const entries = new Map<string, CompletedImageEntry>();
        const a = new Response('a', { headers: { 'Content-Length': String(40 * 1024 * 1024) } });
        const b = new Response('b', { headers: { 'Content-Length': String(40 * 1024 * 1024) } });
        cacheCompletedImage(entries, 'a', a, 1);
        cacheCompletedImage(entries, 'b', b, 2);
        expect([...entries.keys()]).toEqual(['b']);
        expect(await a.text()).toBe('a');
        expect(await b.text()).toBe('b');
    });
    it('expires old clones and keeps active callers usable', async () => {
        const entries = new Map<string, CompletedImageEntry>();
        const response = new Response('payload', { headers: { 'Content-Length': '7' } });
        cacheCompletedImage(entries, 'a', response, 0);
        const consumer = entries.get('a')!.response.clone();
        trimCompletedImages(entries, 30_001);
        expect(entries.size).toBe(0);
        expect(await consumer.text()).toBe('payload');
        expect(await response.text()).toBe('payload');
    });
});
