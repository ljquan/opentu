import { describe, expect, it } from 'vitest';
import {
  appendUrlHashToBackupName,
  ensureUniqueBackupName,
  getCandidateExtensions,
  getExtensionFromMimeType,
  hasExportableTaskMedia,
  normalizeBackupAssetType,
  normalizeCacheMediaType,
} from './backup-utils';

describe('backup-utils', () => {
  it('supports audio mime types and candidate extensions', () => {
    expect(getExtensionFromMimeType('audio/mpeg')).toBe('.mp3');
    expect(getExtensionFromMimeType('audio/mp4')).toBe('.m4a');
    expect(getCandidateExtensions('audio/mpeg')).toContain('.mp3');
    expect(getCandidateExtensions('audio/mp4')).toContain('.m4a');
    expect(getCandidateExtensions()).toContain('.flac');
  });

  it('normalizes backup and cache media types for audio', () => {
    expect(normalizeBackupAssetType('audio', 'audio/mpeg')).toBe('AUDIO');
    expect(normalizeBackupAssetType('VIDEO', 'video/mp4')).toBe('VIDEO');
    expect(normalizeCacheMediaType('AUDIO', 'audio/mpeg')).toBe('audio');
    expect(normalizeCacheMediaType(undefined, 'video/webm')).toBe('video');
    expect(normalizeCacheMediaType(undefined, 'image/png')).toBe('image');
  });

  it('builds stable unique backup names for different urls and collisions', () => {
    const nameA = appendUrlHashToBackupName('20260413_task-1', '/__aitu_cache__/audio/task-1-0.mp3');
    const nameB = appendUrlHashToBackupName('20260413_task-1', '/__aitu_cache__/audio/task-1-1.mp3');

    expect(nameA).not.toBe(nameB);

    const usedNames = new Set<string>();
    const uniqueA = ensureUniqueBackupName(nameA, usedNames);
    const uniqueB = ensureUniqueBackupName(nameA, usedNames);

    expect(uniqueA).toBe(nameA);
    expect(uniqueB).toBe(`${nameA}_2`);
  });

  it('treats urls and audio clips as exportable task media', () => {
    expect(hasExportableTaskMedia({ url: '/a.mp3' })).toBe(true);
    expect(hasExportableTaskMedia({ urls: ['/a.mp3', ''] })).toBe(true);
    expect(hasExportableTaskMedia({ clips: [{ audioUrl: '/clip.mp3' }] })).toBe(true);
    expect(hasExportableTaskMedia({ clips: [{ audioUrl: '' }] })).toBe(false);
    expect(hasExportableTaskMedia({})).toBe(false);
  });
});
