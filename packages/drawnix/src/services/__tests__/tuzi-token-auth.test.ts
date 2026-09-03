// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getTuziSystemTokenFromHref,
  getTuziSystemUserId,
  getTuziSystemUserIdFromHref,
  initializeTuziSystemTokenFromUrl,
} from '../tuzi-token-auth';

describe('Tuzi URL credentials', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('reads the short id and token parameters', () => {
    expect(
      getTuziSystemUserIdFromHref(
        'http://localhost:7200/?id=40832&token=system-token'
      )
    ).toBe('40832');
    expect(
      getTuziSystemTokenFromHref(
        'http://localhost:7200/?id=40832&token=system-token'
      )
    ).toBe('system-token');
  });

  it('preserves literal plus characters in token parameters', () => {
    expect(
      getTuziSystemTokenFromHref(
        'http://localhost:7200/?id=40832&token=Xxj+rqmrWFRt3vubveJeOfTT%2BJ'
      )
    ).toBe('Xxj+rqmrWFRt3vubveJeOfTT+J');
  });

  it('accepts the existing compatibility parameter names', () => {
    expect(getTuziSystemUserIdFromHref('?tuzi_user_id=40832')).toBe('40832');
    expect(getTuziSystemTokenFromHref('?key=system-token')).toBe(
      'system-token'
    );
  });

  it('stores both URL values and removes them from the address bar', () => {
    window.history.replaceState(
      {},
      '',
      '/?board=board-id&id=40832&token=system-token'
    );

    expect(initializeTuziSystemTokenFromUrl()).toBe('system-token');
    expect(getTuziSystemUserId()).toBe('40832');
    expect(window.location.search).toBe('?board=board-id');
  });
});
