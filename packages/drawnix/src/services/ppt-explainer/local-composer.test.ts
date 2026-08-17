import { describe, expect, it } from 'vitest';
import { chooseLocalPptRecorderFormat } from './local-composer';

describe('local PPT explainer composer', () => {
  it('prefers MP4 when the browser supports audio and video codecs', () => {
    expect(
      chooseLocalPptRecorderFormat((mimeType) => mimeType.startsWith('video/mp4'))
    ).toEqual({
      mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
      extension: 'mp4',
    });
  });

  it('falls back to VP9 WebM and then an unspecified recorder format', () => {
    expect(
      chooseLocalPptRecorderFormat((mimeType) =>
        mimeType.includes('vp9,opus')
      ).extension
    ).toBe('webm');
    expect(chooseLocalPptRecorderFormat(() => false)).toEqual({
      mimeType: '',
      extension: 'webm',
    });
  });
});
