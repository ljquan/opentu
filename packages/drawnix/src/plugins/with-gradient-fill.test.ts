import type { PlaitBoard, PlaitElement, PlaitOperation } from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FillConfig } from '../types/fill.types';

const mocks = vi.hoisted(() => ({
  parseFillValue: vi.fn(),
  disconnect: vi.fn(),
  host: null as SVGGElement | null,
}));

vi.mock('@plait/core', () => ({
  PlaitBoard: { getElementHost: (board: { testHost?: Element }) => board.testHost || mocks.host },
  PlaitElement: { getElementG: (element: PlaitElement) => document.getElementById(element.id) },
  getRectangleByElements: (_board: PlaitBoard, [element]: PlaitElement[]) => {
    const points = element.points || [[0, 0], [0, 0]];
    return { width: points[1][0] - points[0][0], height: points[1][1] - points[0][1] };
  },
}));
vi.mock('../utils/property', () => ({ isClosedElement: () => true }));
vi.mock('../utils/fill-renderer', () => ({
  parseFillValue: mocks.parseFillValue,
  createSVGDefs: () => document.createElementNS('http://www.w3.org/2000/svg', 'defs'),
}));

const ns = 'http://www.w3.org/2000/svg';
const gradient: FillConfig = {
  type: 'gradient',
  gradient: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] },
};
const image: FillConfig = { type: 'image', image: { imageUrl: '/test.png', mode: 'tile' } };
let observerCallback: MutationCallback;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal('SVGGElement', SVGElement);
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: MutationCallback) { observerCallback = callback; }
    observe() { /* Mutations are delivered explicitly below. */ }
    disconnect() { mocks.disconnect(); }
  });
  mocks.parseFillValue.mockReset().mockImplementation((config: FillConfig, id: string) => {
    if (config.type === 'solid') return { fillValue: config.solid?.color };
    const defElement = document.createElementNS(ns, config.type === 'image' ? 'pattern' : 'linearGradient');
    defElement.id = `fill-${id}`;
    return { fillValue: `url(#fill-${id})`, defElement };
  });
  mocks.disconnect.mockClear();
  const svg = document.createElementNS(ns, 'svg');
  mocks.host = document.createElementNS(ns, 'g');
  svg.appendChild(mocks.host);
  document.body.appendChild(svg);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function element(id: string, fillConfig?: FillConfig): PlaitElement {
  return { id, type: 'geometry', points: [[0, 0], [100, 80]], fill: '#fff', fillConfig };
}

function mount(element: PlaitElement) {
  const group = document.createElementNS(ns, 'g');
  group.id = element.id;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', '#fff');
  group.appendChild(path);
  mocks.host?.appendChild(group);
  return path;
}

async function scene(elements = [element('a', gradient), element('b', image)]) {
  const paths = elements.map(mount);
  const board = { children: elements, operations: [], afterChange: vi.fn(), testHost: mocks.host } as unknown as PlaitBoard;
  const { withGradientFill } = await import('./with-gradient-fill');
  withGradientFill(board);
  board.afterChange();
  mocks.parseFillValue.mockClear();
  return {
    board, paths,
    change: (operations: object[], children = board.children) => {
      board.children = children;
      board.operations = operations as PlaitOperation[];
      board.afterChange();
    },
  };
}

