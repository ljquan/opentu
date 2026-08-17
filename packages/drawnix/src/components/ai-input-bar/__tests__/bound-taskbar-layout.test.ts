import { describe, expect, it } from 'vitest';
import {
  getBoundTaskbarHeight,
  getBoundTaskbarWidth,
} from '../bound-taskbar-layout';

describe('bound-taskbar-layout', () => {
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

  it('uses the current taskbar height for vertical positioning', () => {
    expect(getBoundTaskbarHeight(246, true)).toBe(246);
    expect(getBoundTaskbarHeight(58, false)).toBe(58);
  });

  it('falls back to safe expanded and collapsed heights', () => {
    expect(getBoundTaskbarHeight(undefined, true)).toBe(260);
    expect(getBoundTaskbarHeight(0, false)).toBe(76);
  });
});
