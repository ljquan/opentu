// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTuziBridgeCredentials,
  clearTuziSystemToken,
  clearTuziSystemUserId,
  getTuziSystemToken,
  getTuziSystemUserId,
  hasTuziSystemToken,
  saveTuziSystemToken,
  saveTuziSystemUserId,
  setTuziBridgeCredentials,
  importLocalTuziCredentials,
  isLocalTuziSession,
} from '../tuzi-token-auth';

describe('Tuzi system credentials', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    clearTuziBridgeCredentials();
    clearTuziSystemToken();
    clearTuziSystemUserId();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/?id=legacy&token=legacy-token');
  });

  it('persists standalone credentials without reading URL parameters', () => {
    expect(getTuziSystemToken()).toBe('');
    expect(getTuziSystemUserId()).toBe('');
    expect(saveTuziSystemToken('system-token')).toBe(true);
    expect(saveTuziSystemUserId('40832')).toBe(true);
    expect(getTuziSystemToken()).toBe('system-token');
    expect(getTuziSystemUserId()).toBe('40832');
    expect(hasTuziSystemToken()).toBe(true);
    expect(window.location.search).toContain('token=legacy-token');
  });

  it('uses bridge credentials in memory and does not write them to storage', () => {
    setTuziBridgeCredentials('40832', 'bridge-token');
    expect(getTuziSystemUserId()).toBe('40832');
    expect(getTuziSystemToken()).toBe('bridge-token');
    expect(
      window.localStorage.getItem('opentu.tuzi.systemToken.v1')
    ).toBeNull();
    expect(
      window.localStorage.getItem('opentu.tuzi.systemUserId.v1')
    ).toBeNull();
  });

  it('rejects invalid credentials', () => {
    expect(saveTuziSystemToken('   ')).toBe(false);
    expect(saveTuziSystemUserId('not-a-number')).toBe(false);
    expect(hasTuziSystemToken()).toBe(false);
  });

  it('imports local credentials while preserving board, hash and history state', () => {
    window.history.replaceState({ boardId: 'board-a' }, '', '/?board=board-a&id=40832&token=local-test-token#view');
    expect(importLocalTuziCredentials()).toBe(true);
    expect(getTuziSystemUserId()).toBe('40832');
    expect(getTuziSystemToken()).toBe('local-test-token');
    expect(isLocalTuziSession()).toBe(true);
    expect(window.location.search).toBe('?board=board-a');
    expect(window.location.hash).toBe('#view');
    expect(window.history.state).toEqual({ boardId: 'board-a' });
    expect(importLocalTuziCredentials()).toBe(true);
  });

  it('invalid URL credentials do not overwrite a saved account', () => {
    saveTuziSystemToken('saved-token');
    saveTuziSystemUserId('1');
    window.history.replaceState({}, '', '/?board=board-a&id=bad&token=local-test-token');
    expect(importLocalTuziCredentials()).toBe(false);
    expect(getTuziSystemToken()).toBe('saved-token');
    expect(getTuziSystemUserId()).toBe('1');
    expect(window.location.search).toBe('?board=board-a');
    expect(isLocalTuziSession()).toBe(false);
  });

  it('keeps URL credentials bound to this tab when another tab changes localStorage', () => {
    window.history.replaceState({}, '', '/?id=1&token=tab-one');
    expect(importLocalTuziCredentials()).toBe(true);
    localStorage.setItem('opentu.tuzi.systemUserId.v1', '2');
    localStorage.setItem('opentu.tuzi.systemToken.v1', 'tab-two');
    expect(getTuziSystemUserId()).toBe('1');
    expect(getTuziSystemToken()).toBe('tab-one');
    expect(isLocalTuziSession()).toBe(true);
    clearTuziSystemToken(); clearTuziSystemUserId();
    saveTuziSystemUserId('1'); saveTuziSystemToken('tab-one');
    expect(isLocalTuziSession()).toBe(false);
  });

  it('ignores URL credentials on public hosts and in iframes', () => {
    vi.stubGlobal('location', { hostname: 'opentu.ai', href: 'https://opentu.ai/?id=1&token=public-token' });
    expect(importLocalTuziCredentials()).toBe(false);
    expect(getTuziSystemToken()).toBe('');
    vi.unstubAllGlobals();
    vi.stubGlobal('parent', {});
    expect(importLocalTuziCredentials()).toBe(false);
    expect(isLocalTuziSession()).toBe(false);
  });

  it('updates the tab credential snapshot when local account settings are saved', () => {
    window.history.replaceState({}, '', '/?id=1&token=old-token');
    importLocalTuziCredentials();
    expect(saveTuziSystemToken('replacement-token')).toBe(true);
    expect(saveTuziSystemUserId('2')).toBe(true);
    expect(getTuziSystemToken()).toBe('replacement-token');
    expect(getTuziSystemUserId()).toBe('2');
    expect(isLocalTuziSession()).toBe(true);
  });
});
