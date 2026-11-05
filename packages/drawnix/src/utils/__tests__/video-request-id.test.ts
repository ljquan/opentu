import { describe, expect, it } from 'vitest';
import {
  readVideoSubmissionRequestId,
  readVideoTaskRequestId,
  withVideoRequestId,
} from '../video-request-id';

describe('video API-site submission identity', () => {
  it('does not treat generic headers, upstream errors or task IDs as submission IDs', () => {
    const response = new Response(null, {
      headers: { 'x-request-id': 'local-id' },
    });
    const body = {
      id: 'task-id',
      error: { message: 'Failed request id: upstream-id' },
    };
    expect(readVideoSubmissionRequestId(response, body)).toBeUndefined();
    expect(readVideoTaskRequestId(body)).toBeUndefined();
  });

  it.each(['submission_request_id', 'original_request_id', 'api_request_id'])(
    'accepts an explicitly task-scoped %s from status responses',
    (field) => {
      expect(
        readVideoTaskRequestId({
          [field]: 'original-id',
          request_id: 'poll-id',
        })
      ).toBe('original-id');
    }
  );

  it('accepts a submission body ID but never a generic polling body ID', () => {
    expect(
      readVideoSubmissionRequestId(new Response(), '{"request_id":"site-id"}')
    ).toBe('site-id');
    expect(readVideoTaskRequestId({ request_id: 'poll-id' })).toBeUndefined();
    expect(
      readVideoSubmissionRequestId(new Response(), 'invalid JSON')
    ).toBeUndefined();
  });

  it('adds metadata without changing error identity, type or existing diagnostics', () => {
    const error = Object.assign(new TypeError('network'), {
      diagnostics: { requestId: 'upstream-id' },
    });
    expect(withVideoRequestId(error, 'site-id')).toBe(error);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.diagnostics).toEqual({
      requestId: 'upstream-id',
      apiRequestId: 'site-id',
    });
    withVideoRequestId(error, undefined);
    expect(error.diagnostics).toHaveProperty('apiRequestId', 'site-id');
  });
});
