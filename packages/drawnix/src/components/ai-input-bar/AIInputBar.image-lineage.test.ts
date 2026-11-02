import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createBoard, RectangleClient, Transforms } from '@plait/core';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import {
  createCanvasAssociationLines,
  isCanvasAssociationLine,
  retargetCanvasAssociationLines,
} from '../../plugins/canvas-association';
import { snapshotCanvasAssociationRefs } from './canvas-association-state';
import { buildBoundTargetGenerationParams } from './target-bound-taskbar-state';
import { processSelectedContentForAI } from '../../utils/selection-utils';
import { prepareImageGenerationReferences, type GenerationReferenceImage } from '../../services/canvas-operations/image-generation-references';
import { resolveImageLineagePositions } from '../../utils/image-generation-lineage-placement';
import { resolveImageAnchorInsertionPoint } from '../../utils/image-generation-anchor-insertion';

// Reuse the existing AST harness convention to check actual submission wiring
// without starting providers, MCP initialization, or a real paid generation.
const source = readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8');
const tree = ts.createSourceFile(
  'AIInputBar.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const names = new Set([
  'getCanvasAssociationLineContext',
  'getWorkflowCanvasAssociationLineContext',
  'linkWorkflowCanvasAssociationsToTaskTarget',
]);
const functions: string[] = [];
let replacementDeclaration = '';
let selectionLoop = '';
let referencePreparation = '';
let requestReferences = '';
let plannedPositions = '';
function visit(node: ts.Node) {
  if (ts.isForOfStatement(node) && node.expression.getText(tree) === 'processedContent.remainingImages') selectionLoop = node.getText(tree);
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
    functions.push(node.getText(tree));
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'imageBoundTargetGenerationParams'
  )
    replacementDeclaration = `let ${node.getText(tree)};`;
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'referenceSources')
    referencePreparation = `const ${node.getText(tree)};`;
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'referenceImages' && node.initializer?.getText(tree) === '[...selection.images, ...selection.graphics]')
    requestReferences = `const ${node.getText(tree)};`;
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'plannedAnchorPositions')
    plannedPositions = `const ${node.getText(tree)};`;
  ts.forEachChild(node, visit);
}
visit(tree);
if (functions.length !== names.size || !replacementDeclaration || !selectionLoop || !referencePreparation || !requestReferences || !plannedPositions)
  throw new Error('Image submission declarations not found');
