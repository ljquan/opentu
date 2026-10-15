// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SunoNativeResultDetails } from './SunoNativeResultDetails';
import type { NativeSunoResult } from '../../services/suno-native';
afterEach(cleanup);
const base: NativeSunoResult = { action: 'mp4', profileId: 'p', resources: [], files: [], lyrics: [], data: {} };
it('plays MP4 as video and preserves public IDs without an audio player', () => {
  const { container } = render(<SunoNativeResultDetails result={{ ...base, resources: [{ profileId: 'p', sourceAction: 'mp4', taskId: 'public-task', audioId: 'public-audio' }], files: [{ url: 'https://cdn.test/video.mp4', kind: 'video', label: 'MP4' }] }} />);
  expect(container.querySelector('video')?.getAttribute('src')).toBe('https://cdn.test/video.mp4');
  expect(container.querySelector('audio')).toBeNull(); expect(screen.getByText(/public-task/)).toBeTruthy();
});
it('renders timeline, MIDI tracks and validation text as data', () => {
  render(<SunoNativeResultDetails result={{ ...base, data: { alignedWords: [{ word: '<script>text</script>', startS: 1, endS: 2 }], midiData: { instruments: [{ name: 'Piano' }] }, validateInfo: 'Read this phrase', waveformData: [0, 1] } }} />);
  expect(screen.getByRole('table', { name: '歌词时间轴' })).toBeTruthy(); expect(screen.getByText('Piano')).toBeTruthy();
  expect(screen.getByText('Read this phrase')).toBeTruthy(); expect(screen.getByText('<script>text</script>')).toBeTruthy();
});
it('shows zero credits and unavailable voice results without treating them as empty', () => {
  const { rerender } = render(<SunoNativeResultDetails result={{ ...base, action: 'credits', data: 0 }} />);
  expect(screen.getByText('上游剩余额度：0')).toBeTruthy();
  rerender(<SunoNativeResultDetails result={{ ...base, action: 'voice-check', data: { isAvailable: false } }} />);
  expect(screen.getByText('音色状态：尚不可用')).toBeTruthy();
});
