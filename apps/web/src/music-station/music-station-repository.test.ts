import { beforeEach, describe, expect, it } from 'vitest';
import { musicReleaseRepository, type MusicRelease } from './music-station-repository';

const release: MusicRelease = {
  id: 'task:one',
  taskId: 'one',
  createdAt: 1,
  updatedAt: 1,
  title: '夜航',
  prompt: '夜晚城市漫步',
  tags: ['electronic'],
  model: 'suno_music',
  audioUrl: 'https://example.com/night.mp3',
  visibility: 'draft',
};

describe('musicReleaseRepository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and lists a release by most recent update', () => {
    musicReleaseRepository.save(release);
    musicReleaseRepository.save({ ...release, id: 'task:two', taskId: 'two', updatedAt: 2, title: '晨光' });

    expect(musicReleaseRepository.list().map((item) => item.title)).toEqual(['晨光', '夜航']);
  });

  it('persists visibility changes without changing the release identity', () => {
    musicReleaseRepository.save(release);

    const updated = musicReleaseRepository.setVisibility('task:one', 'public');

    expect(updated[0]).toMatchObject({ id: 'task:one', visibility: 'public' });
    expect(musicReleaseRepository.list()[0].taskId).toBe('one');
  });

  it('ignores malformed local records', () => {
    localStorage.setItem('opentu:music-releases:v1', JSON.stringify([{ id: 'broken' }]));

    expect(musicReleaseRepository.list()).toEqual([]);
  });
});

