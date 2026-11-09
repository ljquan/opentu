import {
  createTestingBoard,
  fakeNodeWeakMap,
  getHitElementByPoint,
  NODE_TO_CONTAINER_G,
  NODE_TO_G,
  withOptions,
  type PlaitBoard,
  type PlaitElement,
} from '@plait/core';
import { withDraw } from '@plait/draw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCanvasImage } from '../services/canvas-image-readiness';
import { withSvgVectorHit } from './with-svg-vector-hit';
import { withImage3DTransform } from './with-image-3d-transform';
import { withLockedElement } from './with-locked-element';

type Paint = (x: number, y: number) => boolean;
const paint = new WeakMap<HTMLImageElement, Paint>();
const draw = vi.fn();
const read = vi.fn();

function mount(board: PlaitBoard, element: PlaitElement, fill: Paint, width = 100, height = 100) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const image = document.createElement('img');
  image.className = 'image-origin';
  image.src = `blob:${element.id}`;
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  paint.set(image, fill);
  group.appendChild(image);
  NODE_TO_G.set(element, group);
  NODE_TO_CONTAINER_G.set(element, group);
  const render = registerCanvasImage(board, element.id, element.url);
  render.setReady(true);
  return { image, render };
}

function scene(fill: Paint = (x, y) => x > .25 && x < .75 && y > .25 && y < .75) {
  const back: PlaitElement = { id: 'back', type: 'image', url: 'back.png', points: [[0, 0], [100, 100]] };
  const front: PlaitElement = {
    id: 'part', type: 'image', url: '/__aitu_cache__/image/part.svg', points: [[0, 0], [100, 100]],
    svgVectorPart: { version: 1, partId: 'shape' },
  };
  const board = createTestingBoard([withOptions, withDraw, withSvgVectorHit], [back, front]);
  fakeNodeWeakMap(board);
  board.viewport = { ...board.viewport, zoom: 1 };
  mount(board, back, () => true);
  return { board, front, back, ...mount(board, front, fill) };
}

