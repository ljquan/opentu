import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { PendingPersistence } from './pending-persistence';

interface Snapshot {
  children: { id: string }[];
  viewport?: object;
  operations?: { type: string }[];
}

interface StoredBoard {
  id: string;
  elements: Snapshot['children'];
  viewport: object;
  updatedAt: number;
}

interface Callbacks {
  handleTabSyncNeeded: () => Promise<boolean>;
  handleBoardChange: (data: Snapshot) => void;
  handleViewportChange: (viewport: object) => void;
  persistCloseSnapshot: (reason: 'pagehide') => void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Exercise the actual callbacks without mounting startup, storage or network UI.
// WorkspaceService's cache/notification guard is tested separately with real code.
const appSourceUrl = new URL('./app.tsx', import.meta.url);
const appSourcePath =
  appSourceUrl.protocol === 'file:'
    ? appSourceUrl
    : [
        resolve(process.cwd(), 'apps/web/src/app/app.tsx'),
        resolve(process.cwd(), 'src/app/app.tsx'),
      ].find(existsSync);
if (!appSourcePath) throw new Error('App source path discovery failed');
const source = readFileSync(appSourcePath, 'utf8');
const tree = ts.createSourceFile(
  'app.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const callbackCode: string[] = [];
function visit(node: ts.Node): void {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    ['handleTabSyncNeeded', 'handleBoardChange', 'handleViewportChange', 'persistCloseSnapshot'].includes(node.name.text) &&
    node.initializer &&
    ts.isCallExpression(node.initializer)
  ) {
    callbackCode.push(
      `exports.${node.name.text} = ${node.initializer.arguments[0].getText(
        tree
      )};`
    );
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (callbackCode.length !== 4)
  throw new Error('App sync callback discovery failed');
const compiled = ts.transpileModule(callbackCode.join('\n'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function createHarness() {
  const reads: ReturnType<typeof deferred<StoredBoard>>[] = [];
  const timers: (() => void)[] = [];
  const cancelledTimers = new Set<number>();
  const state = { currentBoardId: 'board-a' };
  let board: StoredBoard = {
    id: 'board-a',
    elements: [],
    viewport: {},
    updatedAt: 1,
  };
  let value: Snapshot = { children: board.elements };
  const persistence = new PendingPersistence();
  const save = vi.fn(async (data: Snapshot) => {
    board = { ...board, elements: data.children, viewport: data.viewport || {} };
  });
  const latestBoardDataRef = {
    current: { boardId: board.id, children: board.elements, viewport: board.viewport },
  };
  const localDirtyRef = { current: false };
  const isDataReadyRef = { current: true };
  const appliedSyncDataRef = { current: null as Snapshot | null };
  const closeSnapshot = vi.fn();
  const safeReload = vi.fn();
  const service = {
    getState: () => state,
    getCurrentBoard: () => board,
    reloadBoard: async (_id: string, guard: () => boolean) => {
      const read = deferred<StoredBoard>();
      reads.push(read);
      const snapshot = await read.promise;
      if (!guard()) return null;
      board = snapshot;
      return snapshot;
    },
    saveCurrentBoard: save,
  };
  const callbacks = {} as Callbacks;
  const syncing = { current: false };
  runInNewContext(compiled, {
    exports: callbacks,
    WorkspaceService: { getInstance: () => service },
    console: { error: vi.fn(), warn: vi.fn() },
    isSyncingRef: syncing,
    appliedSyncDataRef,
    tabSyncRequestRef: { current: 0 },
    isDataReadyRef,
    localDirtyRef,
    latestViewportRef: { current: undefined },
    latestBoardDataRef,
    currentBoardIdRef: { get current() { return state.currentBoardId; } },
    viewportSaveTimerRef: { current: null },
    VIEWPORT_SAVE_DEBOUNCE: 500,
    pendingPersistence: persistence,
    updateLatestBoardData: (boardId: string, data: Snapshot) => {
      latestBoardDataRef.current = { boardId, ...data, viewport: data.viewport || {} };
    },
    clearBoardCloseSnapshot: vi.fn(),
    saveBoardCloseSnapshot: closeSnapshot,
    markTabSyncVersion: vi.fn(),
    recoverVideoUrlsInElements: async (elements: Snapshot['children']) =>
      elements.map((item) => item),
    safeReload,
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: (id: number) => cancelledTimers.add(id),
    setValue: (data: Snapshot) => {
      value = data;
    },
  });
  return {
    callbacks,
    persistence,
    state,
    reads,
    save,
    safeReload,
    syncing,
    localDirtyRef,
    isDataReadyRef,
    appliedSyncDataRef,
    closeSnapshot,
    setBoardId: (id: string) => { board = { ...board, id }; },
    flushTimers: async () => {
      timers.forEach((fn, index) => {
        if (!cancelledTimers.has(index + 1)) fn();
      });
      await Promise.resolve();
    },
    get value() {
      return value;
    },
    insert: () =>
      callbacks.handleBoardChange({
        children: [...value.children, { id: 'new-image' }],
        viewport: {},
      }),
    snapshot: (...ids: string[]): StoredBoard => ({
      id: 'board-a',
      elements: ids.map((id) => ({ id })),
      viewport: {},
      updatedAt: 1,
    }),
  };
}

describe('App tab-sync insertion safety', () => {
  it('does not persist or replace controlled data for selection-only changes', () => {
    const h = createHarness();
    const value = h.value;
    for (let index = 0; index < 120; index++) {
      h.callbacks.handleBoardChange({ children: value.children, operations: [{ type: 'set_selection' }] });
    }
    expect(h.save).not.toHaveBeenCalled();
    expect(h.value).toBe(value);
    expect(h.persistence.hasPending).toBe(false);
  });

  it.each(['set_selection', 'set_viewport'])(
    'persists imported content accompanied only by %s', async (type) => {
      const h = createHarness();
      const children = [{ id: 'imported-image' }];
      h.callbacks.handleBoardChange({ children, operations: [{ type }] });
      expect(h.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ children }));
      expect(h.value.children).toBe(children);
      await Promise.resolve();
      expect(h.persistence.hasPending).toBe(false);
    }
  );

  it('coalesces viewport-only changes and saves the final view with existing content', async () => {
    const h = createHarness();
    h.insert();
    await Promise.resolve();
    h.save.mockClear();
    let viewport = {};
    for (let index = 0; index < 120; index++) {
      viewport = { zoom: 1 + index / 100 };
      h.callbacks.handleBoardChange({ children: h.value.children, viewport, operations: [{ type: 'set_viewport' }] });
      h.callbacks.handleViewportChange(viewport);
    }
    expect(h.save).not.toHaveBeenCalled();
    expect(h.persistence.hasPending).toBe(true);
    await h.flushTimers();
    expect(h.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ children: [{ id: 'new-image' }], viewport }));
    expect(h.persistence.hasPending).toBe(false);
  });

  it.each(['set_node', 'insert_node', 'remove_node', 'move_node', 'set_theme'])(
    'still saves %s immediately when mixed with selection and viewport operations',
    (type) => {
      const h = createHarness();
      const data = { children: [{ id: 'edited' }], operations: [{ type: 'set_selection' }, { type }, { type: 'set_viewport' }] };
      h.callbacks.handleBoardChange(data);
      expect(h.save).toHaveBeenCalledExactlyOnceWith(data);
      expect(h.value.children).toEqual([{ id: 'edited' }]);
    }
  );

  it('lets a content save replace an older pending viewport save', async () => {
    const h = createHarness();
    const viewport = { zoom: 2 };
    h.callbacks.handleViewportChange(viewport);
    h.callbacks.handleBoardChange({ children: [{ id: 'edited' }], viewport });
    await h.flushTimers();
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.persistence.hasPending).toBe(false);
  });

  it('retains an unsaved viewport in the page-close snapshot', () => {
    const h = createHarness();
    const viewport = { zoom: 2, origination: [100, 200] };
    h.callbacks.handleViewportChange(viewport);
    h.callbacks.persistCloseSnapshot('pagehide');
    expect(h.closeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ boardId: 'board-a', viewport }));
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ viewport }));
    expect(h.localDirtyRef.current).toBe(true);
  });

  it('keeps failed viewport writes pending for close recovery', async () => {
    const h = createHarness();
    h.save.mockRejectedValueOnce(new Error('storage unavailable'));
    const viewport = { zoom: 3 };
    h.callbacks.handleViewportChange(viewport);
    await h.flushTimers();
    expect(h.persistence.hasPending).toBe(true);
    h.callbacks.persistCloseSnapshot('pagehide');
    expect(h.closeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ viewport }));
  });

  it('does not save an old viewport into a different board', async () => {
    const h = createHarness();
    h.callbacks.handleViewportChange({ zoom: 4 });
    h.state.currentBoardId = 'board-b';
    h.setBoardId('board-b');
    await h.flushTimers();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('ignores viewport persistence during startup and for a synchronized echo', () => {
    const h = createHarness();
    h.isDataReadyRef.current = false;
    h.callbacks.handleViewportChange({ zoom: 2 });
    h.isDataReadyRef.current = true;
    const viewport = { zoom: 3 };
    h.syncing.current = true;
    h.appliedSyncDataRef.current = { children: [], viewport };
    h.callbacks.handleViewportChange(viewport);
    expect(h.persistence.hasPending).toBe(false);
    expect(h.localDirtyRef.current).toBe(false);
  });

  it('retains and saves an insertion even when a stale read completes after its save', async () => {
    const h = createHarness();
    const sync = h.callbacks.handleTabSyncNeeded();
    h.insert();
    await Promise.resolve();
    h.reads[0].resolve(h.snapshot());
    expect(await sync).toBe(false);
    expect(h.value.children.map((item) => item.id)).toEqual(['new-image']);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.persistence.hasPending).toBe(false);
  });

  it('ignores the remote echo but saves a new insertion during the apply window', async () => {
    const h = createHarness();
    const sync = h.callbacks.handleTabSyncNeeded();
    h.reads[0].resolve(h.snapshot('remote'));
    await sync;
    expect(h.syncing.current).toBe(true);
    h.callbacks.handleBoardChange(h.value);
    expect(h.save).not.toHaveBeenCalled();
    h.insert();
    expect(h.value.children.map((item) => item.id)).toEqual([
      'remote',
      'new-image',
    ]);
    expect(h.save).toHaveBeenCalledOnce();
  });

  it('does not apply an old board read after switching boards', async () => {
    const h = createHarness();
    const sync = h.callbacks.handleTabSyncNeeded();
    h.state.currentBoardId = 'board-b';
    h.reads[0].resolve(h.snapshot('stale'));
    expect(await sync).toBe(false);
    expect(h.value.children).toEqual([]);
  });

  it('only applies the newest of overlapping sync requests', async () => {
    const h = createHarness();
    const first = h.callbacks.handleTabSyncNeeded();
    const second = h.callbacks.handleTabSyncNeeded();
    h.reads[1].resolve(h.snapshot('latest'));
    expect(await second).toBe(true);
    h.reads[0].resolve(h.snapshot('older'));
    expect(await first).toBe(false);
    expect(h.value.children.map((item) => item.id)).toEqual(['latest']);
  });

  it('does not reload the page on a read failure after a local insertion', async () => {
    const h = createHarness();
    const sync = h.callbacks.handleTabSyncNeeded();
    h.insert();
    h.reads[0].reject(new Error('read failed'));
    expect(await sync).toBe(false);
    expect(h.safeReload).not.toHaveBeenCalled();
    expect(h.value.children.map((item) => item.id)).toEqual(['new-image']);
  });

  it('does not reload over local changes that are already pending', async () => {
    const h = createHarness();
    h.persistence.begin();
    expect(await h.callbacks.handleTabSyncNeeded()).toBe(false);
    expect(h.reads).toHaveLength(0);
  });

  it('does not acknowledge a notification during the sync apply window', async () => {
    const h = createHarness();
    const sync = h.callbacks.handleTabSyncNeeded();
    h.reads[0].resolve(h.snapshot('remote'));
    expect(await sync).toBe(true);
    expect(await h.callbacks.handleTabSyncNeeded()).toBe(false);
    expect(h.reads).toHaveLength(1);
  });
});
