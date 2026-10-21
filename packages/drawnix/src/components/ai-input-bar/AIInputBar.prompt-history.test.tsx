import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { useCallback } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';

// Exercise the actual callback without importing the unrelated generation
// runtime, using the same declaration harness as AIInputBar.ppt-models.test.
const source = readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8');
const tree = ts.createSourceFile('AIInputBar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleSelectHistoryPrompt') {
    declaration = `const ${node.getText(tree)};`;
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (!declaration) throw new Error('History prompt callback not found');
const compiled = ts.transpileModule(
  `exports.useSelect = function useSelect() { ${declaration} return handleSelectHistoryPrompt; };`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;

function harness(initialPrompt = '') {
  const refs = [{ referenceId: 'canvas-image', mentionStart: 0, mentionEnd: 4 }];
  const uploads = [{ url: '/uploaded.png', maskImage: '/mask.png' }];
  const selected = [{ url: '/selected-a.png' }, { url: '/selected-b.png' }];
  const promptRef = { current: initialPrompt };
  const setPrompt = vi.fn();
  const saveActiveTaskbarDraft = vi.fn(() => ({ prompt: promptRef.current, refs, uploads, selected }));
  const overwritten = vi.fn();
  const confirm = vi.fn(async () => true);
  const switchType = vi.fn();
  const focus = vi.fn();
  const exports = {} as { useSelect: () => (info: { content: string; modelType?: string }) => void };
  runInNewContext(compiled, {
    exports, useCallback, promptRef, setPrompt, saveActiveTaskbarDraft,
    dismissPromptSuggestion: vi.fn(),
    pendingCanvasAssociationEditRef: { current: null },
    updateCanvasAssociationTrigger: vi.fn(),
    setIsInspirationSendGuideActive: vi.fn(),
    focusInput: focus,
    // These are deliberately available so the former overwrite implementation
    // fails on its behavior rather than on a missing dependency in this harness.
    confirmOverwriteInputIfNeeded: confirm,
    applyCanvasAssociationPromptOverwrite: overwritten,
    setGenerationType: switchType,
    inputRef: { current: { focus } },
  });
  const { result } = renderHook(() => exports.useSelect());
  return { select: result.current, promptRef, setPrompt, saveActiveTaskbarDraft, overwritten, confirm, switchType, focus, refs, uploads, selected };
}

describe('AIInputBar history prompt insertion', () => {
  it.each([
    ['', '新的描述'],
    ['已有描述', '已有描述\n新的描述'],
    ['已有描述\n', '已有描述\n新的描述'],
    ['@参考图 保持主体', '@参考图 保持主体\n新的描述'],
  ])('preserves the draft and references when appending to %j', async (initial, expected) => {
    const h = harness(initial);
    await act(async () => h.select({ content: ' 新的描述 ', modelType: 'video' }));
    expect(h.promptRef.current).toBe(expected);
    expect(h.setPrompt).toHaveBeenLastCalledWith(expected);
    expect(h.saveActiveTaskbarDraft).toHaveReturnedWith({
      prompt: expected, refs: h.refs, uploads: h.uploads, selected: h.selected,
    });
    expect(h.overwritten).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.switchType).not.toHaveBeenCalled();
    expect(h.focus).toHaveBeenCalledOnce();
  });

  it('appends repeated selections using the latest prompt without losing the earlier insertion', () => {
    const h = harness('保持主体');
    act(() => {
      h.select({ content: '暖色' });
      h.select({ content: '写实' });
    });
    expect(h.promptRef.current).toBe('保持主体\n暖色\n写实');
  });

  it('ignores blank history content', () => {
    const h = harness('保留原文');
    act(() => h.select({ content: '  \n ' }));
    expect(h.promptRef.current).toBe('保留原文');
    expect(h.setPrompt).not.toHaveBeenCalled();
    expect(h.saveActiveTaskbarDraft).not.toHaveBeenCalled();
  });
});
