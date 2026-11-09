import {
  createBoard,
  createTestingBoard,
  fakeNodeWeakMap,
  IS_BOARD_ALIVE,
  RectangleClient,
  Transforms,
  withHistory,
} from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inspectSvgSource,
  parseSvgDocument,
  type SvgSource,
} from '../../utils/svg-source';
import {
  insertEditableSvgParts,
  prepareSvgVectorParts,
  updateSvgVectorPart,
  type PreparedSvgPart,
  type SvgImageElement,
} from '../svg-canvas-edit';

const mocks = vi.hoisted(() => ({ cache: vi.fn(), read: vi.fn() }));
vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob: mocks.cache,
    getCachedBlob: mocks.read,
  },
}));
const wrap = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const source = inspectSvgSource(
  wrap(
    '<rect x="10" y="10" width="20" height="20" fill="red"/><circle cx="60" cy="60" r="10" fill="blue"/>'
  )
);

function part(id: string, x: number, fill = 'red'): PreparedSvgPart {
  return {
    markup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} 10 20 20"><rect data-svg-part="${id}" x="${x}" y="10" width="20" height="20" fill="${fill}"/></svg>`,
    bounds: { x, y: 10, width: 20, height: 20 },
    partId: id,
    label: id,
    fill,
    stroke: 'none',
  };
}
function scene() {
  const image: SvgImageElement = {
    id: 'original',
    type: 'image',
    url: '/__aitu_cache__/image/original.svg',
    points: [
      [100, 200],
      [500, 600],
    ],
  };
  const board = createTestingBoard([withHistory], [image]);
  IS_BOARD_ALIVE.set(board, true);
  fakeNodeWeakMap(board);
  board.getRectangle = (element) =>
    RectangleClient.getRectangleByPoints(element.points || []);
  return { board, image };
}
function geometryDocument(markup: string): Document {
  document.body.innerHTML = markup;
  const root = document.querySelector('svg') as SVGSVGElement;
  const identity = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
    inverse() {
      return this;
    },
    multiply(other: unknown) {
      return other;
    },
  };
  for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const numbers = (node.getAttribute('data-bounds') || '0 0 10 10')
      .split(' ')
      .map(Number);
    Object.assign(node, {
      getBBox: () => ({
        x: numbers[0],
        y: numbers[1],
        width: numbers[2],
        height: numbers[3],
      }),
      getCTM: () => ({
        ...identity,
        e: Number(node.getAttribute('data-tx') || 0),
      }),
    });
  }
  return document;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cache.mockResolvedValue('cached');
  mocks.read.mockResolvedValue(new Blob(['stored']));
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('source-preserving SVG decomposition', () => {
  it('keeps shapes vector-based, preserves paint and source ordering, and maps transforms using native geometry', () => {
    const markup = wrap(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><g transform="translate(20 0)"><path id="moon" data-bounds="0 0 20 30" data-tx="20" fill="url(#g)" d="M0 0L20 30Z"/></g><text id="title" data-bounds="0 40 50 10" fill="blue">Garden</text>'
    );
    const result = prepareSvgVectorParts(
      geometryDocument(markup),
      inspectSvgSource(markup)
    );
    expect(result).toHaveLength(2);
    expect(result[0].bounds).toEqual({ x: 20, y: 0, width: 20, height: 30 });
    expect(result[0].markup).toContain('linearGradient');
    expect(result[0].markup).toContain('url(#g)');
    expect(result[0].markup).not.toContain('Garden');
    expect(result[0].fill).toBeUndefined();
    expect(result[1].text).toBe('Garden');
    expect(result[1].markup).not.toContain('id="moon"');
  });
  it('keeps composite opacity/filter groups together and retains filter bounds', () => {
    const markup = wrap(
      '<defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs><g id="moon" filter="url(#glow)" data-bounds="10 20 20 30"><circle r="10"/><circle r="5"/></g>'
    );
    const parts = prepareSvgVectorParts(
      geometryDocument(markup),
      inspectSvgSource(markup)
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].bounds).toEqual({ x: 8, y: 17, width: 24, height: 36 });
    expect(parts[0].markup.match(/<circle/g)).toHaveLength(2);
  });
  it('retains referenced siblings under defs instead of deleting content used by use', () => {
    const markup = wrap(
      '<path id="petal" d="M0 0L10 10Z"/><use id="flower" href="#petal"/>'
    );
    const parts = prepareSvgVectorParts(
      geometryDocument(markup),
      inspectSvgSource(markup)
    );
    expect(parts[1].markup).toContain('href="#petal"');
    expect(
      parseSvgDocument(parts[1].markup).querySelector('defs #petal')
    ).toBeTruthy();
  });
  it('rejects missing references, unsupported filter coordinates and animated conversion', () => {
    for (const body of [
      '<use href="#missing"/>',
      '<defs><filter id="f" filterUnits="userSpaceOnUse"/></defs><circle filter="url(#f)"/>',
    ]) {
      const markup = wrap(body);
      expect(() =>
        prepareSvgVectorParts(
          geometryDocument(markup),
          inspectSvgSource(markup)
        )
      ).toThrow();
    }
    const animated = inspectSvgSource(
      wrap(
        '<circle><animate attributeName="r" values="1;2" dur="1s"/></circle>'
      )
    );
    expect(() => prepareSvgVectorParts(document, animated)).toThrow('动画');
  });
  it('retains the initial viewport crop but allows edited text to grow past old bounds', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><text data-bounds="0 0 60 10">A longer label</text></svg>';
    const source = inspectSvgSource(markup);
    const doc = geometryDocument(markup);
    expect(prepareSvgVectorParts(doc, source)[0].bounds.width).toBe(20);
    expect(prepareSvgVectorParts(doc, source, false)[0].bounds.width).toBe(60);
  });
  it('rejects viewport-dependent or unpreservable composites rather than dropping their appearance', () => {
    for (const markup of [
      wrap('<rect width="50%" height="10"/>'),
      wrap('<style>rect {width:20px}</style><rect height="10"/>'),
      wrap('<svg viewBox="0 0 10 10"><circle r="2"/></svg>'),
      wrap('<circle r="2"/>').replace(
        'viewBox=',
        'style="opacity:.5" viewBox='
      ),
    ])
      expect(() =>
        prepareSvgVectorParts(
          geometryDocument(markup),
          inspectSvgSource(markup)
        )
      ).toThrow('原图已保留');
  });
});