const compiled = ts.transpileModule(
  `
${functions.join('\n')}
exports.link = linkWorkflowCanvasAssociationsToTaskTarget;
exports.selected = function(processedContent, selectedElements) {
  const content = [];
  ${selectionLoop}
  return content;
};
exports.params = function(activeBoundImageTarget, effectiveSelectedCount, boundImageMaskEdit) {
  ${replacementDeclaration}
  return imageBoundTargetGenerationParams;
};
exports.prepare = async function(submittedBoard, imageItems, enabled) {
  const submittedDraftBoardId = 'board';
  const graphicsItems = [];
  const resolvedCanvasAssociations = [];
  const SelectionWatcherBoardRef = { current: submittedBoard };
  const activeTaskbarBoardIdRef = { current: submittedDraftBoardId };
  const readAutoInsertReferenceImagesEnabled = () => enabled;
  const isSubmittedBoardCurrent = () => true;
  const selection = { images: imageItems.map(item => item.url), graphics: [] };
  ${requestReferences}
  ${referencePreparation}
  return { ...referenceSources, referenceImages };
};
exports.plan = function(board, imageSourceIds, enabled, requestedCount) {
  const anchorTargetFrameId = undefined;
  const targetFrameId = undefined;
  const replacementBoundImageTarget = null;
  const reservedInsertSize = { width: 400, height: 600 };
  const viewportCenterX = 200;
  const viewportCenterY = 0;
  const readHorizontalImageBatchEnabled = () => enabled;
  ${plannedPositions}
  return plannedAnchorPositions;
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;

const callbacks = {} as {
  plan: (board: ReturnType<typeof createBoard>, sources: string[], enabled: boolean, count: number) => [number, number][];
  prepare: (board: ReturnType<typeof createBoard>, images: GenerationReferenceImage[], enabled: boolean) => Promise<{ imageSourceIds: string[]; referenceImages: string[] }>;
  selected: (processed: Awaited<ReturnType<typeof processSelectedContentForAI>>, elements: ReturnType<typeof createBoard>['children']) => GenerationReferenceImage[];
  params: (
    target: Record<string, unknown>,
    count: number,
    mask?: unknown
  ) => Record<string, unknown> | null;
  link: (
    board: ReturnType<typeof createBoard>,
    workflow: { id: string; metadata: Record<string, unknown> },
    targetId: string,
    boardId: string
  ) => number;
};
runInNewContext(compiled, {
  exports: callbacks,
  createCanvasAssociationLines,
  snapshotCanvasAssociationRefs,
  buildBoundTargetGenerationParams,
  prepareImageGenerationReferences,
  resolveImageLineagePositions,
  isVideoUrl: () => false,
  console,
});

describe('main image generation lineage wiring', () => {
  it.each([true, false])('passes the current batch layout into actual placeholder planning: horizontal=%s', (enabled) => {
    const current = createBoard([]);
    const positions = callbacks.plan(current, [], enabled, 5);
    expect(positions).toEqual(Array.from({ length: 5 }, (_, index) =>
      enabled ? [index * 440, 0] : [0, index * 640]
    ));
  });

  it('keeps horizontal result slots and source lines when tasks finish in reverse order', () => {
    const current = createBoard([{
      id: 'source', type: 'image', points: [[0, 0], [400, 400]],
    }]);
    current.getRectangle = (element) => RectangleClient.getRectangleByPoints(element.points || []);
    const positions = callbacks.plan(current, ['source'], true, 3);
    const anchors = positions.map((position, index) => ({
      id: `anchor-${index}`, type: 'generation-anchor', workflowId: 'workflow',
      points: [position, [position[0] + 168, position[1] + 72]] as [[number, number], [number, number]],
      expectedInsertPosition: position,
      reservedInsertSize: { width: 400, height: 600 },
    }));
    anchors.forEach((anchor) => Transforms.insertNode(current, anchor, [current.children.length]));
    const workflow = { id: 'workflow', metadata: { canvasAssociations: [{
      referenceId: 'ref', boardId: 'board', elementId: 'source', kind: 'image', label: '来源',
    }] } };
    callbacks.link(current, workflow, anchors[0].id, 'board');
    // A later request can use a different layout without changing existing slots.
    callbacks.plan(current, ['source'], false, 3);
    for (const index of [2, 1, 0]) {
      const anchor = anchors[index];
      const point = resolveImageAnchorInsertionPoint({ anchor });
      expect(point).toEqual(positions[index]);
      if (!point) throw new Error('Missing planned position');
      Transforms.insertNode(current, {
        id: `result-${index}`, type: 'image',
        points: [point, [point[0] + 400, point[1] + 600]],
      }, [current.children.length]);
      retargetCanvasAssociationLines(current, {
        boardId: 'board', sourceElementIds: ['source'], resultElementId: `result-${index}`,
        workflowId: 'workflow', previousResultElementId: anchor.id,
      });
    }
    expect(current.children.filter((element) => element.id.startsWith('result-')).map((element) => element.points[0])).toEqual([...positions].reverse());
    expect(current.children.filter(isCanvasAssociationLine).map((line) => line.canvasAssociation.resultElementId).sort()).toEqual(['result-0', 'result-1', 'result-2']);
  });

  it('uses the current insertion preference without dropping off-canvas request images', async () => {
    const current = createBoard([]);
    const url = 'data:image/png;base64,bG9jYWw=';
    const prepared = await callbacks.prepare(current, [{ url }], false);
    expect(current.children).toEqual([]);
    expect(prepared.imageSourceIds).toEqual([]);
    expect(prepared.referenceImages).toEqual([url]);
  });

  it('keeps both source IDs from real selection extraction through submission and placeholder lines when URLs match', async () => {
    const image = { id: 'top', type: 'image', url: '/__aitu_cache__/image/shared.png', width: 100, height: 100, points: [[0, 0], [100, 100]] };
    const other = { ...image, id: 'bottom', points: [[0, 200], [100, 300]] };
    const current = createBoard([image, other]);
    current.getRectangle = (element) => RectangleClient.getRectangleByPoints(element.points || []);
    const processed = await processSelectedContentForAI(current, ['bottom', 'top']);
    // The actual input-bar loop must not recover both entries with URL.find().
    const images = callbacks.selected(processed, [other, image]);
    expect(images.map((item) => item.sourceElementId)).toEqual(['top', 'bottom']);
    const prepared = await prepareImageGenerationReferences({ board: current, boardId: 'board', images, associations: [], emptyPosition: [0, 0], boardGuard: () => true });
    expect(prepared.imageSourceIds).toEqual(['top', 'bottom']);
    Transforms.insertNode(current, { id: 'anchor', type: 'generation-anchor', workflowId: 'workflow', points: [[500, 0], [900, 400]] }, [current.children.length]);
    expect(callbacks.link(current, { id: 'workflow', metadata: { canvasAssociations: prepared.references } }, 'anchor', 'board')).toBe(2);
    expect(current.children.filter(isCanvasAssociationLine).map((line) => line.canvasAssociation.sourceElementId).sort()).toEqual(['bottom', 'top']);
    expect(current.children.filter(isCanvasAssociationLine).every((line) => line.canvasAssociation.resultElementId === 'anchor')).toBe(true);
  });
  it('keeps ordinary single-image generation as a new result rather than a replacement', () => {
    expect(
      callbacks.params(
        { type: 'image', elementId: 'source', prompt: '原图' },
        1
      )
    ).toBeNull();
    expect(
      callbacks.params(
        { type: 'image', elementId: 'source', prompt: '原图' },
        1,
        { url: '/source.png', maskImage: '/mask.png' }
      )
    ).toBeNull();
  });

  it('preserves the explicit semantic replacement path', () => {
    expect(
      callbacks.params(
        {
          type: 'image',
          elementId: 'source',
          prompt: '原图',
          semanticReplacement: {},
        },
        1
      )
    ).toMatchObject({ replaceElementId: 'source', targetElementId: 'source' });
  });

  it('links every independent batch placeholder, without duplicate lines on handoff', () => {
    const current = createBoard([
      {
        id: 'source',
        type: 'image',
        points: [
          [0, 0],
          [400, 400],
        ],
      },
      {
        id: 'anchor-1',
        type: 'generation-anchor',
        workflowId: 'workflow',
        points: [
          [520, 0],
          [920, 400],
        ],
      },
      {
        id: 'anchor-2',
        type: 'generation-anchor',
        workflowId: 'workflow',
        points: [
          [520, 640],
          [920, 1040],
        ],
      },
      {
        id: 'unrelated',
        type: 'generation-anchor',
        workflowId: 'other',
        points: [
          [1200, 0],
          [1600, 400],
        ],
      },
    ]);
    current.getRectangle = (element) =>
      RectangleClient.getRectangleByPoints(element.points || []);
    const workflow = {
      id: 'workflow',
      metadata: {
        canvasAssociations: [
          {
            referenceId: 'ref',
            boardId: 'board',
            elementId: 'source',
            kind: 'image',
            label: '来源',
          },
        ],
      },
    };
    expect(callbacks.link(current, workflow, 'anchor-1', 'board')).toBe(2);
    expect(callbacks.link(current, workflow, 'anchor-1', 'board')).toBe(2);
    const lines = current.children.filter(isCanvasAssociationLine);
    expect(lines).toHaveLength(2);
    expect(
      lines.map((line) => line.canvasAssociation.resultElementId).sort()
    ).toEqual(['anchor-1', 'anchor-2']);
    expect(callbacks.link(current, workflow, 'anchor-1', 'other-board')).toBe(
      0
    );
    // Later slots can complete first without taking the earlier slot's line.
    Transforms.insertNode(current, { id: 'result-2', type: 'image', points: [[520, 640], [920, 1040]] }, [current.children.length]);
    retargetCanvasAssociationLines(current, { boardId: 'board', sourceElementIds: ['source'], resultElementId: 'result-2', workflowId: 'workflow', previousResultElementId: 'anchor-2' });
    expect(current.children.filter(isCanvasAssociationLine).map((line) => line.canvasAssociation.resultElementId).sort()).toEqual(['anchor-1', 'result-2']);
    Transforms.insertNode(current, { id: 'result-1', type: 'image', points: [[520, 0], [920, 400]] }, [current.children.length]);
    retargetCanvasAssociationLines(current, { boardId: 'board', sourceElementIds: ['source'], resultElementId: 'result-1', workflowId: 'workflow', previousResultElementId: 'anchor-1' });
    expect(current.children.filter(isCanvasAssociationLine).map((line) => line.canvasAssociation.resultElementId).sort()).toEqual(['result-1', 'result-2']);
  });
});
