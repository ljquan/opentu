import {
  createCanvasAssociationLines,
  isCanvasAssociationLine,
  retargetCanvasAssociationLines,
  withCanvasAssociation,
} from '../plugins/canvas-association';
import {
  createTestingBoard,
  IS_BOARD_ALIVE,
  PlaitHistoryBoard,
  RectangleClient,
  Transforms,
  withHistory,
} from '@plait/core';
import { describe, expect, it } from 'vitest';
import {
  wasGenerationProgressRestored,
  consumeGenerationDraft,
  draftFromGenerationProgress,
  getGenerationSlotPositions,
  readGenerationOrigin,
  remapGenerationOrigin,
  restoreGenerationDraft,
} from './generation-node-lifecycle';
import { GenerationNodeElement, isGenerationNode } from './generation-node';
import {
  reconcileGenerationInputLines,
  withGenerationNode,
  isGenerationInputLine,
} from '../plugins/with-generation-node';
import { ImageGenerationAnchorTransforms } from '../components/image-generation-anchor/image-generation-anchor.transforms';
import { WorkZoneTransforms } from '../plugins/workzone-transforms';

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture(type: 'image' | 'video' = 'image') {
  const source = {
    id: 'source',
    type: 'image',
    url: '/ref.png',
    points: [
      [0, 0],
      [100, 100],
    ],
  };
  const draft: GenerationNodeElement = {
    id: 'draft',
    type: 'geometry',
    shape: 'roundRectangle',
    angle: 0,
    points: [
      [300, 40],
      [644, 264],
    ],
    generationNode: {
      version: 1,
      generationType: type,
      prompt: 'Original prompt',
      model: 'original-model',
      params: { size: '1:1', seed: '7' },
      count: 2,
      references: [
        {
          referenceId: 'ref',
          role: type === 'video' ? 'first-frame' : 'reference',
          url: '/ref.png',
          sourceElementId: 'source',
          name: 'original',
        },
      ],
    },
  };
  const board = createTestingBoard(
    [
      withHistory,
      (board) => {
        board.getRectangle = (element) =>
          RectangleClient.getRectangleByPoints(element.points!);
        return board;
      },
      withGenerationNode,
      withCanvasAssociation,
    ],
    [source, draft] as any
  );
  IS_BOARD_ALIVE.set(board, true);
  PlaitHistoryBoard.withoutSaving(board, () =>
    reconcileGenerationInputLines(board)
  );
  const makeAnchor = () =>
    ImageGenerationAnchorTransforms.insertAnchor(board, {
      position: [300, 40],
      workflowId: 'workflow',
      size: { width: 400, height: 400 },
      zoom: 1,
    });
  return { board, draft, makeAnchor };
}