describe('gradient fill interaction regressions', () => {
  it('initializes both gradient and image fills synchronously', async () => {
    const h = await scene();
    expect(h.paths.map((path) => path.getAttribute('fill'))).toEqual(['url(#fill-a)', 'url(#fill-b)']);
    expect(document.querySelector('linearGradient#fill-a')).not.toBeNull();
    expect(document.querySelector('pattern#fill-b')).not.toBeNull();
  });

  it.each(['set_selection', 'set_viewport'])(
    'keeps existing fill definitions untouched on %s', async (type) => {
      const h = await scene();
      const def = document.getElementById('fill-a');
      h.change([{ type }]);
      expect(document.getElementById('fill-a')).toBe(def);
      expect(h.paths[0].getAttribute('fill')).toBe('url(#fill-a)');
      expect(mocks.parseFillValue).not.toHaveBeenCalled();
    }
  );

  it('updates a resized element without replacing another element’s fill', async () => {
    const h = await scene();
    const unchangedDef = document.getElementById('fill-b');
    const resized = { ...h.board.children[0], points: [[0, 0], [200, 160]] } as PlaitElement;
    h.change([{ type: 'set_node', path: [0] }], [resized, h.board.children[1]]);
    expect(mocks.parseFillValue).toHaveBeenCalledExactlyOnceWith(gradient, 'a', 200, 160);
    expect(document.getElementById('fill-b')).toBe(unchangedDef);
    expect(h.paths[0].getAttribute('fill')).toBe('url(#fill-a)');
  });

  it('restores fill changes in both directions for undo/redo', async () => {
    const h = await scene();
    for (const config of [image, gradient, image]) {
      h.change([{ type: 'set_node', path: [0] }], [{ ...h.board.children[0], fillConfig: config }, h.board.children[1]]);
      expect(h.paths[0].getAttribute('fill')).toBe('url(#fill-a)');
      expect(document.getElementById('fill-a')?.tagName).toBe(config.type === 'image' ? 'pattern' : 'linearGradient');
    }
  });

  it('repairs a fill reset by the renderer even after selection-only changes', async () => {
    const h = await scene();
    h.change([{ type: 'set_selection' }]);
    h.paths[0].setAttribute('fill', '#fff');
    observerCallback([{ type: 'attributes', attributeName: 'fill', target: h.paths[0] } as unknown as MutationRecord], {} as MutationObserver);
    expect(h.paths[0].getAttribute('fill')).toBe('url(#fill-a)');
  });

  it('repairs replacement SVG nodes after a renderer update', async () => {
    const h = await scene();
    const replacement = mount(h.board.children[0]);
    h.paths[0].parentElement?.remove();
    observerCallback([{ type: 'childList', addedNodes: [replacement.parentElement] } as unknown as MutationRecord], {} as MutationObserver);
    expect(replacement.getAttribute('fill')).toBe('url(#fill-a)');
  });

  it.each(['insert_node', 'remove_node', 'move_node', 'set_theme'])(
    'retains the complete repair fallback for %s', async (type) => {
      const h = await scene();
      h.paths.forEach((path) => path.setAttribute('fill', '#fff'));
      h.change([{ type }]);
      expect(h.paths.map((path) => path.getAttribute('fill'))).toEqual(['url(#fill-a)', 'url(#fill-b)']);
    }
  );

  it('uses the new snapshot for a reused element ID', async () => {
    const h = await scene();
    h.change([], [element('a', image)]);
    expect(document.getElementById('fill-a')?.tagName).toBe('pattern');
    h.paths[0].setAttribute('fill', '#fff');
    mocks.parseFillValue.mockClear();
    observerCallback([{ type: 'attributes', attributeName: 'fill', target: h.paths[0] } as unknown as MutationRecord], {} as MutationObserver);
    expect(mocks.parseFillValue).toHaveBeenCalledWith(image, 'a', 100, 80);
  });

  it('keeps renderer-repair observers scoped to their own boards', async () => {
    const first = await scene([element('first', gradient)]);
    const firstObserver = observerCallback;
    const svg = document.createElementNS(ns, 'svg');
    mocks.host = document.createElementNS(ns, 'g');
    svg.appendChild(mocks.host);
    document.body.appendChild(svg);
    const second = await scene([element('second', image)]);
    first.paths[0].setAttribute('fill', '#fff');
    second.paths[0].setAttribute('fill', '#fff');
    firstObserver([{ type: 'attributes', attributeName: 'fill', target: first.paths[0] } as unknown as MutationRecord], {} as MutationObserver);
    observerCallback([{ type: 'attributes', attributeName: 'fill', target: second.paths[0] } as unknown as MutationRecord], {} as MutationObserver);
    expect(first.paths[0].getAttribute('fill')).toBe('url(#fill-first)');
    expect(second.paths[0].getAttribute('fill')).toBe('url(#fill-second)');
  });

  it('repairs a remounted host and disconnects the previous observer', async () => {
    const h = await scene();
    mocks.host = document.createElementNS(ns, 'g');
    document.querySelector('svg')?.appendChild(mocks.host);
    Object.assign(h.board, { testHost: mocks.host });
    h.paths.forEach((path) => path.parentElement?.remove());
    const paths = h.board.children.map(mount);
    h.change([{ type: 'set_selection' }]);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(paths.map((path) => path.getAttribute('fill'))).toEqual(['url(#fill-a)', 'url(#fill-b)']);
  });

  it('indexes a large plain-color board without quadratic ID scans', async () => {
    let reads = 0;
    const elements = Array.from({ length: 1000 }, (_, index) => ({
      ...element(`item-${index}`),
      get id() { reads++; return `item-${index}`; },
    }));
    const h = await scene(elements);
    reads = 0;
    h.change([]);
    expect(reads).toBeLessThanOrEqual(elements.length * 3);
    expect(h.paths.every((path) => path.getAttribute('fill') === '#fff')).toBe(true);
  });
});
