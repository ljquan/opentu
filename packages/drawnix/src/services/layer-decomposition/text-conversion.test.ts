import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import {
  createTestingBoard,
  withHistory,
  Transforms,
  fakeNodeWeakMap,
  getTemporaryRef,
  deleteTemporaryElements,
} from '@plait/core';
import {
  buildLayerTextElements,
  convertLayerToEditableText,
  fitLayerTextFontSize,
} from './text-conversion';
import {
  parseLayerTextRecognition,
  parseLayerDecompositionResponse,
} from './contract';
import { buildLayerDecompositionManifest } from './manifest';

function recognition() {
  return {
    text: 'Hello World\nNext',
    lines: [
      {
        bounding_box: {
          absolute: [120, 220, 280, 240],
          normalized: [120, 220, 280, 240],
        },
        runs: [
          {
            text: 'Hello ',
            style: {
              foreground_color: '#193366',
              bold: true,
              similar_font_family: 'Helvetica Neue',
            },
          },
          {
            text: 'World',
            style: {
              italic: true,
              underline: true,
              strikethrough: true,
              shadow: true,
              translucent: true,
            },
          },
        ],
      },
      {
        bounding_box: {
          absolute: [120, 260, 280, 280],
          normalized: [120, 260, 280, 280],
        },
        runs: [{ text: 'Next', style: { similar_font_family: 'unknown' } }],
      },
    ],
  };
}
function source() {
  const textRecognition = parseLayerTextRecognition(recognition());
  if (!textRecognition) throw new Error('Invalid OCR fixture');
  return {
    id: 'text-image',
    type: 'image',
    url: '/layer.png',
    groupId: 'group',
    angle: 0,
    points: [
      [400, 500],
      [800, 700],
    ],
    metadata: {
      semanticLayer: {
        schemaVersion: 1,
        providerGroupId: 'native',
        name: 'Title',
        kind: 'foreground',
        zIndex: 2,
        boundingBox: {
          absolute: [100, 200, 300, 300],
          normalized: [100, 200, 300, 300],
        },
        textRecognition,
      },
    },
  };
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());
describe('Seedream rich text', () => {
  it('fits wide OCR lines to the padded text box and measures each style run', () => {
    const fonts: string[] = [];
    const context = {
      font: '',
      measureText: vi.fn(function (this: { font: string }) {
        fonts.push(this.font);
        return { width: 500 };
      }),
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    );
    const size = fitLayerTextFontSize(
      [
        {
          text: 'SUMMER ',
          style: { bold: true, similar_font_family: 'Arial' },
        },
        { text: 'SALE', style: { italic: true, similar_font_family: 'Arial' } },
      ],
      218,
      37
    );
    expect(size).toBe(20.9);
    expect((1000 * size) / 100).toBeLessThanOrEqual(218 - 8);
    expect(fonts[0]).toContain('bold');
    expect(fonts[1]).toContain('italic');
  });
  it('preserves styles and whitespace, ignores unsupported style properties', () => {
    const raw = recognition();
    Object.assign(raw.lines[0].runs[0].style, {
      font_size: 99,
      foreground_color: 'rgb(0,0,0)',
      bold: 'true',
    });
    const result = parseLayerTextRecognition(raw);
    if (!result) throw new Error('Expected valid recognition');
    expect(result.lines[0].runs[0].text).toBe('Hello ');
    expect(result.lines[0].runs[0].style).not.toHaveProperty('bold');
    expect(result.lines[0].runs[0].style).not.toHaveProperty('font_size');
    expect(result.lines[0].runs[0].style).not.toHaveProperty(
      'foreground_color'
    );
    expect(result.lines[0].runs[1].style).toMatchObject({
      shadow: true,
      translucent: true,
    });
  });

  it.each([
    undefined,
    null,
    {},
    { text: 'x', lines: [] },
    { text: 'x', lines: [{ bounding_box: {}, runs: [] }] },
  ])('keeps image artifacts when OCR is unusable: %j', (text_recognition) => {
    const result = parseLayerDecompositionResponse({
      group_id: 'g',
      data: [
        {
          url: '/bg.png',
          z_index: 0,
          name: 'bg',
          description: '',
          bounding_box: {
            absolute: [0, 0, 1000, 1000],
            normalized: [0, 0, 1000, 1000],
          },
        },
        {
          url: '/text.png',
          z_index: 1,
          name: 'text',
          description: '',
          bounding_box: {
            absolute: [100, 200, 300, 300],
            normalized: [100, 200, 300, 300],
          },
          text_recognition,
        },
      ],
    });
    expect(result.layers[0].url).toBe('/text.png');
    expect(result.layers[0].textRecognition).toBeUndefined();
  });

  it('maps multiline styles and scaled current layer bounds without fabricating shadow/alpha', () => {
    const nodes = buildLayerTextElements(source());
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      type: 'geometry',
      shape: 'text',
      groupId: 'group',
      points: [
        [440, 540],
        [760, 580],
      ],
      autoSize: false,
    });
    expect(nodes[0].text.children).toMatchObject([
      {
        text: 'Hello ',
        color: '#193366',
        bold: true,
        'font-family': 'Helvetica Neue',
        'font-size': 28.57,
      },
      { text: 'World', italic: true, underline: true, strikethrough: true },
    ]);
    expect(nodes[0]).not.toHaveProperty('opacity', 0.5);
    expect(nodes[1].text.children[0]['font-family']).toBe('sans-serif');
    const rotated = buildLayerTextElements({ ...source(), angle: Math.PI / 2 });
    expect(rotated[0].angle).toBe(Math.PI / 2);
    expect(rotated[0].points[0][0]).toBeCloseTo(480);
    expect(rotated[0].points[0][1]).toBeCloseTo(580);
  });

  it('persists recognition independently in manifest exports', () => {
    const layer = {
      ...source().metadata.semanticLayer,
      url: '/text.png',
      groupId: 'native',
    };
    const manifest = buildLayerDecompositionManifest({
      groupId: 'native',
      background: { ...layer, zIndex: 0 },
      layers: [layer],
    });
    const exported = manifest.layers[1].textRecognition;
    if (!exported) throw new Error('Missing exported recognition');
    exported.lines[0].runs[0].text = 'changed';
    expect(layer.textRecognition.lines[0].runs[0].text).toBe('Hello ');
    expect(JSON.stringify(manifest)).toContain('similar_font_family');
  });

  it('converts once, hides original and restores the raster in a single undo', () => {
    const original = source();
    const board = createTestingBoard([withHistory], [original]);
    expect(convertLayerToEditableText(board, original.id)).toBe(2);
    expect(board.children[0].metadata.semanticLayer.hidden).toBe(true);
    expect(board.children[0].url).toBe('/layer.png');
    expect(() => convertLayerToEditableText(board, original.id)).toThrow();
    expect(board.children).toHaveLength(3);
    const pending = getTemporaryRef(board);
    clearTimeout(pending?.timeoutId);
    deleteTemporaryElements(board);
    fakeNodeWeakMap(board);
    board.undo();
    expect(board.children).toEqual([original]);
    board.redo();
    expect(board.children).toHaveLength(3);
  });

  it('rejects out-of-bounds text without hiding or changing the image', () => {
    const original = source();
    original.metadata.semanticLayer.textRecognition.lines[0].boundingBox.absolute[0] = 0;
    const board = createTestingBoard([withHistory], [original]);
    expect(() => convertLayerToEditableText(board, original.id)).toThrow(
      '超出'
    );
    expect(board.children).toEqual([original]);
  });

  it('rolls back partial insertion when a transform fails', () => {
    const original = source();
    const board = createTestingBoard([withHistory], [original]);
    const insert = Transforms.insertNode;
    vi.spyOn(Transforms, 'insertNode')
      .mockImplementationOnce(insert)
      .mockImplementationOnce(() => {
        throw new Error('insertion failed');
      });
    expect(() => convertLayerToEditableText(board, original.id)).toThrow(
      'insertion failed'
    );
    expect(board.children).toEqual([original]);
  });
});
