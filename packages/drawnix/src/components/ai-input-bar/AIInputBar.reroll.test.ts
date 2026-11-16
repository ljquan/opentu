import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  findExactSelectableModel,
  findMatchingSelectableModel,
} from '../../utils/model-selection';
import {
  pinBoundTargetReferenceContent,
  shouldUseBoundTargetForSubmission,
} from './target-bound-taskbar-state';

// Execute the actual submit boundary and event handlers without loading providers.
const source = readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8');
const tree = ts.createSourceFile(
  'AIInputBar.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const arrows = new Map<string, ts.ArrowFunction>();
let nextModelDeclaration = '';
let selectedModelRefDeclaration = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    if (
      node.name.text === 'nextModel' &&
      node.getText(tree).includes('modelsForType')
    )
      nextModelDeclaration = node.getText(tree);
    if (node.name.text === 'effectiveSelectedModelRef')
      selectedModelRefDeclaration = node.getText(tree);
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isArrowFunction(node.initializer)
  ) {
    arrows.set(node.name.text, node.initializer);
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer)
  ) {
    const callback = node.initializer.arguments[0];
    if (callback && ts.isArrowFunction(callback))
      arrows.set(node.name.text, callback);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
const generation = arrows.get('handleGenerate')!;
if (!generation || !ts.isBlock(generation.body))
  throw new Error('Missing submit boundary');
const statements = generation.body.statements;
const boundary = statements.findIndex((node) =>
  node.getText(tree).startsWith('const effectiveGenerationType')
);
if (boundary < 0) throw new Error('Missing input boundary');
const code = ts.transpileModule(
  `
exports.submit = async function(triggerOrOverride = 'button') {
  ${statements
    .slice(0, boundary)
    .map((statement) => statement.getText(tree))
    .join('\n')}
  return { content: baseEffectiveContent, activeBoundImageTarget, restoreOriginalInputs };
};
exports.model = function(detail, modelsForType) {
  const restoredInput = detail.intent === 'restore';
  const nextGenerationType = 'image';
  const ${nextModelDeclaration};
  return nextModel;
};
exports.modelRef = function(override, selectedModelRef) {
  const ${selectedModelRefDeclaration};
  return effectiveSelectedModelRef;
};
exports.selection = ${arrows.get('handleSelectionChange')!.getText(tree)};
exports.target = ${arrows.get('handleBoundImageTargetChange')!.getText(tree)};
exports.remove = ${arrows.get('handleRemoveUploadedContent')!.getText(tree)};
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;

function harness(intent?: 'restore') {
  const output = {
    type: 'image',
    elementId: 'd',
    url: '/d.png',
    prompt: 'old',
  };
  const references = ['a', 'b', 'c'].map((id) => ({
    type: 'image',
    name: id,
    url: `/${id}.png`,
  }));
  const inputIntentRef = { current: intent };
  const uploadedContentRef = { current: references };
  const setSelectedContent = vi.fn();
  const setUploadedContent = vi.fn();
  const callbacks = {} as {
    model: (detail: unknown, models: unknown[]) => unknown;
    modelRef: (override: unknown, selected: unknown) => unknown;
    submit: (override?: unknown) => Promise<{
      content: typeof references;
      activeBoundImageTarget: unknown;
      restoreOriginalInputs: boolean;
    }>;
    selection: (content: unknown[]) => void;
    target: (target: unknown) => void;
    remove: (index: number) => void;
  };
  runInNewContext(code, {
    exports: callbacks,
    generationNodeEditor: { activeRef: { current: null } },
    prompt: 'same prompt',
    inputIntentRef,
    SelectionWatcherBoardRef: { current: null },
    generationType: 'image',
    effectiveBoundTargetMode: 'reference',
    boundImageTarget: output,
    boundTargetContent: output,
    language: 'zh',
    generationContent: references,
    uploadedContent: references,
    uploadedContentRef,
    setUploadedContent,
    setSelectedContent,
    selectedContent: [output],
    suppressSelectionContentUrlsRef: { current: new Set() },
    shouldUseBoundTargetForSubmission,
    pinBoundTargetReferenceContent,
    findExactSelectableModel,
    findMatchingSelectableModel,
    selectedContentFromBoundTarget: (target: unknown) => target,
    currentBoardId: 'board',
    resetBoundTaskbarDraftsForBoard: vi.fn(),
  });
  return {
    callbacks,
    references,
    output,
    setSelectedContent,
    uploadedContentRef,
    setUploadedContent,
  };
}

describe('reroll submission isolation', () => {
  it('does not silently replace an unavailable original channel with the same model on another channel', () => {
    const { callbacks } = harness();
    const original = {
      intent: 'restore',
      model: 'gpt-image-2',
      modelRef: { modelId: 'gpt-image-2', profileId: 'original-channel' },
    };
    const other = { id: 'gpt-image-2', sourceProfileId: 'another-channel' };
    expect(callbacks.model(original, [other])).toBeUndefined();
    const expected = { ...other, sourceProfileId: 'original-channel' };
    expect(callbacks.model(original, [other, expected])).toBe(expected);
  });
  it('a legacy reroll without a channel does not inherit the current input bar channel', () => {
    const { callbacks } = harness();
    expect(
      callbacks.modelRef(
        { intent: 'restore' },
        { modelId: 'other', profileId: 'current' }
      )
    ).toBeNull();
  });
  it('a one-click override never inherits the selected output, including reference-only mode', async () => {
    const { callbacks, references } = harness();
    const submitted = await callbacks.submit({
      intent: 'restore',
      prompt: 'original',
      content: references,
      generationType: 'image',
    });
    expect(submitted.content.map((item) => item.url)).toEqual([
      '/a.png',
      '/b.png',
      '/c.png',
    ]);
    expect(submitted.activeBoundImageTarget).toBeNull();
  });
  it('manual submission of a restored draft uses the same isolated inputs', async () => {
    const { callbacks, references } = harness('restore');
    expect((await callbacks.submit()).content).toEqual(references);
    expect((await callbacks.submit()).activeBoundImageTarget).toBeNull();
  });
  it('selection refresh cannot restore a removed image or rebind the output', () => {
    const { callbacks, output, uploadedContentRef, setSelectedContent } =
      harness('restore');
    callbacks.remove(1);
    callbacks.selection([output]);
    callbacks.target(output);
    expect(uploadedContentRef.current.map((image) => image.url)).toEqual([
      '/a.png',
      '/c.png',
    ]);
    expect(setSelectedContent).not.toHaveBeenCalled();
  });
  it('existing reference-only generation still includes the selected input outside reroll', async () => {
    const { callbacks, references, output } = harness();
    const submitted = await callbacks.submit({
      prompt: 'edit',
      content: references,
      generationType: 'image',
    });
    expect(submitted.content[0]).toEqual(output);
  });
});

describe('reroll asynchronous board guard', () => {
  const guardCode = ts.transpileModule(
    `exports.abort = ${arrows
      .get('abortIfSubmittedBoardChanged')!
      .getText(tree)}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
  ).outputText;
  it.each([
    {
      override: { intent: 'restore' },
      restoreOriginalInputs: true,
      sameBoard: false,
      aborted: true,
    },
    {
      override: undefined,
      restoreOriginalInputs: true,
      sameBoard: false,
      aborted: true,
    },
    {
      override: { intent: 'restore' },
      restoreOriginalInputs: true,
      sameBoard: true,
      aborted: false,
    },
    {
      override: {},
      restoreOriginalInputs: false,
      sameBoard: false,
      aborted: false,
    },
  ])('guards reroll after async preparation: %j', (scenario) => {
    const callbacks = {} as { abort: (stage: string) => boolean };
    const warning = vi.fn();
    const setIsSubmitting = vi.fn();
    const submitLockRef = { current: true };
    runInNewContext(guardCode, {
      exports: callbacks,
      ...scenario,
      submittedBoard: {},
      submittedDraftBoardId: 'original',
      SelectionWatcherBoardRef: { current: {} },
      activeTaskbarBoardIdRef: {
        current: scenario.sameBoard ? 'original' : 'other',
      },
      isSubmittedBoardCurrent: () => scenario.sameBoard,
      MessagePlugin: { warning },
      language: 'zh',
      trackSubmitStatus: vi.fn(),
      submitLockRef,
      setIsSubmitting,
    });
    expect(callbacks.abort('references')).toBe(scenario.aborted);
    expect(warning).toHaveBeenCalledTimes(scenario.aborted ? 1 : 0);
    expect(submitLockRef.current).toBe(!scenario.aborted);
    if (scenario.aborted) expect(setIsSubmitting).toHaveBeenCalledWith(false);
  });
});
