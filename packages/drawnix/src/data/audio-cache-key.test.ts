import { describe, expect, it } from 'vitest';

import { getAudioCacheKeySeed } from './audio-cache-key';

describe('audio-cache-key', () => {
  it('prefers clip id for multi-clip insertions', () => {
    expect(
      getAudioCacheKeySeed('https://cdn.example.com/song-a.mp3', {
        clipId: 'clip-a',
        providerTaskId: 'task-1',
      })
    ).toBe('clip-a');
  });

  it('includes audio hash when only provider task id is available', () => {
    const first = getAudioCacheKeySeed('https://cdn.example.com/song-a.mp3', {
      providerTaskId: 'task-1',
    });
    const second = getAudioCacheKeySeed('https://cdn.example.com/song-b.mp3', {
      providerTaskId: 'task-1',
    });

    expect(first).not.toBe(second);
    expect(first.startsWith('task-1-')).toBe(true);
    expect(second.startsWith('task-1-')).toBe(true);
  });
});
