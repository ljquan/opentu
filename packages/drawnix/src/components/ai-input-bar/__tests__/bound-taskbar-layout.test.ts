import { describe, expect, it } from 'vitest';
import { getBoundTaskbarWidth } from '../bound-taskbar-layout';

describe('getBoundTaskbarWidth', () => {
  it('uses the taskbar current width for positioning', () => {
    expect(getBoundTaskbarWidth(688, 1440)).toBe(688);
  });

  it('falls back to the original desktop responsive width', () => {
    expect(getBoundTaskbarWidth(undefined, 1440)).toBe(720);
    expect(getBoundTaskbarWidth(undefined, 700)).toBe(604);
  });

  it('does not return a negative width', () => {
    expect(getBoundTaskbarWidth(undefined, 80)).toBe(0);
  });
});
