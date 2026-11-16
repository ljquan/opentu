import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  createTestingBoard,
  withHistory,
  fakeNodeWeakMap,
  getTemporaryRef,
  deleteTemporaryElements,
  Transforms,
} from '@plait/core';
import { insertLayerDecomposition, exportSemanticLayerGroup } from './canvas';
import { parseLayerDecompositionResponse } from './contract';
import { convertLayerToEditableText } from './text-conversion';
const mocks = vi.hoisted(() => ({
  cache: vi.fn(),
  load: vi.fn(),
  zip: vi.fn(),
}));
vi.mock('../media-executor/fallback-utils', () => ({
  cacheRemoteUrl: mocks.cache,
}));
vi.mock('../../data/image', () => ({ loadImageElementForCanvas: mocks.load }));
vi.mock('../../utils/download-utils', () => ({ downloadAsZip: mocks.zip }));
const source = {
  id: 'original',
  type: 'image',
  url: '/original.png',
  points: [
    [0, 0],
    [400, 400],
  ],
};
function response(count = 99) {
  return parseLayerDecompositionResponse(
    {
      group_id: 'g',
      width: 1000,
      height: 1000,
      data: Array.from({ length: count + 1 }, (_, i) => ({
        url: `https://example.test/${i}.png`,
        z_index: i,
        name: `layer-${i}`,
        description: '',
        bounding_box: {
          absolute: [0, 0, 1000, 1000],
          normalized: [0, 0, 1000, 1000],
        },
        ...(i
          ? {
              text_recognition: {
                text: 'Title',
                lines: [
                  {
                    bounding_box: {
                      absolute: [10, 10, 300, 40],
                      normalized: [10, 10, 300, 40],
                    },
                    runs: [
                      {
                        text: 'Title',
                        style: { foreground_color: '#112233', bold: true },
                      },
                    ],
                  },
                ],
              },
            }
          : {}),
      })),
    },
    { maxForegroundLayers: 99 }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.mockImplementation(
    async (_url, _id, _type, _format, index) =>
      `/__aitu_cache__/image/${index}.png`
  );
  mocks.load.mockResolvedValue({ naturalWidth: 1000, naturalHeight: 1000 });
  mocks.zip.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());
it('caches, inserts and exports all 100 artifacts with OCR, preserving undo', async () => {
  const board = createTestingBoard([withHistory], [source]);
  const result = await insertLayerDecomposition(board, source.id, response());
  expect(mocks.cache).toHaveBeenCalledTimes(100);
  expect(board.children.filter((item) => item.type === 'image')).toHaveLength(
    100
  );
  expect(result.manifest.layers).toHaveLength(100);
  expect(board.children[99].metadata.semanticLayer.textRecognition.text).toBe(
    'Title'
  );
  await exportSemanticLayerGroup(board, 'g');
  expect(mocks.zip.mock.calls[0][0]).toHaveLength(100);
  expect(
    JSON.parse(mocks.zip.mock.calls[0][3][0].content).layers[99].textRecognition
      .text
  ).toBe('Title');
  fakeNodeWeakMap(board);
  board.undo();
  expect(board.children).toEqual([source]);
});
it('leaves the original intact when cache or decoding fails midway', async () => {
  const board = createTestingBoard([withHistory], [source]);
  mocks.load
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('decode failed'));
  await expect(
    insertLayerDecomposition(board, source.id, response(2))
  ).rejects.toThrow('decode failed');
  expect(board.children).toEqual([source]);
});
it('retains OCR on serialized boards and exports edited text linked to its hidden raster', async () => {
  const initial = createTestingBoard([withHistory], [source]);
  await insertLayerDecomposition(initial, source.id, response(1));
  const board = createTestingBoard(
    [withHistory],
    JSON.parse(JSON.stringify(initial.children))
  );
  const raster = board.children.find(
    (element) => element.metadata?.semanticLayer?.zIndex === 1
  );
  expect(raster).toBeDefined();
  convertLayerToEditableText(board, raster?.id || '');
  const pending = getTemporaryRef(board);
  clearTimeout(pending?.timeoutId);
  deleteTemporaryElements(board);
  const index = board.children.findIndex(
    (element) => element.metadata?.semanticText
  );
  Transforms.setNode(
    board,
    { text: { type: 'paragraph', children: [{ text: '新标题', bold: true }] } },
    [index]
  );
  await exportSemanticLayerGroup(board, 'g');
  const manifest = JSON.parse(mocks.zip.mock.calls[0][3][0].content);
  expect(manifest.layers[1].textRecognition.text).toBe('Title');
  expect(manifest.editableTextLayers[0]).toMatchObject({
    sourceZIndex: 1,
    sourceRasterHidden: true,
    text: { children: [{ text: '新标题', bold: true }] },
  });
});
it('does not mutate the board after cancellation during caching', async () => {
  const board = createTestingBoard([withHistory], [source]);
  const abort = new AbortController();
  mocks.cache.mockImplementation(async () => {
    abort.abort();
    return '/cached.png';
  });
  await expect(
    insertLayerDecomposition(board, source.id, response(2), {
      signal: abort.signal,
    })
  ).rejects.toThrow();
  expect(board.children).toEqual([source]);
  expect(mocks.cache).toHaveBeenCalledOnce();
});
