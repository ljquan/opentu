// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeTuziProviderGroupFromUrl,
  getTuziProviderGroupFromHref,
  getTuziSystemTokenFromHref,
  getTuziSystemUserId,
  getTuziSystemUserIdFromHref,
  initializeTuziSystemTokenFromUrl,
  wasTuziCredentialsProvidedByUrl,
} from '../tuzi-token-auth';
import { getTuziProviderGroupSelection } from '../tuzi-provider-selection';

describe('Tuzi URL credentials', () => {
  beforeEach(() => {
    consumeTuziProviderGroupFromUrl();
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

  it('reads credentials from the namespaced URL fragment', () => {
    const fragment = new URLSearchParams({
      opentu_auth: JSON.stringify({
        id: '40832',
        token: 'fragment+token/value=',
        group: 'vip',
        hash: 'board',
      }),
    });
    const href = `http://localhost:7200/workspace?mode=embed#${fragment}`;

    expect(getTuziSystemUserIdFromHref(href)).toBe('40832');
    expect(getTuziSystemTokenFromHref(href)).toBe('fragment+token/value=');
    expect(getTuziProviderGroupFromHref(href)).toBe('vip');
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
    expect(wasTuziCredentialsProvidedByUrl()).toBe(true);
    expect(getTuziSystemUserId()).toBe('40832');
    expect(window.location.search).toBe('?board=board-id');
  });

  it('stores the selected group for the URL user and removes it from the address bar', () => {
    window.history.replaceState(
      {},
      '',
      '/?board=board-id&id=40832&token=system-token&group=vip'
    );

    expect(getTuziProviderGroupFromHref(window.location.href)).toBe('vip');
    initializeTuziSystemTokenFromUrl();

    expect(getTuziProviderGroupSelection('40832')).toEqual(['vip']);
    expect(consumeTuziProviderGroupFromUrl()).toBe('vip');
    expect(consumeTuziProviderGroupFromUrl()).toBe('');
    expect(window.location.search).toBe('?board=board-id');
  });

  it('stores fragment credentials and restores the original hash immediately', () => {
    const fragment = new URLSearchParams({
      opentu_auth: JSON.stringify({
        id: '40832',
        token: 'fragment-system-token',
        group: 'vip',
        hash: 'board',
      }),
    });
    window.history.replaceState(
      {},
      '',
      `/workspace?mode=embed#${fragment}`
    );

    expect(initializeTuziSystemTokenFromUrl()).toBe('fragment-system-token');
    expect(getTuziSystemUserId()).toBe('40832');
    expect(getTuziProviderGroupSelection('40832')).toEqual(['vip']);
    expect(window.location.search).toBe('?mode=embed');
    expect(window.location.hash).toBe('#board');
    expect(window.location.href).not.toContain('fragment-system-token');
  });

  it('does not save an empty or overlong group', () => {
    expect(getTuziProviderGroupFromHref('?group=%20%20')).toBe('');
    expect(getTuziProviderGroupFromHref(`?group=${'x'.repeat(129)}`)).toBe('');
  });
});
