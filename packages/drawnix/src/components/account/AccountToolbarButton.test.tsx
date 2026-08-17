// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountToolbarButton,
  shouldShowOpenTuAccountControl,
} from './AccountToolbarButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));

describe('AccountToolbarButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows a compact initial and connected status', () => {
    act(() => {
      root.render(
        <AccountToolbarButton
          displayName="Lin"
          status="ready"
          selected
          onClick={vi.fn()}
        />
      );
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toContain('L');
    expect(button?.getAttribute('aria-label')).toBe('账户已连接');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('exposes the insufficient state and invokes the account action', () => {
    const onClick = vi.fn();
    act(() => {
      root.render(
        <AccountToolbarButton status="insufficient" onClick={onClick} />
      );
    });

    act(() => {
      container.querySelector('button')?.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      '余额不足'
    );
  });

  it('hides authenticated account controls for unavailable standalone mode', () => {
    expect(shouldShowOpenTuAccountControl('standalone', 'unavailable')).toBe(
      false
    );
    expect(shouldShowOpenTuAccountControl('embedded', 'loading')).toBe(true);
    expect(shouldShowOpenTuAccountControl('embedded', 'expired')).toBe(true);
  });
});