describe('in-place draft lifecycle', () => {
  it('replaces draft and its input wires as one reversible batch without changing inputs', async () => {
    const { board, draft, makeAnchor } = fixture();
    await flush();
    const anchor = makeAnchor();
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [anchor.id],
      'board'
    );
    await flush();
    expect(board.children.filter(isGenerationNode)).toHaveLength(0);
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(0);
    expect(
      readGenerationOrigin(board.children.find((el) => el.id === anchor.id))
        ?.draft.generationNode
    ).toEqual(draft.generationNode);
    board.undo();
    await flush();
    expect(board.children.filter(isGenerationNode)).toHaveLength(1);
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
    expect(board.children.some((el) => el.id === anchor.id)).toBe(false);
    board.redo();
    await flush();
    expect(board.children.filter(isGenerationNode)).toHaveLength(0);
    expect(board.children.filter((el) => el.id === anchor.id)).toHaveLength(1);
  });

  it('retains original inputs on inserted outputs and restores history after terminal progress removal', async () => {
    const { board, draft, makeAnchor } = fixture();
    await flush();
    const anchor = makeAnchor();
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [anchor.id],
      'board'
    );
    await flush();
    PlaitHistoryBoard.withNewBatch(board, () =>
      Transforms.insertNode(
        board,
        {
          id: 'result',
          type: 'image',
          url: '/result.png',
          generationNodeId: draft.id,
          points: [
            [300, 40],
            [700, 440],
          ],
        } as any,
        [board.children.length]
      )
    );
    await flush();
    expect(
      readGenerationOrigin(board.children.find((el) => el.id === 'result'))
        ?.draft.generationNode.references[0].url
    ).toBe('/ref.png');
    ImageGenerationAnchorTransforms.removeAnchor(board, anchor.id);
    await flush();
    expect(
      board.children
        .filter((el) => !isCanvasAssociationLine(el))
        .map((el) => el.id)
    ).toEqual(['source', 'result']);
    board.undo();
    await flush();
    expect(board.children.some((el) => el.id === anchor.id)).toBe(true);
    board.undo();
    await flush();
    expect(board.children.some((el) => el.id === 'result')).toBe(false);
    board.undo();
    await flush();
    expect(board.children.filter(isGenerationNode)).toHaveLength(1);
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
    board.redo();
    await flush();
    board.redo();
    await flush();
    board.redo();
    await flush();
    expect(
      board.children
        .filter((el) => !isCanvasAssociationLine(el))
        .map((el) => el.id)
    ).toEqual(['source', 'result']);
  });

  it('transfers source connections to progress and then the result, with reversible deletion', async () => {
    const { board, draft, makeAnchor } = fixture();
    await flush();
    const anchor = makeAnchor();
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [anchor.id],
      'board'
    );
    createCanvasAssociationLines(board, {
      boardId: 'board',
      sourceElementIds: ['source'],
      resultElementId: anchor.id,
      workflowId: 'workflow',
    });
    await flush();
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(1);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.insertNode(
        board,
        {
          id: 'output',
          type: 'image',
          url: '/output.png',
          generationNodeId: draft.id,
          points: [
            [300, 40],
            [700, 440],
          ],
        } as any,
        [board.children.length]
      );
      retargetCanvasAssociationLines(board, {
        boardId: 'board',
        sourceElementIds: ['source'],
        resultElementId: 'output',
        workflowId: 'workflow',
      });
    });
    await flush();
    ImageGenerationAnchorTransforms.removeAnchor(board, anchor.id);
    await flush();
    expect(
      board.children
        .filter(isCanvasAssociationLine)
        .map((el) => el.canvasAssociation.resultElementId)
    ).toEqual(['output']);
    for (let i = 0; i < 3; i++) {
      board.undo();
      await flush();
    }
    expect(board.children.filter(isGenerationNode)).toHaveLength(1);
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
    for (let i = 0; i < 3; i++) {
      board.redo();
      await flush();
    }
    expect(board.children.filter(isGenerationNode)).toHaveLength(0);
    expect(
      board.children
        .filter(isCanvasAssociationLine)
        .map((el) => el.canvasAssociation.resultElementId)
    ).toEqual(['output']);
  });

  it('restores a failed batch slot at its moved location after JSON reload, without restarting siblings', async () => {
    const { board, draft, makeAnchor } = fixture();
    await flush();
    const a = makeAnchor(),
      b = makeAnchor();
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [a.id, b.id],
      'board'
    );
    await flush();
    ImageGenerationAnchorTransforms.updateAnchor(board, a.id, {
      phase: 'failed',
      points: [
        [900, 300],
        [1300, 700],
      ],
    });
    await flush();
    const saved = JSON.parse(JSON.stringify(board.children));
    expect(
      readGenerationOrigin(saved.find((el: any) => el.id === a.id))?.draft
        .generationNode.count
    ).toBe(1);
    board.children = saved;
    const restored = restoreGenerationDraft(board, a.id)!;
    await flush();
    expect(restored.points[0]).toEqual([900, 300]);
    expect(restored.generationNode).toEqual({
      ...draft.generationNode,
      count: 1,
    });
    expect(board.children.some((el) => el.id === b.id)).toBe(true);
    expect(board.children.some((el) => el.id === a.id)).toBe(false);
  });

  it('preserves video frame roles and detaches deleted sources when restoring editing', async () => {
    const { board, draft } = fixture('video');
    await flush();
    const workzone = WorkZoneTransforms.insertWorkZone(board, {
      workflow: {
        id: 'workflow',
        name: 'video',
        status: 'failed',
        steps: [],
      } as any,
      position: [300, 40],
      zoom: 1,
    });
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [workzone.id],
      'board'
    );
    await flush();
    Transforms.removeNode(board, [0]);
    await flush();
    const restored = restoreGenerationDraft(board, workzone.id)!;
    await flush();
    expect(restored.generationNode.references[0]).toMatchObject({
      role: 'first-frame',
      url: '/ref.png',
      sourceElementId: undefined,
    });
    expect(restored.generationNode.model).toBe('original-model');
  });

  it('inherits video inputs by task identity even when an older task lacks generationNodeId', async () => {
    const { board, draft } = fixture('video');
    await flush();
    const zone = WorkZoneTransforms.insertWorkZone(board, {
      workflow: {
        id: 'workflow',
        name: 'video',
        status: 'running',
        steps: [
          { id: 'step', status: 'running', result: { taskId: 'video-task' } },
        ],
      } as any,
      position: [300, 40],
      zoom: 1,
    });
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [zone.id],
      'board'
    );
    expect(
      board.children
        .filter(isCanvasAssociationLine)
        .map((el) => el.canvasAssociation.resultElementId)
    ).toEqual([zone.id]);
    await flush();
    Transforms.insertNode(
      board,
      {
        id: 'video',
        type: 'image',
        isVideo: true,
        url: '/video.mp4',
        points: [
          [300, 40],
          [700, 265],
        ],
      } as any,
      [board.children.length]
    );
    Transforms.setNode(board, { generationTaskId: 'video-task' }, [
      board.children.length - 1,
    ]);
    await flush();
    const result = board.children.find((el) => el.id === 'video')!;
    expect(readGenerationOrigin(result)?.draft.generationNode).toEqual(
      draft.generationNode
    );
    expect(result.generationNodeId).toBe(draft.id);
    expect(
      board.children
        .filter(isCanvasAssociationLine)
        .map((el) => el.canvasAssociation.resultElementId)
    ).toEqual(['video']);
  });

  it('keeps completion cleanup from erasing redo after a terminal anchor is restored', async () => {
    const { board, draft, makeAnchor } = fixture();
    await flush();
    const anchor = makeAnchor();
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [anchor.id],
      'board'
    );
    await flush();
    ImageGenerationAnchorTransforms.updateAnchor(board, anchor.id, {
      phase: 'completed',
    });
    await flush();
    ImageGenerationAnchorTransforms.removeAnchor(board, anchor.id);
    await flush();
    board.undo();
    await flush();
    expect(wasGenerationProgressRestored(board, anchor.id)).toBe(true);
    board.undo();
    await flush();
    board.redo();
    await flush();
    expect(wasGenerationProgressRestored(board, anchor.id)).toBe(false);
  });

  it('keeps failed or history-restored video progress and waits for actual result insertion', async () => {
    const { board, draft } = fixture('video');
    await flush();
    const zone = WorkZoneTransforms.insertWorkZone(board, {
      workflow: {
        id: 'workflow',
        status: 'completed',
        steps: [
          { id: 'step', status: 'completed', result: { taskId: 'task' } },
        ],
      } as any,
      position: [300, 40],
      zoom: 1,
    });
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [zone.id],
      'board'
    );
    await flush();
    WorkZoneTransforms.removeWorkZone(board, zone.id, { automatic: true });
    expect(board.children.some((el) => el.id === zone.id)).toBe(true);
    Transforms.insertNode(
      board,
      {
        id: 'video-output',
        type: 'image',
        url: '/result.mp4#video',
        generationTaskId: 'task',
        points: [
          [300, 40],
          [700, 265],
        ],
      } as any,
      [board.children.length]
    );
    await flush();
    WorkZoneTransforms.updateWorkflow(board, zone.id, { status: 'failed' });
    WorkZoneTransforms.removeWorkZone(board, zone.id, { automatic: true });
    expect(board.children.some((el) => el.id === zone.id)).toBe(true);
    WorkZoneTransforms.updateWorkflow(board, zone.id, { status: 'cancelled' });
    WorkZoneTransforms.removeWorkZone(board, zone.id, { automatic: true });
    expect(board.children.some((el) => el.id === zone.id)).toBe(true);
    WorkZoneTransforms.updateWorkflow(board, zone.id, { status: 'completed' });
    await flush();
    WorkZoneTransforms.removeWorkZone(board, zone.id, { automatic: true });
    await flush();
    expect(board.children.some((el) => el.id === zone.id)).toBe(false);
    board.undo();
    await flush();
    WorkZoneTransforms.removeWorkZone(board, zone.id, { automatic: true });
    await flush();
    expect(board.children.some((el) => el.id === zone.id)).toBe(true);
    board.redo();
    await flush();
    expect(board.children.some((el) => el.id === zone.id)).toBe(false);
  });

  it('copies progress as a draft and detaches origins omitted from a result copy', async () => {
    const { board, draft, makeAnchor } = fixture();
    await flush();
    const anchor = makeAnchor();
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [anchor.id],
      'board'
    );
    await flush();
    const progress = board.children.find((el) => el.id === anchor.id)!;
    const copy = draftFromGenerationProgress(progress);
    expect(isGenerationNode(copy)).toBe(true);
    expect(copy.id).not.toBe(draft.id);
    expect(copy.workflowId).toBeUndefined();
    expect(copy.taskIds).toBeUndefined();
    const remapped = remapGenerationOrigin(
      readGenerationOrigin(progress)!,
      new Map()
    );
    expect(
      remapped.draft.generationNode.references[0].sourceElementId
    ).toBeUndefined();
    expect(remapped.draft.generationNode.references[0].url).toBe('/ref.png');
  });

  it('does not consume a second time or on a different board', async () => {
    const { board, draft, makeAnchor } = fixture();
    await flush();
    const anchor = makeAnchor();
    consumeGenerationDraft(
      board,
      draft.id,
      draft.generationNode,
      [anchor.id],
      'board'
    );
    await flush();
    const snapshot = JSON.stringify(board.children);
    expect(() =>
      consumeGenerationDraft(
        board,
        draft.id,
        draft.generationNode,
        [anchor.id],
        'board'
      )
    ).toThrow('已提交或删除');
    expect(JSON.stringify(board.children)).toBe(snapshot);
    const other = createTestingBoard([withHistory], []);
    expect(() =>
      consumeGenerationDraft(
        other,
        draft.id,
        draft.generationNode,
        [anchor.id],
        'board'
      )
    ).toThrow();
    expect(other.children).toHaveLength(0);
  });

  it('places the first slot in place and reserves nonoverlapping envelopes for subsequent results', () => {
    const { board, draft } = fixture();
    Transforms.insertNode(
      board,
      {
        id: 'obstacle',
        type: 'image',
        points: [
          [740, 40],
          [1140, 640],
        ],
      } as any,
      [board.children.length]
    );
    const size = { width: 400, height: 600 };
    const points = getGenerationSlotPositions(board, draft, size, 4);
    expect(points[0]).toEqual([300, 40]);
    const overlaps = (a: number[], b: number[]) =>
      Math.abs(a[0] - b[0]) < size.width && Math.abs(a[1] - b[1]) < size.height;
    points.forEach((point, index) => {
      for (const prior of points.slice(0, index))
        expect(overlaps(point, prior)).toBe(false);
      if (index) expect(overlaps(point, [740, 40])).toBe(false);
    });
  });
});
