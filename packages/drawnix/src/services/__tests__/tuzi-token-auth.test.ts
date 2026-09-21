// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
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
} from '../tuzi-token-auth';

describe('Tuzi system credentials', () => {
  beforeEach(() => {
    clearTuziBridgeCredentials();
    clearTuziSystemToken();
    clearTuziSystemUserId();
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
});
