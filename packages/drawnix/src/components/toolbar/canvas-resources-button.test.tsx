import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasResourcesButton } from './canvas-resources-button';
import { FeedbackButton } from '../feedback-button/feedback-button';

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
    localStorage.clear();
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
    return document.querySelector('[role="dialog"]');
  }

  async function click(selector: string) {
    await act(async () => (document.querySelector(selector) as HTMLButtonElement).click());
  }

  it('never opens automatically, including after remounting without an acknowledgement', async () => {
    await render();
    expect(panel()).toBeNull();
    expect(localStorage.length).toBe(0);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(panel()).toBeNull();
  });

  it('opens a confirmation and visits the official page only after confirmation', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render();
    await click('[data-testid="toolbar-resources"]');
    expect(panel()?.textContent).toContain('resources.downloadConfirmation');
    expect(panel()?.querySelector('a')).toBeNull();
    expect(open).not.toHaveBeenCalled();
    const confirm = Array.from(panel()?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'resources.confirmDownload'
    );
    await act(async () => confirm?.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://tuziapi.github.io/tuzi-switch/#td-r0-downloads',
      '_blank',
      'noopener,noreferrer'
    );
    expect(panel()).toBeNull();
  });

  it('cancels without navigation and can be reopened and dismissed with Escape', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render();
    await click('[data-testid="toolbar-resources"]');
    const cancel = Array.from(panel()?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'resources.cancel'
    );
    await act(async () => cancel?.click());
    expect(panel()).toBeNull();
    await click('[data-testid="toolbar-resources"]');
    expect(panel()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('remains usable when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await render();
    expect(panel()).toBeNull();
    await click('[data-testid="toolbar-resources"]');
    expect(panel()).not.toBeNull();
  });

  it('shows the X profile alongside the feedback QR code, without a download card', async () => {
    await act(async () => root.render(<FeedbackButton />));
    expect(document.querySelector('.feedback-qrcode-content')).toBeNull();
    await click('[data-testid="toolbar-feedback"]');
    const content = document.querySelector('.feedback-qrcode-content');
    if (!content) throw new Error('Feedback popover did not open');
    expect(content.querySelector('img')?.src).toBe('https://tuziai.oss-cn-shenzhen.aliyuncs.com/aitu/AiTu.png');
    const links = content.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://x.com/shuidiyuAI');
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener noreferrer');
    expect(links[0].textContent).toContain('resources.follow');
  });
});
