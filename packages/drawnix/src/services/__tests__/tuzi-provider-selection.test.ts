// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTuziProviderGroupSelection,
  getTuziActiveProviderGroup,
  resolveTuziActiveProviderGroup,
  saveTuziActiveProviderGroup,
  saveTuziProviderGroupSelection,
  TUZI_ACTIVE_PROVIDER_GROUP_EVENT,
} from '../tuzi-provider-selection';

describe('tuzi-provider-selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('remembers the active group independently for each account', () => {
    saveTuziActiveProviderGroup('1', 'default');
    saveTuziActiveProviderGroup('2', 'vip');

    expect(getTuziActiveProviderGroup('1')).toBe('default');
    expect(getTuziActiveProviderGroup('2')).toBe('vip');
  });

  it('does not persist a group without an account id', () => {
    saveTuziActiveProviderGroup('', 'vip');
    saveTuziProviderGroupSelection('  ', ['vip']);

    expect(window.localStorage.length).toBe(0);
    expect(getTuziActiveProviderGroup('')).toBeNull();
  });

  it('falls back to default and then the first connected group', () => {
    saveTuziActiveProviderGroup('1', 'removed');

    expect(resolveTuziActiveProviderGroup('1', ['vip', 'default'])).toBe(
      'default'
    );
    expect(resolveTuziActiveProviderGroup('1', ['vip', 'business'])).toBe(
      'vip'
    );
  });

  it('notifies the runtime when the active group changes', () => {
    const listener = vi.fn();
    window.addEventListener(TUZI_ACTIVE_PROVIDER_GROUP_EVENT, listener);

    saveTuziActiveProviderGroup('1', 'vip');

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(TUZI_ACTIVE_PROVIDER_GROUP_EVENT, listener);
  });

  it('clears the active group when account group configuration is reset', () => {
    saveTuziProviderGroupSelection('1', ['default', 'vip']);
    saveTuziActiveProviderGroup('1', 'vip');

    clearTuziProviderGroupSelection('1');

    expect(getTuziActiveProviderGroup('1')).toBeNull();
  });
});
