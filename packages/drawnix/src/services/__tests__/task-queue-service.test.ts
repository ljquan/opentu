import { describe, expect, it } from 'vitest';

import {
  alignCachedAudioClipUrls,
  resolveAudioResultUrls,
} from '../audio-task-result-utils';

describe('task-queue-service', () => {
  it('aligns cached multi-audio urls back onto clip records by index', () => {
    const clips = [
      {
        clipId: 'clip-1',
        audioUrl: 'https://cdn1.suno.ai/clip-1.mp3',
        title: 'Song 1',
      },
      {
        clipId: 'clip-2',
        audioUrl: 'https://cdn1.suno.ai/clip-2.mp3',
        title: 'Song 2',
      },
    ];

    const aligned = alignCachedAudioClipUrls(
      clips,
      [
        '/__aitu_generated_audio__/task-1_0.mp3',
        '/__aitu_generated_audio__/task-1_1.mp3',
      ],
      '/__aitu_generated_audio__/task-1.mp3'
    );

    expect(aligned).toEqual([
      {
        clipId: 'clip-1',
        audioUrl: '/__aitu_generated_audio__/task-1_0.mp3',
        title: 'Song 1',
      },
      {
        clipId: 'clip-2',
        audioUrl: '/__aitu_generated_audio__/task-1_1.mp3',
        title: 'Song 2',
      },
    ]);
  });

  it('falls back to the primary cached url for a single clip result', () => {
    const clips = [
      {
        clipId: 'clip-1',
        audioUrl: 'https://cdn1.suno.ai/clip-1.mp3',
        title: 'Song 1',
      },
    ];

    const aligned = alignCachedAudioClipUrls(
      clips,
      undefined,
      '/__aitu_generated_audio__/task-1.mp3'
    );

    expect(aligned).toEqual([
      {
        clipId: 'clip-1',
        audioUrl: '/__aitu_generated_audio__/task-1.mp3',
        title: 'Song 1',
      },
    ]);
  });

  it('prefers clip audio urls over task-level urls when resolving audio results', () => {
    expect(
      resolveAudioResultUrls({
        url: '/__aitu_generated__/audio/task.mp3',
        urls: [
          '/__aitu_generated__/audio/task_0.mp3',
          '/__aitu_generated__/audio/task_1.mp3',
        ],
        clips: [
          { audioUrl: '/__aitu_generated__/audio/clip-a.mp3' },
          { audioUrl: '/__aitu_generated__/audio/clip-b.mp3' },
        ],
      })
    ).toEqual([
      '/__aitu_generated__/audio/clip-a.mp3',
      '/__aitu_generated__/audio/clip-b.mp3',
    ]);
  });
});
