import { describe, expect, it } from 'vitest';
import {
  attachImageRecoveryRequestId,
  buildImageRecoveryUrl,
  getImageRecoveryRequestId,
  readImageRecoveryRequestId,
} from '../image-generation-recovery-metadata';

describe('image generation recovery metadata', () => {
  it('captures X-Oneapi-Request-Id case-insensitively', () => {
    const response = new Response(null, {
      headers: { 'x-oneapi-request-id': ' upstream-123 ' },
    });

    expect(readImageRecoveryRequestId(response)).toBe('upstream-123');
  });

  it('preserves the captured request id across wrapped failures', () => {
    const error = new Error('Load failed');
    attachImageRecoveryRequestId(error, 'upstream-456');

    expect(getImageRecoveryRequestId(error)).toBe('upstream-456');
  });

  it('builds the full log lookup URL without retaining a v1 suffix', () => {
    expect(
      buildImageRecoveryUrl(
        'https://api.tu-zi.com/v1',
        'request id/with symbols'
      )
    ).toBe(
      'https://api.tu-zi.com/log/get-request?id=request+id%2Fwith+symbols'
    );
  });
});
