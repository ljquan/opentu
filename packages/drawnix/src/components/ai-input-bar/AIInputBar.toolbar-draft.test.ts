import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';
import * as taskbar from './target-bound-taskbar-state';

// Run the real prefill, detach and selection callbacks together so a successful
// thumbnail check cannot hide a regression in the source prompt lifecycle.
const source = readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8');
const tree = ts.createSourceFile(
  'AIInputBar.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const names = [
  'handleAIInputPrefill',
  'handleBoundImageTargetChange',
  'detachTaskbarDraft',
  'handleCanvasPointer',
];
const declarations = new Map<string, string>();
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    names.includes(node.name.text)
  ) {
    declarations.set(node.name.text, `const ${node.getText(tree)};`);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (declarations.size !== names.length)
  throw new Error('Taskbar callbacks not found');
const compiled = ts.transpileModule(
  `${[...declarations.values()].join('\n')}
exports.prefill = handleAIInputPrefill;
exports.select = handleBoundImageTargetChange;
exports.clickCanvas = handleCanvasPointer;`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;
const target = {
  elementId: 'source',
  type: 'image',
  url: '/source.png',
  prompt: '生成一张好看的风景图片',
  referenceOnly: false,
};
type Draft = {
  prompt: string;
  uploadedContent: unknown[];
  knowledgeContextRefs: unknown[];
};
const empty = (): Draft => ({
  prompt: '',
  uploadedContent: [],
  knowledgeContextRefs: [],
});
function harness(initialPrompt = '', approved = true) {
  const promptRef = { current: initialPrompt };
  const uploadedContentRef = { current: [] as unknown[] };
  const knowledgeContextRefsRef = { current: [] as unknown[] };
  const boundImageTargetRef = { current: target as typeof target | null };
  const activeDraftElementIdRef = {
    current: target.elementId as string | null,
  };
  const activeDraftBaselineRef = { current: empty() as Draft | null };
  const boundTargetDraftsRef = {
    current: new Map<string, { draft: Draft; baseline: Draft }>(),
  };
  const unboundTaskbarDraftRef = { current: empty() };
  const canvasToolbarPrefillElementIdRef = { current: null as string | null };
  const dismissedPromptElementIdRef = { current: null as string | null };
  const suggestion = { current: null as string | null };
  const readDraft = (): Draft => ({
    prompt: promptRef.current,
    uploadedContent: [...uploadedContentRef.current],
    knowledgeContextRefs: [...knowledgeContextRefsRef.current],
  });
  const applyTaskbarDraft = (draft: Draft) => {
    promptRef.current = draft.prompt;
    uploadedContentRef.current = draft.uploadedContent;
    knowledgeContextRefsRef.current = draft.knowledgeContextRefs;
  };
  const saveActiveTaskbarDraft = () => {
    const draft = readDraft();
    if (activeDraftElementIdRef.current && activeDraftBaselineRef.current) {
      taskbar.storeBoundTargetTaskbarDraft(
        boundTargetDraftsRef.current,
        activeDraftElementIdRef.current,
        draft,
        activeDraftBaselineRef.current
      );
    } else unboundTaskbarDraftRef.current = draft;
    return draft;
  };
  const applyCanvasAssociationPromptOverwrite = (prompt: string) => {
    dismissedPromptElementIdRef.current =
      boundImageTargetRef.current?.elementId || null;
    suggestion.current = null;
    promptRef.current = prompt;
  };
  const callbacks = {} as {
    prefill: (event: unknown) => Promise<void>;
    select: (next: typeof target | null) => void;
    clickCanvas: () => void;
  };
  runInNewContext(compiled, {
    ...taskbar,
    exports: callbacks,
    useCallback: (fn: unknown) => fn,
    promptRef,
    uploadedContentRef,
    knowledgeContextRefsRef,
    boundImageTargetRef,
    activeDraftElementIdRef,
    activeDraftBaselineRef,
    boundTargetDraftsRef,
    unboundTaskbarDraftRef,
    canvasToolbarPrefillElementIdRef,
    dismissedPromptElementIdRef,
    dismissedPromptGenerationTaskIdRef: { current: null },
    lastBoundImageTargetKeyRef: {
      current: taskbar.createBoundImageTargetStateKey(target, 'follow'),
    },
    suppressedBoundImageElementIdRef: { current: null },
    canvasAssociationRefsRef: { current: [] },
    unboundCanvasAssociationDraftRef: { current: [] },
    selectedContentRef: { current: [] },
    suppressSelectionContentUrlsRef: { current: new Set() },
    selectedFrameRef: { current: null },
    selectedParamsRef: { current: {} },
    selectedParamScopeRef: { current: '' },
    currentBoardId: 'board',
    generationType: 'image',
    selectedModel: 'model',
    language: 'zh',
    imageModels: [],
    videoModels: [],
    audioModels: [],
    textModels: [],
    confirmOverwriteInputIfNeeded: async () => approved,
    findMatchingSelectableModel: () => null,
    resolvePreferredModelSelection: () => null,
    getModelRefFromConfig: () => null,
    getSelectionKey: () => 'model',
    loadScopedAIInputModelParams: () => ({}),
    normalizeKnowledgeContextRefs: () => [],
    normalizeAIInputImageUrl: (url: string) => url,
    createBoundImageInputDraft: empty,
    saveActiveTaskbarDraft,
    applyTaskbarDraft,
    applyCanvasAssociationDraft: vi.fn(),
    applyCanvasAssociationPromptOverwrite,
    resetBoundTaskbarDraftsForBoard: vi.fn(),
    pruneBoundTargetTaskbarDrafts: vi.fn(),
    updatePromptSuggestion: (value: string | null) => {
      suggestion.current = value;
    },
    setBoundImageTarget: vi.fn(),
    setBoundImageTargetMode: vi.fn(),
    setBoundTargetError: vi.fn(),
    setBoundInputLayoutTick: vi.fn(),
    setSelectedContent: vi.fn(),
    setGenerationType: vi.fn(),
    setUploadedContent: vi.fn(),
    setSelectedModel: vi.fn(),
    setSelectedModelRef: vi.fn(),
    setKnowledgeContextRefs: vi.fn(),
    setSelectedParams: vi.fn(),
    setSelectedCount: vi.fn(),
    MessagePlugin: { success: vi.fn() },
    focusInput: vi.fn(),
  });
  const prefill = () =>
    callbacks.prefill({
      detail: {
        source: 'canvas-toolbar',
        generationType: 'image',
        prompt: '视角编辑新指令',
        images: [
          {
            url: target.url,
            name: '视角参考图',
            sourceElementId: target.elementId,
          },
        ],
      },
    });
  return {
    ...callbacks,
    prefill,
    promptRef,
    suggestion,
    boundTargetDraftsRef,
    unboundTaskbarDraftRef,
    activeDraftElementIdRef,
    canvasToolbarPrefillElementIdRef,
    applyCanvasAssociationPromptOverwrite,
  };
}
describe('toolbar prefill and source prompt drafts', () => {
  it('keeps angle input through viewport refresh, then restores the original space-to-reuse suggestion on clicking the image', async () => {
    const h = harness();
    await h.prefill();
    expect(h.promptRef.current).toBe('视角编辑新指令');
    expect(h.activeDraftElementIdRef.current).toBeNull();
    h.select(target);
    expect(h.promptRef.current).toBe('视角编辑新指令');
    h.clickCanvas();
    h.select(target);
    expect(h.promptRef.current).toBe('');
    expect(h.suggestion.current).toBe(target.prompt);
    expect(h.boundTargetDraftsRef.current.has(target.elementId)).toBe(false);
    expect(h.unboundTaskbarDraftRef.current.prompt).toBe('视角编辑新指令');
    expect(
      taskbar.resolveBoundTargetPromptSuggestionAction({
        suggestion: h.suggestion.current,
        currentPrompt: h.promptRef.current,
        key: ' ',
        code: 'Space',
      })
    ).toBe('reuse');
    h.applyCanvasAssociationPromptOverwrite(h.suggestion.current ?? '');
    expect(h.promptRef.current).toBe(target.prompt);
  });
  it('preserves a manually edited source draft instead of replacing it with the angle prompt', async () => {
    const h = harness('用户手写草稿');
    await h.prefill();
    h.clickCanvas();
    h.select(target);
    expect(h.promptRef.current).toBe('用户手写草稿');
    expect(h.suggestion.current).toBeNull();
  });
  it('keeps toolbar input when deselecting and shows the original suggestion after reselecting', async () => {
    const h = harness();
    await h.prefill();
    h.clickCanvas();
    h.select(null);
    expect(h.promptRef.current).toBe('视角编辑新指令');
    h.clickCanvas();
    h.select(target);
    expect(h.promptRef.current).toBe('');
    expect(h.suggestion.current).toBe(target.prompt);
  });
  it('leaves the current source draft and ownership unchanged if overwrite is cancelled', async () => {
    const h = harness('保留草稿', false);
    await h.prefill();
    expect(h.promptRef.current).toBe('保留草稿');
    expect(h.activeDraftElementIdRef.current).toBe(target.elementId);
    expect(h.canvasToolbarPrefillElementIdRef.current).toBeNull();
  });
});
