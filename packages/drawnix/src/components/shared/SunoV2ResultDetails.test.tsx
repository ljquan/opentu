// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SunoV2ResultDetails } from './SunoV2ResultDetails';
import { normalizeSunoV2Response } from '../../services/suno-v2';

afterEach(cleanup);
function show(action: string, result: unknown) {
  const normalized = normalizeSunoV2Response({ status: 'SUCCESS', action, result }, 't', 'p').sunoV2;
  if (!normalized) throw new Error('Missing normalized result');
  return render(<SunoV2ResultDetails result={normalized} />);
}
describe('Suno structured result display', () => {
  it('shows expanded styles as text, never interprets HTML', () => {
    show('upsample-tags', { upsampled_tags: '<script>piano</script>' });
    expect(screen.getByText('<script>piano</script>')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });
  it('shows lyric timestamps and keeps the complete waveform available', () => {
    show('aligned-lyrics', { alignment: [{ word: 'Hello', start_s: 0, end_s: 2 }], waveform_data: [0.2, 0.4] });
    expect(screen.getByRole('table', { name: '歌词时间轴' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '0' })).toBeTruthy();
    expect(screen.getByText('波形数据：2 个采样点')).toBeTruthy();
  });
  it('shows MIDI instruments and file downloads without an audio player', () => {
    show('gen-midi', { instruments: [{ name: 'Piano', midi_url: 'https://cdn.test/piano.mid' }] });
    expect(screen.getByText('Piano')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'MIDI 下载' }).getAttribute('href')).toBe('https://cdn.test/piano.mid');
    expect(document.querySelector('audio')).toBeNull();
  });
  it('shows trained model IDs as reusable resources', () => {
    show('create-model', { model_id: 'trained-model' });
    expect(screen.getByText('自建模型：trained-model')).toBeTruthy();
  });
});
