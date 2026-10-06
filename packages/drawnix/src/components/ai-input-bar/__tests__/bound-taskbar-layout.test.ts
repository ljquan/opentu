import { describe, expect, it } from 'vitest';
import {
  clampBoundTaskbarPosition,
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

  it('keeps the taskbar inside the viewport for targets taller than the viewport', () => {
    expect(clampBoundTaskbarPosition(-1200, 8000, 260, 834)).toBe(12);
    expect(clampBoundTaskbarPosition(1200, 8000, 260, 834)).toBe(562);
    expect(clampBoundTaskbarPosition(-8000, -1200, 260, 834)).toBe(12);
  });

  it('uses the available space below or above a visible target', () => {
    expect(clampBoundTaskbarPosition(100, 300, 260, 834)).toBe(308);
    expect(clampBoundTaskbarPosition(600, 750, 260, 834)).toBe(332);
  });

  it('accounts for the visual viewport offset when the keyboard or zoom moves it', () => {
    expect(clampBoundTaskbarPosition(-1200, 8000, 260, 400, 12, 8, 200)).toBe(
      212
    );
    expect(clampBoundTaskbarPosition(1200, 8000, 260, 400, 12, 8, 200)).toBe(
      328
    );
  });
});
