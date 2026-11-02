import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';

// Execute the actual import handlers without starting media/provider services.
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
const declarations = new Map<string, string>();
const names = new Set([
  'handleBatchImportSelect',
  'executeBatchImport',
  'cancelBatchImport',
  'normalizedImagesPerRow',
  'pendingImportRowCount',
  'maxImportFillRowCount',
  'normalizedImportFillRowCount',
  'importCapacity',
  'exceedsImportCapacity',
]);
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(tree))) {
    declarations.set(node.name.getText(tree), `const ${node.getText(tree)};`);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (declarations.size !== names.size)
  throw new Error('Batch import declarations not found');
const compiled = ts.transpileModule(
  `
exports.select = function(event) {
  ${declarations.get('handleBatchImportSelect')}
  handleBatchImportSelect(event);
};
exports.execute = async function() {
  ${declarations.get('normalizedImagesPerRow')}
  ${declarations.get('pendingImportRowCount')}
  ${declarations.get('maxImportFillRowCount')}
  ${declarations.get('normalizedImportFillRowCount')}
  ${declarations.get('importCapacity')}
  ${declarations.get('exceedsImportCapacity')}
  ${declarations.get('executeBatchImport')}
  return executeBatchImport();
};
exports.cancel = function() {
  ${declarations.get('cancelBatchImport')}
  cancelBatchImport();
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;

function harness(selected: number[] = [], perRow = 1) {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    prompt: `row-${index + 1}`,
    params: { size: '1x1' },
    images: [`original-${index + 1}`],
    count: 1,
    taskIds: [`task-${index + 1}`],
  }));
  let current = rows;
  let nextId = 6;
  const api = {} as {
    select: (event: unknown) => void;
    execute: () => Promise<void>;
    cancel: () => void;
  };
  const warning = vi.fn();
  const addAsset = vi.fn().mockResolvedValue({});
  const read = vi.fn();
  const state = {
    exports: api,
    tasks: rows,
    selectedRows: new Set(selected),
    activeCell: { row: 1 },
    imagesPerRow: perRow,
    importStartRow: 1,
    importFillRowCount: null as number | null,
    pendingImportRowIds: null as number[] | null,
    pendingImportFiles: [] as File[],
    taskIdCounter: 6,
    language: 'zh',
    defaultModelParams: { size: '1x1' },
    batchImportInputRef: { current: { value: 'chosen' } },
    setPendingImportFiles: (files: File[]) => {
      state.pendingImportFiles = files;
    },
    setPendingImportRowIds: (ids: number[] | null) => {
      state.pendingImportRowIds = ids;
    },
    setImportStartRow: (row: number) => {
      state.importStartRow = row;
    },
    setImportFillRowCount: (count: number | null) => {
      state.importFillRowCount = count;
    },
    setShowBatchImportModal: vi.fn(),
    setTasks: (update: (prev: typeof rows) => typeof rows) => {
      current = update(current);
    },
    setTaskIdCounter: (update: (prev: number) => number) => {
      nextId = update(nextId);
    },
    useCallback: <T>(callback: T) => callback,
    MessagePlugin: { warning, success: vi.fn() },
    AssetType: { IMAGE: 'image' },
    AssetSource: { LOCAL: 'local' },
    addAsset,
    trackMemory: () => vi.fn(),
    console,
    FileReader: class {
      onload?: (event: { target: { result: string } }) => void;
      readAsDataURL(file: File) {
        read(file);
        this.onload?.({ target: { result: `data:${file.name}` } });
      }
    },
  };
  runInNewContext(compiled, state);
  return {
    rows,
    state,
    warning,
    read,
    addAsset,
    current: () => current,
    nextId: () => nextId,
    select: (count: number) =>
      api.select({
        target: {
          files: Array.from({ length: count }, (_, index) => ({
            name: `${index + 1}.png`,
            type: 'image/png',
          })),
        },
      }),
    execute: api.execute,
    cancel: api.cancel,
  };
}

describe('batch local reference-image assignment', () => {
  it('fills only non-contiguous checked rows in table order, preserving unchecked content', async () => {
    const h = harness([3, 0, 2]);
    h.select(3);
    expect(h.state.pendingImportRowIds).toEqual([1, 3, 4]);
    await h.execute();
    expect(h.current().map((row) => row.images)).toEqual([
      ['original-1', 'data:1.png'],
      ['original-2'],
      ['original-3', 'data:2.png'],
      ['original-4', 'data:3.png'],
      ['original-5'],
    ]);
    expect(h.current()[1]).toBe(h.rows[1]);
    expect(h.current()[4]).toBe(h.rows[4]);
    expect(h.nextId()).toBe(6);
  });

  it('defaults to filling every checked row even when only one image is imported', async () => {
    const h = harness([0, 2, 3]);
    h.select(1);
    await h.execute();
    expect(h.current()[0].images).toEqual(['original-1', 'data:1.png']);
    expect(h.current()[2].images).toEqual(['original-3', 'data:1.png']);
    expect(h.current()[3].images).toEqual(['original-4', 'data:1.png']);
    expect(h.current()[1]).toBe(h.rows[1]);
    expect(h.current()[4]).toBe(h.rows[4]);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.addAsset).toHaveBeenCalledTimes(1);
  });

  it('cycles multiple images through all checked rows by default', async () => {
    const h = harness([4, 0, 2]);
    h.select(2);
    await h.execute();
    expect(h.current()[0].images).toContain('data:1.png');
    expect(h.current()[2].images).toContain('data:2.png');
    expect(h.current()[4].images).toContain('data:1.png');
    expect(h.current()[1]).toBe(h.rows[1]);
    expect(h.current()[3]).toBe(h.rows[3]);
  });

  it('honors an explicit one-row limit instead of filling every checked row', async () => {
    const h = harness([0, 2, 3]);
    h.select(1);
    h.state.importFillRowCount = 1;
    await h.execute();
    expect(h.current()[0].images).toContain('data:1.png');
    expect(h.current().slice(1)).toEqual(h.rows.slice(1));
  });

  it('respects images per row and never spills into gaps or new rows', async () => {
    const h = harness([0, 2, 3], 2);
    h.select(5);
    await h.execute();
    expect(h.current()[0].images).toEqual([
      'original-1',
      'data:1.png',
      'data:2.png',
    ]);
    expect(h.current()[2].images).toEqual([
      'original-3',
      'data:3.png',
      'data:4.png',
    ]);
    expect(h.current()[3].images).toEqual(['original-4', 'data:5.png']);
    expect(h.current()[1]).toBe(h.rows[1]);
    expect(h.current()[4]).toBe(h.rows[4]);
    expect(h.current()).toHaveLength(5);
  });

  it('rejects excess images before reading or adding assets, and permits an adjusted capacity', async () => {
    const h = harness([0, 2, 3]);
    h.select(4);
    await h.execute();
    expect(h.warning).toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.addAsset).not.toHaveBeenCalled();
    expect(h.current()).toBe(h.rows);
    h.state.imagesPerRow = 2;
    await h.execute();
    expect(h.current()[2].images).toEqual([
      'original-3',
      'data:3.png',
      'data:4.png',
    ]);
    expect(h.current()[1]).toBe(h.rows[1]);
  });

  it('captures the selected row identities when opening the import dialog', async () => {
    const h = harness([0, 2, 3]);
    h.select(3);
    h.state.selectedRows = new Set([1, 4]);
    await h.execute();
    expect(h.current()[1]).toBe(h.rows[1]);
    expect(h.current()[4]).toBe(h.rows[4]);
    expect(h.current()[2].images).toContain('data:2.png');
  });

  it('keeps the start-row behavior and creates rows when none are checked', async () => {
    const h = harness();
    h.select(3);
    expect(h.state.pendingImportRowIds).toBeNull();
    h.state.importStartRow = 5;
    await h.execute();
    expect(h.current().slice(0, 4)).toEqual(h.rows.slice(0, 4));
    expect(h.current()[4].images).toEqual(['original-5', 'data:1.png']);
    expect(
      h
        .current()
        .slice(5)
        .map((row) => row.images)
    ).toEqual([['data:2.png'], ['data:3.png']]);
    expect(h.nextId()).toBe(8);
  });

  it('clears the selection snapshot on cancel without changing rows', () => {
    const h = harness([0, 2, 3]);
    h.select(3);
    h.cancel();
    expect(h.state.pendingImportRowIds).toBeNull();
    expect(h.state.pendingImportFiles).toEqual([]);
    expect(h.current()).toBe(h.rows);
  });

  it('fills rows 1 through 5 with a single image when five rows are requested', async () => {
    const h = harness();
    h.select(1);
    h.state.importStartRow = 1;
    h.state.importFillRowCount = 5;
    await h.execute();
    expect(h.current().map((row) => row.images)).toEqual(
      h.rows.map((row) => [...row.images, 'data:1.png'])
    );
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.addAsset).toHaveBeenCalledTimes(1);
    expect(h.nextId()).toBe(6);
  });

  it('fills exactly the requested range while leaving rows on both sides unchanged', async () => {
    const h = harness();
    h.select(1);
    h.state.importStartRow = 2;
    h.state.importFillRowCount = 3;
    await h.execute();
    expect(h.current()[0]).toBe(h.rows[0]);
    expect(h.current()[4]).toBe(h.rows[4]);
    for (const row of h.current().slice(1, 4))
      expect(row.images).toContain('data:1.png');
  });

  it('cycles groups in file order and preserves a shorter final group', async () => {
    const h = harness([], 2);
    h.select(3);
    h.state.importStartRow = 1;
    h.state.importFillRowCount = 5;
    await h.execute();
    expect(h.current().map((row) => row.images.slice(1))).toEqual([
      ['data:1.png', 'data:2.png'],
      ['data:3.png'],
      ['data:1.png', 'data:2.png'],
      ['data:3.png'],
      ['data:1.png', 'data:2.png'],
    ]);
  });

  it('caps repeated filling at the checked rows, never touching unchecked rows', async () => {
    const h = harness([0, 2, 3]);
    h.select(1);
    h.state.importFillRowCount = 5;
    await h.execute();
    expect(h.current()[1]).toBe(h.rows[1]);
    expect(h.current()[4]).toBe(h.rows[4]);
    for (const index of [0, 2, 3])
      expect(h.current()[index].images).toContain('data:1.png');
    expect(h.current()).toHaveLength(5);
  });

  it('can fill only the first two checked rows with one repeated image', async () => {
    const h = harness([0, 2, 3]);
    h.select(1);
    h.state.importFillRowCount = 2;
    await h.execute();
    expect(h.current()[0].images).toContain('data:1.png');
    expect(h.current()[2].images).toContain('data:1.png');
    expect(h.current()[3]).toBe(h.rows[3]);
  });

  it('creates the extra requested rows and advances IDs when filling past the end', async () => {
    const h = harness();
    h.select(1);
    h.state.importStartRow = 4;
    h.state.importFillRowCount = 5;
    await h.execute();
    expect(h.current()).toHaveLength(8);
    expect(h.current().slice(0, 3)).toEqual(h.rows.slice(0, 3));
    expect(
      h
        .current()
        .slice(5)
        .map((row) => row.id)
    ).toEqual([6, 7, 8]);
    expect(
      h
        .current()
        .slice(5)
        .map((row) => row.images)
    ).toEqual([['data:1.png'], ['data:1.png'], ['data:1.png']]);
    expect(h.nextId()).toBe(9);
  });

  it('rejects a manual range too short to include all images without dropping files', async () => {
    const h = harness();
    h.select(3);
    h.state.importFillRowCount = 2;
    await h.execute();
    expect(h.warning).toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.current()).toBe(h.rows);
  });

  it('resets the manual row count on cancel and on a new file selection', () => {
    const h = harness();
    h.select(1);
    h.state.importFillRowCount = 5;
    h.cancel();
    expect(h.state.importFillRowCount).toBeNull();
    h.state.importFillRowCount = 5;
    h.select(2);
    expect(h.state.importFillRowCount).toBeNull();
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
    'normalizes an invalid requested count %s to a valid range',
    async (count) => {
      const h = harness();
      h.select(1);
      h.state.importStartRow = 1;
      h.state.importFillRowCount = count;
      await h.execute();
      expect(h.current()[0].images).toContain('data:1.png');
      expect(h.current().slice(1)).toEqual(h.rows.slice(1));
    }
  );
});
