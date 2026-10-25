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
  const canvasPointer = vi.fn();
  const viewportChanged = vi.fn();
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
    onCanvasPointer: canvasPointer,
    onBoundInputViewportChange: viewportChanged,
  };
  const view = render(<exports.Watcher {...props} />);
  return {
    ...view,
    processContent,
    resolveTarget,
    selectionChanged,
    targetChanged,
    canvasPointer,
    viewportChanged,
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

describe('AIInputBar canvas versus input clicks', () => {
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
        expect(h.canvasPointer).not.toHaveBeenCalled();
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
    expect(h.targetChanged).toHaveBeenLastCalledWith(target);
    expect(h.canvasPointer).toHaveBeenCalledOnce();
  });
});
