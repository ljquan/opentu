import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
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
import * as ts from 'typescript';
import { AssetType, type Asset } from '../../types/asset.types';
import { BatchLibraryThumbnail } from './BatchLibraryThumbnail';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@aitu/utils', () => ({ normalizeImageDataUrl: (url: string) => url }));
// Thumbnail generation is covered by the shared hook; keep this integration
// focused on visible images reading the resulting local virtual thumbnail.
vi.mock('../../hooks/useThumbnailUrl', () => ({
  useThumbnailUrl: (url: string) => `${url}?thumbnail=small`,
}));
vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: { getCachedImageBlobWithThumbnailFallback: mocks.read },
}));

const source = readFileSync(
  resolve(__dirname, 'batch-image-generation.tsx'),
  'utf8'
);
const tree = ts.createSourceFile(
  'batch-image-generation.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let assetFilter = '';
let assetMap = '';
let dragHandler = '';
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(tree) === 'imageAssets'
  )
    assetFilter = `const ${node.getText(tree)};`;
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(tree) === 'handleLibraryImageDragStart'
  )
    dragHandler = `const ${node.getText(tree)};`;
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(tree) === 'imageAssets.map'
  )
    assetMap = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
if (!assetFilter || !assetMap || !dragHandler)
  throw new Error('Batch library declarations not found');
const compiled = ts.transpileModule(
  `
exports.Grid = function({ assets, onAdd }) {
  const libraryAssets = assets;
  const language = 'zh';
  const addImageToSelectedRows = onAdd;
  ${assetFilter}
  ${dragHandler}
  return <>{${assetMap}}</>;
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }
).outputText;
const exports = {} as {
  Grid: React.ComponentType<{
    assets: Array<Pick<Asset, 'id' | 'name' | 'type' | 'url'>>;
    onAdd: (url: string) => void;
  }>;
};
runInNewContext(compiled, {
  exports,
  React,
  AssetType,
  BatchLibraryThumbnail,
  useCallback: <T,>(callback: T) => callback,
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
});

let visibility: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;
const createUrl = vi.fn();
const revokeUrl = vi.fn();
beforeEach(() => {
  visibility = [];
  mocks.read
    .mockReset()
    .mockResolvedValue(new Blob(['thumbnail'], { type: 'image/png' }));
  createUrl.mockReset().mockReturnValue('blob:batch-thumbnail');
  revokeUrl.mockReset();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        callback: (entries: Array<{ isIntersecting: boolean }>) => void
      ) {
        visibility.push(callback);
      }
      observe = () => undefined;
      disconnect = () => undefined;
    }
  );
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function showImages() {
  await act(async () => {
    visibility.forEach((callback) => callback([{ isIntersecting: true }]));
  });
}
const asset = {
  id: 'local',
  name: '本地参考图',
  type: AssetType.IMAGE,
  url: '/asset-library/content-local.png',
};

describe('batch library thumbnails', () => {
  it('reads a virtual thumbnail from cache only after becoming visible, then releases its Blob URL', async () => {
    const view = render(<BatchLibraryThumbnail asset={asset} />);
    expect(mocks.read).not.toHaveBeenCalled();
    await showImages();
    await waitFor(() =>
      expect(screen.getByAltText(asset.name).getAttribute('src')).toBe(
        'blob:batch-thumbnail'
      )
    );
    expect(mocks.read).toHaveBeenCalledWith(`${asset.url}?thumbnail=small`);
    fireEvent.load(screen.getByAltText(asset.name));
    view.unmount();
    expect(revokeUrl).toHaveBeenCalledWith('blob:batch-thumbnail');
  });

  it('keeps original asset URLs for adding and dragging rather than using the preview Blob', async () => {
    const onAdd = vi.fn();
    render(<exports.Grid assets={[asset]} onAdd={onAdd} />);
    await showImages();
    const image = screen.getByAltText(asset.name);
    await waitFor(() =>
      expect(image.getAttribute('src')).toBe('blob:batch-thumbnail')
    );
    fireEvent.click(image);
    expect(onAdd).toHaveBeenCalledWith(asset.url);
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'none' };
    const tile = image.closest('.library-image');
    if (!tile) throw new Error('Missing library tile');
    fireEvent.dragStart(tile, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'text/library-image',
      asset.url
    );
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('keeps the shared image asset membership and ordering while excluding other media', async () => {
    const image2 = {
      ...asset,
      id: 'second',
      name: '另一张图片',
      url: '/__aitu_cache__/image/second.png',
    };
    render(
      <exports.Grid
        assets={[
          image2,
          { ...asset, id: 'video', type: AssetType.VIDEO, name: '视频' },
          asset,
        ]}
        onAdd={vi.fn()}
      />
    );
    await showImages();
    expect(
      screen.getAllByRole('img').map((image) => image.getAttribute('alt'))
    ).toEqual([image2.name, asset.name]);
    expect(screen.queryByAltText('视频')).toBeNull();
  });

  it('reloads the current thumbnail when an asset changes', async () => {
    const view = render(<BatchLibraryThumbnail asset={asset} />);
    await showImages();
    await waitFor(() =>
      expect(screen.getByAltText(asset.name).getAttribute('src')).toBe(
        'blob:batch-thumbnail'
      )
    );
    createUrl.mockReturnValue('blob:new-thumbnail');
    view.rerender(
      <BatchLibraryThumbnail
        asset={{ ...asset, name: '新图片', url: '/asset-library/new.png' }}
      />
    );
    await waitFor(() =>
      expect(screen.getByAltText('新图片').getAttribute('src')).toBe(
        'blob:new-thumbnail'
      )
    );
    expect(revokeUrl).toHaveBeenCalledWith('blob:batch-thumbnail');
  });
});