beforeEach(() => {
  draw.mockReset();
  read.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let source: HTMLImageElement;
    return {
      drawImage(image: HTMLImageElement, ...args: number[]) { source = image; draw(image, ...args); },
      getImageData(_x: number, _y: number, width: number, height: number) {
        read();
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            data[(y * width + x) * 4 + 3] = paint.get(source)?.((x + .5) / width, (y + .5) / height) ? 255 : 0;
          }
        }
        return { data, width, height };
      },
    } as unknown as CanvasRenderingContext2D;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('editable SVG point selection', () => {
  it.each([
    ['circle', (x: number, y: number) => (x - .5) ** 2 + (y - .5) ** 2 < .16],
    ['triangle', (x: number, y: number) => y > Math.abs(x - .5) * 2],
    ['sparse stars', (x: number, y: number) => Math.abs(x - y) < .015],
  ])('selects painted %s pixels and clicks through transparent corners', (_name, fill) => {
    const { board, front, back } = scene(fill as Paint);
    expect(getHitElementByPoint(board, [50, 50])).toBe(front);
    expect(getHitElementByPoint(board, [95, 5])).toBe(back);
  });

  it('clicks through holes and fully transparent parts, without changing box selection', () => {
    const { board, front, back, image } = scene((x, y) => {
      const radius = (x - .5) ** 2 + (y - .5) ** 2;
      return radius > .04 && radius < .16;
    });
    expect(getHitElementByPoint(board, [50, 50])).toBe(back);
    expect(getHitElementByPoint(board, [80, 50])).toBe(front);
    expect(board.isRectangleHit(front, { anchor: [-5, -5], focus: [105, 105] })).toBe(true);
    image.src = 'blob:empty';
    paint.set(image, () => false);
    expect(getHitElementByPoint(board, [80, 50])).toBe(back);
  });

  it.each([.25, 1, 4])('maps moved/scaled parts at zoom %s without rebuilding their pixels', (zoom) => {
    const { board, front } = scene();
    expect(board.isHit(front, [50, 50])).toBe(true);
    board.viewport.zoom = zoom;
    front.points = [[200, 300], [600, 700]];
    expect(board.isHit(front, [400, 500])).toBe(true);
    expect(board.isHit(front, [220, 320])).toBe(false);
    expect(draw).toHaveBeenCalledOnce();
  });

  it('undoes the element rotation before sampling the visible pixels', () => {
    const { board, front } = scene((x, y) => x < .25 && y < .25);
    front.points = [[100, 200], [200, 300]];
    front.angle = Math.PI / 2;
    expect(board.isHit(front, [190, 210])).toBe(true);
    expect(board.isHit(front, [110, 210])).toBe(false);
    expect(board.isHit(front, [250, 250])).toBe(false);
  });

  it('keeps a two-screen-pixel allowance for thin strokes as zoom changes', () => {
    const { board, front } = scene((x) => x >= .5 && x < .51);
    expect(board.isHit(front, [52, 50])).toBe(true);
    expect(board.isHit(front, [54, 50])).toBe(false);
    board.viewport.zoom = 2;
    expect(board.isHit(front, [52, 50])).toBe(false);
    board.viewport.zoom = .5;
    expect(board.isHit(front, [54, 50])).toBe(true);
  });

  it('excludes contain letterboxing and maps the image content inside a frame', () => {
    const { board, front } = scene();
    const { image } = mount(board, front, () => true, 200, 100);
    image.style.objectFit = 'contain';
    expect(board.isHit(front, [50, 10])).toBe(false);
    expect(board.isHit(front, [50, 50])).toBe(true);
    expect(board.isHit(front, [50, 90])).toBe(false);
  });

  it('uses natural displayed image height when a node box has a different ratio', () => {
    const { board, front } = scene(() => true);
    front.points = [[0, 0], [100, 200]];
    expect(board.isHit(front, [50, 50])).toBe(true);
    expect(board.isHit(front, [50, 150])).toBe(false);
  });

  it('invalidates cached paint after editing, replacing or undoing the source', () => {
    const { board, front, image, render } = scene();
    expect(board.isHit(front, [10, 10])).toBe(false);
    front.url = '/__aitu_cache__/image/edited.svg';
    // The old decoded image cannot describe the new source before it is ready.
    expect(board.isHit(front, [10, 10])).toBe(true);
    expect(draw).toHaveBeenCalledOnce();
    render.dispose();
    const next = registerCanvasImage(board, front.id, front.url);
    image.src = 'blob:edited';
    paint.set(image, () => true);
    next.setReady(true);
    expect(board.isHit(front, [10, 10])).toBe(true);
    expect(draw).toHaveBeenCalledTimes(2);
    image.src = 'blob:undo';
    paint.set(image, () => false);
    expect(board.isHit(front, [10, 10])).toBe(false);
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it('retains rectangle selection until loading completes and after disposal', () => {
    const { board, front, image, render } = scene(() => false);
    render.setReady(false);
    expect(board.isHit(front, [50, 50])).toBe(true);
    expect(draw).not.toHaveBeenCalled();
    render.setReady(true);
    Object.defineProperty(image, 'complete', { value: false, configurable: true });
    expect(board.isHit(front, [50, 50])).toBe(true);
    Object.defineProperty(image, 'complete', { value: true, configurable: true });
    expect(board.isHit(front, [50, 50])).toBe(false);
    render.dispose();
    expect(board.isHit(front, [50, 50])).toBe(true);
  });

  it('falls back on pixel-read failure once per source and retries a replacement', () => {
    const { board, front, image } = scene(() => false);
    read.mockImplementationOnce(() => { throw new DOMException('tainted', 'SecurityError'); });
    expect(board.isHit(front, [50, 50])).toBe(true);
    expect(board.isHit(front, [50, 50])).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    image.src = 'blob:replacement';
    expect(board.isHit(front, [50, 50])).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps unmounted and ordinary images on their existing selection rules', () => {
    const { board, front, back } = scene(() => false);
    expect(board.isHit(back, [50, 50])).toBe(true);
    expect(draw).not.toHaveBeenCalled();
    NODE_TO_G.delete(front);
    expect(board.isHit(front, [50, 50])).toBe(true);
    delete front.svgVectorPart;
    expect(board.isHit(front, [50, 50], false)).toBe(true);
    expect(draw).not.toHaveBeenCalled();
  });

  it('bounds sampling size and does not repeat canvas work on pointer movement', () => {
    const { board, front } = scene();
    const { image } = mount(board, front, () => true, 4096, 2048);
    front.points = [[0, 0], [100, 50]];
    for (let x = 10; x < 50; x++) expect(board.isHit(front, [x, 25])).toBe(true);
    expect(draw).toHaveBeenCalledExactlyOnceWith(image, 0, 0, 512, 256);
    expect(read).toHaveBeenCalledOnce();
  });

  it('preserves the outer 3D and locked-element hit rules', () => {
    const { board, front } = scene(() => false);
    withImage3DTransform(board);
    withLockedElement(board);
    front.transform3d = { rotateX: 0, rotateY: 45, perspective: 800 };
    expect(board.isHit(front, [50, 50])).toBe(true);
    expect(draw).not.toHaveBeenCalled();
    front.locked = true;
    expect(board.isHit(front, [50, 50])).toBe(false);
    expect(draw).not.toHaveBeenCalled();
  });
});