describe('SVG parts on the real board data model', () => {
  it('creates independent nodes without changing the original, supports one-step undo/redo and serialization', async () => {
    const { board, image } = scene();
    await insertEditableSvgParts(
      board,
      image,
      source,
      [part('a', 10), part('b', 50, 'blue')],
      () => true
    );
    expect(board.children[0]).toEqual(image);
    expect(board.children).toHaveLength(3);
    const nodes = structuredClone(board.children);
    expect(nodes[1].points).toEqual([
      [660, 240],
      [740, 320],
    ]);
    expect(nodes[2].points).toEqual([
      [820, 240],
      [900, 320],
    ]);
    expect(nodes[1].svgVectorPart).toMatchObject({
      sourceUrl: image.url,
      sourceElementId: image.id,
      partId: 'a',
    });
    expect(nodes[1].generationTaskId).toBeUndefined();
    expect(board.history.undos).toHaveLength(1);
    board.undo();
    expect(board.children).toEqual([image]);
    board.redo();
    expect(board.children).toEqual(nodes);
    const restored = createBoard(JSON.parse(JSON.stringify(nodes)));
    expect(restored.children[1].svgVectorPart).toEqual(nodes[1].svgVectorPart);
    Transforms.setNode(
      restored,
      {
        points: [
          [800, 100],
          [900, 200],
        ],
      },
      [1]
    );
    expect(restored.children[0]).toEqual(image);
    expect(restored.children[2]).toEqual(nodes[2]);
  });
  it('does not leave half a conversion on cache failure or a board switch', async () => {
    const { board, image } = scene();
    mocks.cache
      .mockResolvedValueOnce('ok')
      .mockRejectedValueOnce(new Error('storage failed'));
    await expect(
      insertEditableSvgParts(
        board,
        image,
        source,
        [part('a', 10), part('b', 50)],
        () => true
      )
    ).rejects.toThrow('storage failed');
    expect(board.children).toEqual([image]);
    expect(board.history.undos).toHaveLength(0);
    let current = true;
    mocks.cache.mockImplementation(async () => {
      current = false;
    });
    await expect(
      insertEditableSvgParts(
        board,
        image,
        source,
        [part('a', 10)],
        () => current
      )
    ).rejects.toThrow('画布');
    expect(board.children).toEqual([image]);
  });
  it('honors source letterboxing when the viewport and viewBox have different ratios', async () => {
    const { board, image } = scene();
    image.points = [
      [100, 200],
      [500, 400],
    ];
    await insertEditableSvgParts(
      board,
      image,
      source,
      [part('a', 10)],
      () => true
    );
    expect(board.children[1].points).toEqual([
      [740, 220],
      [780, 260],
    ]);
  });
  it('rolls back an insertion error and restores existing undo/redo history', async () => {
    const { board, image } = scene();
    const originalInsert = Transforms.insertNode;
    let inserted = 0;
    vi.spyOn(Transforms, 'insertNode').mockImplementation((...args) => {
      if (++inserted === 2) throw new Error('insert failed');
      return originalInsert(...args);
    });
    await expect(
      insertEditableSvgParts(
        board,
        image,
        source,
        [part('a', 10), part('b', 50)],
        () => true
      )
    ).rejects.toThrow('insert failed');
    expect(board.children).toEqual([image]);
    expect(board.history.undos).toHaveLength(0);
    expect(board.history.redos).toHaveLength(0);
  });
  it('updates existing vector paint and text, refits changed text bounds, and leaves old bytes available for undo', async () => {
    const { board, image } = scene();
    const item = part('label', 0);
    item.markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><text data-svg-part="label" fill="red">Old</text></svg>';
    item.bounds = { x: 0, y: 0, width: 20, height: 10 };
    item.text = 'Old';
    await insertEditableSvgParts(board, image, source, [item], () => true);
    const node = board.children[1] as SvgImageElement;
    const old = structuredClone(node);
    const measure = vi.fn(async (updated: SvgSource) => {
      const doc = parseSvgDocument(updated.markup);
      (doc.querySelector('text') as Element).setAttribute(
        'data-svg-part',
        'updated'
      );
      doc.documentElement.setAttribute('viewBox', '0 0 40 10');
      return [
        {
          ...item,
          markup: new XMLSerializer().serializeToString(doc.documentElement),
          partId: 'updated',
          bounds: { x: 0, y: 0, width: 40, height: 10 },
        },
      ];
    });
    await updateSvgVectorPart(
      board,
      node,
      inspectSvgSource(item.markup),
      { fill: '#00ff00', text: '<script>literal</script>' },
      () => true,
      measure
    );
    expect(measure.mock.calls[0][0].markup).toContain(
      '&lt;script&gt;literal&lt;/script&gt;'
    );
    expect(board.children[1].svgVectorPart).toMatchObject({
      partId: 'updated',
      fill: '#00ff00',
      text: '<script>literal</script>',
    });
    const updatedNode = board.children[1] as SvgImageElement;
    expect(updatedNode.points[1][0] - updatedNode.points[0][0]).toBe(160);
    expect(board.children[0]).toEqual(image);
    board.undo();
    expect(board.children[1]).toEqual(old);
  });
  it('rejects invalid colors or unknown fields without modifying the element', async () => {
    const { board, image } = scene();
    await insertEditableSvgParts(
      board,
      image,
      source,
      [part('a', 0)],
      () => true
    );
    const node = board.children[1] as SvgImageElement;
    await expect(
      updateSvgVectorPart(
        board,
        node,
        inspectSvgSource(part('a', 0).markup),
        { fill: 'url(https://example.com)' },
        () => true
      )
    ).rejects.toThrow('颜色');
    expect(board.children[1]).toBe(node);
  });
});
