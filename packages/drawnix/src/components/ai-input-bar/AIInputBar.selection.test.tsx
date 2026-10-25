import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';

// Exercise the actual watcher and its document subscriptions without importing
// the generation runtime, following the existing AIInputBar declaration tests.
const source = readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8');
const tree = ts.createSourceFile(
  'AIInputBar.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let declaration = '';
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'SelectionWatcher'
  ) {
    declaration = `const ${node.getText(tree)};`;
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (!declaration) throw new Error('Selection watcher not found');
const compiled = ts.transpileModule(
  `${declaration}\nexports.Watcher = SelectionWatcher;`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const first = { id: 'first', type: 'image', url: '/asset-library/first.png' };
const second = {
  id: 'second',
  type: 'image',
  url: '/asset-library/second.png',
};
function processed(elements = [first, second]) {
  return {
    remainingImages: elements.map((element) => ({
      ...element,
      sourceElementId: element.id,
    })),
  };
}

function harness(initialSelection = [first, second]) {
  let selected = initialSelection;
  let board = { children: [first, second] };
  const processContent = vi.fn().mockResolvedValue(processed(initialSelection));
  const resolveTarget = vi.fn().mockResolvedValue(null);
  const selectionChanged = vi.fn();
  const targetChanged = vi.fn();
  const viewportChanged = vi.fn();
  const canvasPointer = vi.fn();
  const exports = {} as {
    Watcher: React.ComponentType<Record<string, unknown>>;
  };
  runInNewContext(compiled, {
    exports,
    React,
    useEffect,
    useLayoutEffect,
    useRef,
    useBoard: () => board,
    setCanvasBoard: vi.fn(),
    clearCanvasBoard: vi.fn(),
    setMcpCanvasBoard: vi.fn(),
    setBoard: vi.fn(),
    setCapabilitiesBoard: vi.fn(),
    gridImageService: { setBoard: vi.fn() },
    flushDeferredCanvasAssociationLines: vi.fn(),
    getSelectedElements: () => selected,
    clearSelectedElement: () => {
      selected = [];
    },
    resolveBoundImageTarget: resolveTarget,
    processSelectedContentForAI: processContent,
    isFrameElement: () => false,
    isVideoUrl: () => false,
    PlaitBoard: { getBoardContainer: () => document.body },
    ATTACHED_ELEMENT_CLASS_NAME: 'attached-element',
    isCanvasAssociationPickingSessionCurrent: () => true,
    AI_SELECTION_CONTENT_REFRESH_EVENT: 'test-selection-refresh',
    document,
    window,
    Element,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 16),
    cancelAnimationFrame: (id: number) => window.clearTimeout(id),
  });
  const props = {
    language: 'zh',
    currentBoardId: 'board-a',
    onSelectionChange: selectionChanged,
    onBoundImageTargetChange: targetChanged,
    onBoundInputViewportChange: viewportChanged,
    onCanvasPointer: canvasPointer,
  };
  const view = render(<exports.Watcher {...props} />);
  return {
    ...view,
    processContent,
    resolveTarget,
    selectionChanged,
    targetChanged,
    viewportChanged,
    canvasPointer,
    select: (elements: typeof selected) => {
      selected = elements;
    },
    switchBoard: () => {
      board = { children: [first, second] };
    },
    update: (next: Record<string, unknown>) =>
      view.rerender(<exports.Watcher {...props} {...next} />),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function flush() {
  await act(async () => undefined);
}
async function moveViewport(event: string) {
  await act(async () => {
    (event === 'resize' ? window : document).dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(16);
  });
}

describe('AIInputBar canvas selection publication', () => {
  it.each(['Dialog-overlay', 'ai-input-bar'])(
    'does not treat a click inside %s as a click on the canvas image',
    async (className) => {
      const h = harness([first]);
      await flush();
      const target = { elementId: first.id };
      h.resolveTarget.mockResolvedValue(target);
      const panel = document.createElement('div');
      panel.className = className;
      const button = document.createElement('button');
      panel.appendChild(button);
      document.body.appendChild(panel);
      h.targetChanged.mockClear();
      try {
        await act(async () => {
          button.dispatchEvent(new Event('pointerup', { bubbles: true }));
          await vi.advanceTimersByTimeAsync(50);
        });
        expect(h.targetChanged).toHaveBeenLastCalledWith(target);
      } finally {
        panel.remove();
      }
    }
  );
  it('distinguishes a canvas click from a viewport refresh for restoring source prompts', async () => {
    const h = harness([first]);
    await flush();
    const target = { elementId: first.id };
    h.resolveTarget.mockResolvedValue(target);
    h.targetChanged.mockClear();
    await moveViewport('pointermove');
    expect(h.targetChanged).toHaveBeenLastCalledWith(target);
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(h.canvasPointer).toHaveBeenCalledOnce();
    expect(h.targetChanged).toHaveBeenLastCalledWith(target);
  });
  it.each(['pointermove', 'wheel', 'keyup', 'resize'])(
    'publishes both selected images when %s occurs during extraction',
    async (event) => {
      const h = harness();
      await flush();
      const pending = deferred<ReturnType<typeof processed>>();
      h.processContent.mockReturnValueOnce(pending.promise);
      h.selectionChanged.mockClear();
      await act(async () => {
        document.dispatchEvent(new Event('test-selection-refresh'));
      });
      await moveViewport(event);
      await act(async () => {
        pending.resolve(processed());
      });
      expect(h.selectionChanged).toHaveBeenLastCalledWith([
        expect.objectContaining({ sourceElementId: 'first', url: first.url }),
        expect.objectContaining({ sourceElementId: 'second', url: second.url }),
      ]);
      expect(h.processContent).toHaveBeenCalledTimes(2);
      expect(h.viewportChanged).toHaveBeenCalled();
    }
  );

  it('keeps a pending selection alive while bound-target lookup is also pending', async () => {
    const h = harness();
    await flush();
    const pending = deferred<null>();
    h.resolveTarget.mockReturnValueOnce(pending.promise);
    h.selectionChanged.mockClear();
    await act(async () => {
      document.dispatchEvent(new Event('test-selection-refresh'));
    });
    await moveViewport('pointermove');
    await act(async () => {
      pending.resolve(null);
    });
    expect(h.selectionChanged).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sourceElementId: 'first' }),
        expect.objectContaining({ sourceElementId: 'second' }),
      ])
    );
  });

  it('does not let a viewport lookup overwrite a newer selection', async () => {
    const h = harness([first]);
    await flush();
    const oldTarget = deferred<{ elementId: string }>();
    h.resolveTarget.mockReturnValueOnce(oldTarget.promise);
    await moveViewport('pointermove');
    h.select([first, second]);
    await act(async () => {
      document.dispatchEvent(new Event('test-selection-refresh'));
    });
    h.targetChanged.mockClear();
    await act(async () => {
      oldTarget.resolve({ elementId: 'first' });
    });
    expect(h.targetChanged).not.toHaveBeenCalled();
  });

  it('applies only the latest viewport result without re-extracting selected content', async () => {
    const h = harness([first]);
    await flush();
    const older = deferred<{ elementId: string; rect: { x: number } }>();
    const newer = deferred<{ elementId: string; rect: { x: number } }>();
    h.resolveTarget
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    await moveViewport('pointermove');
    await moveViewport('wheel');
    await act(async () => {
      newer.resolve({ elementId: 'first', rect: { x: 20 } });
    });
    h.targetChanged.mockClear();
    await act(async () => {
      older.resolve({ elementId: 'first', rect: { x: 10 } });
    });
    expect(h.targetChanged).not.toHaveBeenCalled();
    expect(h.processContent).toHaveBeenCalledOnce();
  });

  it('handles pointerup followed by movement while content is being extracted', async () => {
    const h = harness();
    await flush();
    const pending = deferred<ReturnType<typeof processed>>();
    h.processContent.mockReturnValueOnce(pending.promise);
    h.selectionChanged.mockClear();
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(50);
    });
    await moveViewport('pointermove');
    await act(async () => {
      pending.resolve(processed());
    });
    expect(h.selectionChanged).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sourceElementId: 'first' }),
        expect.objectContaining({ sourceElementId: 'second' }),
      ])
    );
  });

  it('does not publish extraction from an earlier selection after deselection', async () => {
    const h = harness();
    await flush();
    const pending = deferred<ReturnType<typeof processed>>();
    h.processContent.mockReturnValueOnce(pending.promise);
    await act(async () => {
      document.dispatchEvent(new Event('test-selection-refresh'));
    });
    h.select([]);
    await act(async () => {
      document.dispatchEvent(new Event('test-selection-refresh'));
    });
    expect(h.selectionChanged).toHaveBeenLastCalledWith([]);
    h.selectionChanged.mockClear();
    await act(async () => {
      pending.resolve(processed());
    });
    expect(h.selectionChanged).not.toHaveBeenCalled();
  });

  it('ignores pending content after switching boards', async () => {
    const h = harness();
    await flush();
    const pending = deferred<ReturnType<typeof processed>>();
    h.processContent.mockReturnValueOnce(pending.promise);
    await act(async () => {
      document.dispatchEvent(new Event('test-selection-refresh'));
    });
    h.switchBoard();
    h.select([]);
    await act(async () => {
      h.update({ currentBoardId: 'board-b' });
    });
    h.selectionChanged.mockClear();
    await act(async () => {
      pending.resolve(processed());
    });
    expect(h.selectionChanged).not.toHaveBeenCalled();
  });

  it('does not publish pending extraction after unmount', async () => {
    const h = harness();
    await flush();
    const pending = deferred<ReturnType<typeof processed>>();
    h.processContent.mockReturnValueOnce(pending.promise);
    await act(async () => {
      document.dispatchEvent(new Event('test-selection-refresh'));
    });
    h.unmount();
    h.selectionChanged.mockClear();
    await act(async () => {
      pending.resolve(processed());
    });
    expect(h.selectionChanged).not.toHaveBeenCalled();
  });

  it('refreshes an unbound image when the prompt changes during extraction', async () => {
    const h = harness([first]);
    await flush();
    const oldContent = deferred<ReturnType<typeof processed>>();
    h.processContent.mockReturnValueOnce(oldContent.promise);
    await act(async () => {
      document.dispatchEvent(new Event('test-selection-refresh'));
    });
    h.processContent.mockResolvedValueOnce(processed([first]));
    h.selectionChanged.mockClear();
    await act(async () => {
      h.update({ semanticEditPrompt: '更新描述' });
    });
    expect(h.selectionChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ sourceElementId: 'first' }),
    ]);
    h.selectionChanged.mockClear();
    await act(async () => {
      oldContent.resolve(processed([second]));
    });
    expect(h.selectionChanged).not.toHaveBeenCalled();
  });
});
