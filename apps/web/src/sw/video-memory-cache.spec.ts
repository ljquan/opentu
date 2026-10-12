import { describe, expect, it } from 'vitest';
import {
  trimVideoMemoryCache,
  VIDEO_MEMORY_BUDGET,
  type VideoMemoryEntry,
} from './video-memory-cache';

function entry(size: number, timestamp: number): VideoMemoryEntry {
  return { blob: { size } as Blob, timestamp };
}

describe('video memory cache', () => {
  it('evicts the oldest data by byte budget even when entry count is below ten', () => {
    const cache = new Map([
      ['old', entry(40 * 1024 * 1024, 1)],
      ['new', entry(40 * 1024 * 1024, 2)],
    ]);
    trimVideoMemoryCache(cache, 3);
    expect([...cache.keys()]).toEqual(['new']);
  });
  it('does not retain a single item above budget', () => {
    const cache = new Map([['large', entry(VIDEO_MEMORY_BUDGET + 1, 0)]]);
    trimVideoMemoryCache(cache, 1);
    expect(cache.size).toBe(0);
  });
  it('expires entries before they can be used, without requiring an image request', () => {
    const cache = new Map([
      ['expired', entry(10, 0)],
      ['recent', entry(20, 300001)],
    ]);
    trimVideoMemoryCache(cache, 300001);
    expect([...cache.keys()]).toEqual(['recent']);
  });
  it('retains the existing ten-entry cap for small resources', () => {
    const cache = new Map(
      Array.from({ length: 11 }, (_, i) => [String(i), entry(1, i)])
    );
    trimVideoMemoryCache(cache, 11);
    expect(cache.size).toBe(10);
    expect(cache.has('0')).toBe(false);
  });
  it('eviction leaves a Blob already acquired by an active response usable', () => {
    const blob = new Blob(['video data'], { type: 'video/mp4' });
    const cache = new Map([['old', { blob, timestamp: 0 }]]);
    const acquired = cache.get('old')!.blob;
    trimVideoMemoryCache(cache, 300001);
    expect(acquired.size).toBe(10);
    expect(acquired.type).toBe('video/mp4');
  });
});
