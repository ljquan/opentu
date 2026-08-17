import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyOpenTuAccountError } from '../../contexts/OpenTuAccountContext';
import { OpenTuApiResponseError } from '../opentu-api-client';
import {
  clearOpenTuAccountRuntimeSession,
  getOpenTuAccountRuntimeSession,
  setOpenTuAccountRuntimeSession,
  subscribeOpenTuAccountRuntimeSession,
} from '../opentu-account-runtime';

describe('OpenTu account runtime session', () => {
  afterEach(() => clearOpenTuAccountRuntimeSession());

  it('defaults to standalone and publishes only validated embedded sessions', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenTuAccountRuntimeSession(listener);

    expect(getOpenTuAccountRuntimeSession()).toEqual({ mode: 'standalone' });
    setOpenTuAccountRuntimeSession({
      mode: 'embedded',
      credentialId: ' credential-1 ',
      userId: 9,
      parentOrigin: ' http://127.0.0.1:5173 ',
      channel: ' channel-1 ',
    });
    expect(getOpenTuAccountRuntimeSession()).toEqual({
      mode: 'embedded',
      credentialId: 'credential-1',
      userId: 9,
      parentOrigin: 'http://127.0.0.1:5173',
      channel: 'channel-1',
    });
    expect(listener).toHaveBeenCalledTimes(1);

    clearOpenTuAccountRuntimeSession();
    expect(getOpenTuAccountRuntimeSession()).toEqual({ mode: 'standalone' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('rejects an incomplete embedded identity', () => {
    expect(() =>
      setOpenTuAccountRuntimeSession({
        mode: 'embedded',
        credentialId: '',
        userId: 0,
        parentOrigin: '',
        channel: '',
      })
    ).toThrow('Invalid embedded OpenTu account runtime session');
    expect(getOpenTuAccountRuntimeSession()).toEqual({ mode: 'standalone' });
  });
});

describe('OpenTu account error classification', () => {
  it.each([
    [new OpenTuApiResponseError('expired', 401, 'invalid_token'), 'expired'],
    [new OpenTuApiResponseError('revoked', 403, 'device_revoked'), 'revoked'],
    [
      new OpenTuApiResponseError('quota', 429, 'insufficient_quota'),
      'insufficient',
    ],
    [new OpenTuApiResponseError('failure', 500, 'internal_error'), 'error'],
  ] as const)('classifies %s as %s', (error, expected) => {
    expect(classifyOpenTuAccountError(error).kind).toBe(expected);
  });
});
