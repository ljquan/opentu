import { describe, expect, it, vi } from 'vitest';
import type { PlaitElement } from '@plait/core';
import { getCanvasGenerationDetailsSource } from './canvas-generation-details-source';

vi.mock('../plugins/with-video', () => ({
  isVideoElement: (element: PlaitElement) => element.isVideo === true,
}));
vi.mock('../plugins/with-tool', () => ({
  isToolElement: (element: PlaitElement) => element.type === 'tool',
}));

describe('canvas generation details sources', () => {
  it.each([
    [{ type: 'image', url: '/image.png' }, 'image'],
    [{ type: 'image', isVideo: true, url: '/video.mp4' }, 'video'],
    [{ type: 'audio', audioUrl: '/song.mp3' }, 'audio'],
    [{ type: 'geometry', shape: 'text' }, 'text'],
    [{ type: 'card', title: 'hi', body: 'Hi there!' }, 'text'],
  ] as const)(
    'recognizes media/text with the original task binding',
    (fields, kind) => {
      const source = getCanvasGenerationDetailsSource({
        id: 'element',
        ...fields,
        generationTaskId: 'task',
        aiPrompt: 'original prompt',
        width: 400,
        height: 300,
      } as PlaitElement);
      expect(source).toMatchObject({
        kind,
        generationTaskId: 'task',
        prompt: 'original prompt',
      });
      if (kind === 'audio') expect(source?.url).toBe('/song.mp3');
      if (kind === 'audio' || kind === 'text')
        expect(source?.width).toBeUndefined();
    }
  );
  it('keeps a manual card as text without inventing generation metadata from its body', () => {
    const source = getCanvasGenerationDetailsSource({
      id: 'manual-card',
      type: 'card',
      title: 'Note',
      body: 'Manual text',
    });
    expect(source).toMatchObject({ kind: 'text', id: 'manual-card' });
    expect(source?.generationTaskId).toBeUndefined();
    expect(source?.prompt).toBeUndefined();
  });
  it('excludes shapes, embedded tools and no selection', () => {
    expect(getCanvasGenerationDetailsSource()).toBeUndefined();
    expect(
      getCanvasGenerationDetailsSource({
        id: 'shape',
        type: 'geometry',
        shape: 'rectangle',
      })
    ).toBeUndefined();
    expect(
      getCanvasGenerationDetailsSource({
        id: 'tool',
        type: 'tool',
        url: '/image.png',
      })
    ).toBeUndefined();
  });
});
