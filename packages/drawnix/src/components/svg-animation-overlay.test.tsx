import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard } from '@plait/core';
import { SvgAnimationOverlay } from './svg-animation-overlay';
import { inspectSvgSource } from '../utils/svg-source';
import { getSvgPlaybackState } from '../services/svg-playback-state';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  setTime: vi.fn(),
}));
vi.mock('../services/svg-canvas-source', () => ({
  readSvgCanvasSource: mocks.read,
}));
const markup =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle><animate attributeName="r" values="1;2" dur="1s"/></circle></svg>';
const original = ['pauseAnimations', 'unpauseAnimations', 'setCurrentTime'].map(
  (key) =>
    [
      key,
      Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, key),
    ] as const
);
function frameDocument() {
  const doc = document.implementation.createHTMLDocument();
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  doc.body.appendChild(root);
  return doc;
}
let nativeDocument: Document;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(inspectSvgSource(markup));
  for (const [name, fn] of [
    ['pauseAnimations', mocks.pause],
    ['unpauseAnimations', mocks.play],
    ['setCurrentTime', mocks.setTime],
  ] as const)
    Object.defineProperty(SVGSVGElement.prototype, name, {
      configurable: true,
      value: fn,
    });
  // jsdom does not load srcdoc; supply its document before the initial frame load.
  nativeDocument = frameDocument();
  vi.spyOn(
    HTMLIFrameElement.prototype,
    'contentDocument',
    'get'
  ).mockReturnValue(nativeDocument);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [key, descriptor] of original) {
    if (descriptor)
      Object.defineProperty(SVGSVGElement.prototype, key, descriptor);
    else
      delete (SVGSVGElement.prototype as unknown as Record<string, unknown>)[
        key
      ];
  }
});

describe('native SVG animation overlay', () => {
  it('uses a script-free frame, pauses the existing timeline and resumes it without replacing source content', async () => {
    const board = createBoard([]),
      visible = vi.fn();
    const props = {
      board,
      elementId: 'svg',
      url: '/a.svg',
      onVisibleChange: visible,
    };
    const { rerender, unmount } = render(
      <SvgAnimationOverlay {...props} playback="paused" />
    );
    const frame = await screen.findByTitle('SVG 自带动画');
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
    fireEvent.load(frame);
    await waitFor(() => expect(visible).toHaveBeenCalledWith(true));
    expect(mocks.pause).toHaveBeenCalled();
    expect(mocks.setTime).toHaveBeenCalledWith(0);
    expect(getSvgPlaybackState(board, 'svg', '/a.svg')?.status).toBe('ready');
    const sourceBefore = frame.getAttribute('srcdoc');
    rerender(<SvgAnimationOverlay {...props} playback="playing" />);
    await waitFor(() => expect(mocks.play).toHaveBeenCalled());
    expect(frame.getAttribute('srcdoc')).toBe(sourceBefore);
    unmount();
    expect(getSvgPlaybackState(board, 'svg', '/a.svg')).toBeUndefined();
    expect(visible).toHaveBeenLastCalledWith(false);
  });
  it('respects reduced motion and background visibility without manufacturing an animation', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const board = createBoard([]);
    render(
      <SvgAnimationOverlay
        board={board}
        elementId="svg"
        url="/a.svg"
        onVisibleChange={vi.fn()}
      />
    );
    const frame = await screen.findByTitle('SVG 自带动画');
    fireEvent.load(frame);
    await waitFor(() => expect(mocks.pause).toHaveBeenCalled());
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(mocks.pause.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('leaves static SVGs on the original image renderer', async () => {
    mocks.read.mockResolvedValue(
      inspectSvgSource(
        markup.replace('<animate attributeName="r" values="1;2" dur="1s"/>', '')
      )
    );
    const visible = vi.fn();
    render(
      <SvgAnimationOverlay
        board={createBoard([])}
        elementId="svg"
        url="/a.svg"
        onVisibleChange={visible}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTitle('SVG 自带动画')).toBeNull();
    expect(visible).not.toHaveBeenCalledWith(true);
  });
  it('keeps the original visible and reports failure when native CSS animation did not load', async () => {
    mocks.read.mockResolvedValue(
      inspectSvgSource(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@keyframes pulse{from{opacity:0}to{opacity:1}}circle{animation:pulse 1s infinite}</style><circle r="2"/></svg>'
      )
    );
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(nativeDocument, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    const board = createBoard([]),
      visible = vi.fn();
    render(
      <SvgAnimationOverlay
        board={board}
        elementId="svg"
        url="/a.svg"
        onVisibleChange={visible}
      />
    );
    await waitFor(() =>
      expect(getSvgPlaybackState(board, 'svg', '/a.svg')?.status).toBe('error')
    );
    expect(screen.queryByTitle('SVG 自带动画')).toBeNull();
    expect(visible).not.toHaveBeenCalledWith(true);
    delete (document as Partial<Document>).getAnimations;
  });
  it('resumes after a document that was initially hidden becomes visible', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    render(
      <SvgAnimationOverlay
        board={createBoard([])}
        elementId="svg"
        url="/a.svg"
        onVisibleChange={vi.fn()}
      />
    );
    await waitFor(() => expect(mocks.pause).toHaveBeenCalled());
    mocks.play.mockClear();
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(mocks.play).toHaveBeenCalled();
  });
  it('discards a stale animated source when the URL changes to a static file', async () => {
    let finish!: (source: ReturnType<typeof inspectSvgSource>) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const board = createBoard([]),
      visible = vi.fn();
    const { rerender } = render(
      <SvgAnimationOverlay
        board={board}
        elementId="svg"
        url="/old.svg"
        onVisibleChange={visible}
      />
    );
    mocks.read.mockResolvedValue(
      inspectSvgSource(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="2"/></svg>'
      )
    );
    rerender(
      <SvgAnimationOverlay
        board={board}
        elementId="svg"
        url="/static.svg"
        onVisibleChange={visible}
      />
    );
    await act(async () => {
      finish(inspectSvgSource(markup));
    });
    expect(screen.queryByTitle('SVG 自带动画')).toBeNull();
    expect(visible).not.toHaveBeenCalledWith(true);
    expect(getSvgPlaybackState(board, 'svg', '/old.svg')).toBeUndefined();
  });
  it('pauses offscreen content and releases the visibility observer on unmount', async () => {
    let observeVisibility!: (entries: { isIntersecting: boolean }[]) => void;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof observeVisibility) {
          observeVisibility = callback;
        }
        observe() {
          /* visibility is explicitly driven by the test */
        }
        disconnect = disconnect;
      }
    );
    const { unmount } = render(
      <SvgAnimationOverlay
        board={createBoard([])}
        elementId="svg"
        url="/a.svg"
        onVisibleChange={vi.fn()}
      />
    );
    await waitFor(() => expect(mocks.play).toHaveBeenCalled());
    act(() => observeVisibility([{ isIntersecting: false }]));
    expect(mocks.pause).toHaveBeenCalled();
    mocks.play.mockClear();
    act(() => observeVisibility([{ isIntersecting: true }]));
    expect(mocks.play).toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
