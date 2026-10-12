import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasResourcesButton, CANVAS_RESOURCES_ACK_KEY } from './canvas-resources-button';

vi.mock('@plait-board/react-board', () => ({ useBoard: () => ({}) }));
vi.mock('@plait/core', () => ({
  PlaitBoard: { getBoardContainer: () => document.body },
}));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('lucide-react', () => ({
  ArrowUpRight: () => null,
  Download: () => null,
  ExternalLink: () => null,
  X: () => null,
}));
vi.mock('../tool-button', () => ({
  ToolButton: React.forwardRef<HTMLButtonElement, {
    onClick: () => void;
    'data-testid': string;
    'aria-label': string;
  }>((props, ref) => (
    <button ref={ref} data-testid={props['data-testid']} aria-label={props['aria-label']} onClick={props.onClick} />
  )),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('CanvasResourcesButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem(CANVAS_RESOURCES_ACK_KEY);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render() {
    await act(async () => root.render(<CanvasResourcesButton />));
  }

  function panel() {
    return document.querySelector('[data-testid="canvas-resources"]');
  }

  async function click(selector: string) {
    await act(async () => (document.querySelector(selector) as HTMLButtonElement).click());
  }

  it('announces once, acknowledges explicit close, and supports reopening', async () => {
    await render();
    expect(panel()).not.toBeNull();
    expect(localStorage.getItem(CANVAS_RESOURCES_ACK_KEY)).toBe('true');
    await click('[aria-label="resources.close"]');
    expect(panel()).toBeNull();
    expect(localStorage.getItem(CANVAS_RESOURCES_ACK_KEY)).toBe('true');

    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(panel()).toBeNull();
    await click('[data-testid="toolbar-resources"]');
    expect(panel()).not.toBeNull();
  });

  it('keeps the first automatic announcement open on outside click and Escape', async () => {
    await render();
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel()).not.toBeNull();
    expect(localStorage.getItem(CANVAS_RESOURCES_ACK_KEY)).toBe('true');
  });

  it('opens the approved URLs in isolated new tabs', async () => {
    await render();
    const links = panel()!.querySelectorAll('a');
    expect(Array.from(links, (link) => link.href)).toEqual([
      'https://aiw520.github.io/opentuAI/download.html',
      'https://x.com/shuidiyuAI',
    ]);
    links.forEach((link) => {
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    });
  });

  it('does not announce an acknowledged release and dismisses reopened panels', async () => {
    localStorage.setItem(CANVAS_RESOURCES_ACK_KEY, 'true');
    await render();
    expect(panel()).toBeNull();
    await click('[data-testid="toolbar-resources"]');
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(panel()).toBeNull();
  });

  it('does not announce again after a reload even if the first panel was not closed', async () => {
    await render();
    expect(panel()).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(panel()).toBeNull();
  });

  it('remains usable when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await render();
    expect(panel()).not.toBeNull();
    await click('[aria-label="resources.close"]');
    expect(panel()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(panel()).toBeNull();
  });

});
