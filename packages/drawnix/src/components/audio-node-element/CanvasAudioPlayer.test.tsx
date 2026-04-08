import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasAudioPlayer } from './CanvasAudioPlayer';
import { useCanvasAudioPlayback } from '../../hooks/useCanvasAudioPlayback';

vi.mock('../../hooks/useCanvasAudioPlayback', () => ({
  useCanvasAudioPlayback: vi.fn(),
}));

const mockedUseCanvasAudioPlayback = vi.mocked(useCanvasAudioPlayback);

afterEach(() => {
  cleanup();
  mockedUseCanvasAudioPlayback.mockReset();
});

function createPlaybackMock() {
  return {
    activeAudioUrl: 'https://example.com/audio.mp3',
    activePreviewImageUrl: undefined,
    activeTitle: '测试音频',
    activeQueueIndex: 0,
    queue: [{ audioUrl: 'https://example.com/audio.mp3', title: '测试音频' }],
    playing: true,
    currentTime: 12,
    duration: 120,
    volume: 0.78,
    pausePlayback: vi.fn(),
    resumePlayback: vi.fn(),
    playPrevious: vi.fn(),
    playNext: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    stopPlayback: vi.fn(),
  };
}

describe('CanvasAudioPlayer', () => {
  it('keeps the volume panel expanded on the first pointer click after blur', () => {
    mockedUseCanvasAudioPlayback.mockReturnValue(createPlaybackMock());

    render(<CanvasAudioPlayer />);

    const toggleButton = screen.getByRole('button', { name: 'Volume controls' });

    fireEvent.pointerDown(toggleButton);
    fireEvent.focus(toggleButton);
    fireEvent.click(toggleButton);

    expect(toggleButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the current volume percentage when expanded', () => {
    mockedUseCanvasAudioPlayback.mockReturnValue(createPlaybackMock());

    render(<CanvasAudioPlayer />);

    const toggleButton = screen.getByRole('button', { name: 'Volume controls' });

    fireEvent.focus(toggleButton);

    expect(screen.getByText('78%')).toBeTruthy();
  });

  it('expands the volume panel when the toggle receives keyboard focus', () => {
    mockedUseCanvasAudioPlayback.mockReturnValue(createPlaybackMock());

    render(<CanvasAudioPlayer />);

    const toggleButton = screen.getByRole('button', { name: 'Volume controls' });

    fireEvent.focus(toggleButton);

    expect(toggleButton.getAttribute('aria-expanded')).toBe('true');
  });
});
