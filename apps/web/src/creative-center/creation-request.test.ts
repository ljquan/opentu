import { describe, expect, it } from 'vitest';
import { creationPrefillParams } from './creation-request';

describe('creation prefill parameters', () => {
  it('maps managed image ratio to the server-supported size', () => {
    expect(creationPrefillParams({ mode: 'image', aspectRatio: '1:1', quality: 'standard' }, true)).toEqual({
      size: '1024x1024',
      quality: 'standard',
    });
  });

  it('preserves local image and other creation parameters', () => {
    expect(creationPrefillParams({ mode: 'image', aspectRatio: '16:9', quality: 'high' }, false)).toEqual({
      size: '16:9',
      quality: 'high',
    });
    expect(creationPrefillParams({ mode: 'video', aspectRatio: '16:9' }, true)).toEqual({ size: '16:9' });
  });
});
