import {
  createTestingBoard,
  IS_BOARD_ALIVE,
  PlaitHistoryBoard,
  RectangleClient,
  Transforms,
  withHistory,
  type PlaitElement,
} from '@plait/core';
import { describe, expect, it } from 'vitest';
import {
  canInsertCanvasAssociationsOnBoard,
  createCanvasAssociationLines,
  deferCanvasAssociationLines,
  flushDeferredCanvasAssociationLines,
  getCanvasAssociationEndpointPoints,
  isCanvasAssociationCandidate,
  isCanvasAssociationLine,
  isCanvasAssociationTarget,
  reconcileCanvasAssociationLines,
  retargetCanvasAssociationLines,
  withCanvasAssociation,
} from './canvas-association';

interface TestingElement extends PlaitElement {
  points: [[number, number], [number, number]];
  children?: TestingElement[];
}

function createElement(
  id: string,
  points: [[number, number], [number, number]],
  type = 'custom-node',
  children?: TestingElement[]
): TestingElement {
  return { id, type, points, ...(children ? { children } : {}) };
}

function createBoard(children: TestingElement[] = []) {
  return createTestingBoard(
    [
      (board) => {
        board.getRectangle = (element) => {
          if (!element.points) {
            throw new Error(`Missing points for ${element.id}`);
          }
          return RectangleClient.getRectangleByPoints(element.points);
        };
        return board;
      },
    ],
    children
  );
}

function createHistoryBoard(children: TestingElement[] = []) {
  const board = createTestingBoard(
    [
      withHistory,
      (testingBoard) => {
        testingBoard.getRectangle = (element) => {
          if (!element.points) {
            throw new Error(`Missing points for ${element.id}`);
          }
          return RectangleClient.getRectangleByPoints(element.points);
        };
        return testingBoard;
      },
      withCanvasAssociation,
    ],
    children
  );
  IS_BOARD_ALIVE.set(board, true);
  return board;
}

function createMeasuredHistoryBoard(
  children: TestingElement[],
  onMeasure: (element: PlaitElement) => void
) {
  const board = createTestingBoard(
    [
      withHistory,
      (testingBoard) => {
        testingBoard.getRectangle = (element) => {
          onMeasure(element);
          if (!element.points) {
            throw new Error(`Missing points for ${element.id}`);
          }
          return RectangleClient.getRectangleByPoints(element.points);
        };
        return testingBoard;
      },
      withCanvasAssociation,
    ],
    children
  );
  IS_BOARD_ALIVE.set(board, true);
  return board;
}

async function flushBoardChanges() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('canvas association', () => {
  it('only allows associated results on their single source board', () => {
    expect(canInsertCanvasAssociationsOnBoard([], 'board-1')).toBe(true);
    expect(
      canInsertCanvasAssociationsOnBoard([{ boardId: 'board-1' }], 'board-1')
    ).toBe(true);
    expect(
      canInsertCanvasAssociationsOnBoard([{ boardId: 'board-1' }], 'board-2')
    ).toBe(false);
    expect(
      canInsertCanvasAssociationsOnBoard(
        [{ boardId: 'board-1' }, { boardId: 'board-2' }],
        'board-1'
      )
    ).toBe(false);
    expect(
      canInsertCanvasAssociationsOnBoard([{ boardId: 'board-1' }], null)
    ).toBe(false);
  });

  it('flushes a deferred task link only on its source board', () => {
    deferCanvasAssociationLines({
      boardId: 'board-source',
      sourceElementIds: ['source-1'],
      resultElementId: 'task-target-1',
      workflowId: 'workflow-1',
    });
    const otherBoard = createBoard([]);
    expect(flushDeferredCanvasAssociationLines(otherBoard, 'board-other')).toBe(
      0
    );

    const sourceBoard = createBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('task-target-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    expect(
      flushDeferredCanvasAssociationLines(sourceBoard, 'board-source')
    ).toBe(1);
    expect(sourceBoard.children.filter(isCanvasAssociationLine)).toHaveLength(
      1
    );
    expect(
      flushDeferredCanvasAssociationLines(sourceBoard, 'board-source')
    ).toBe(0);
  });

  it('bounds deferred task links and evicts the oldest intent', () => {
    const deferredCount = 257;
    const elements = Array.from({ length: deferredCount }, (_, index) => [
      createElement(`source-${index}`, [
        [0, index * 120],
        [100, index * 120 + 100],
      ]),
      createElement(`target-${index}`, [
        [300, index * 120],
        [400, index * 120 + 100],
      ]),
    ]).flat();

    for (let index = 0; index < deferredCount; index += 1) {
      deferCanvasAssociationLines({
        boardId: 'board-bounded',
        sourceElementIds: [`source-${index}`],
        resultElementId: `target-${index}`,
        workflowId: `workflow-${index}`,
      });
    }

    const board = createBoard(elements);
    expect(flushDeferredCanvasAssociationLines(board, 'board-bounded')).toBe(
      256
    );
    const lines = board.children.filter(isCanvasAssociationLine);
    expect(lines).toHaveLength(256);
    expect(
      lines.some(
        (line) => line.canvasAssociation.sourceElementId === 'source-0'
      )
    ).toBe(false);
    expect(
      lines.some(
        (line) => line.canvasAssociation.sourceElementId === 'source-256'
      )
    ).toBe(true);
  });

  it('returns immediately when the board has no association lines', () => {
    const board = createBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
    ]);

    expect(reconcileCanvasAssociationLines(board)).toEqual({
      removed: 0,
      updated: 0,
    });
  });

  it('removes orphaned persisted lines on load without creating undo history', () => {
    const persistedBoard = createBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(persistedBoard, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'result-1',
    });
    persistedBoard.children = persistedBoard.children.filter(
      (element) => element.id !== 'result-1'
    );

    const board = createHistoryBoard(
      persistedBoard.children as TestingElement[]
    );

    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
    expect(board.history.undos).toHaveLength(0);
  });

  it('uses the facing horizontal edges when the result is to the right', () => {
    expect(
      getCanvasAssociationEndpointPoints(
        { x: 0, y: 10, width: 100, height: 60 },
        { x: 300, y: 20, width: 80, height: 100 }
      )
    ).toEqual([
      [100, 40],
      [300, 70],
    ]);
  });

  it('uses the facing vertical edges when the result is below', () => {
    expect(
      getCanvasAssociationEndpointPoints(
        { x: 100, y: 0, width: 80, height: 100 },
        { x: 110, y: 300, width: 120, height: 60 }
      )
    ).toEqual([
      [140, 100],
      [170, 300],
    ]);
  });

  it('creates persistent unbound lines for custom canvas nodes', () => {
    const board = createBoard([
      createElement(
        'audio-1',
        [
          [0, 0],
          [100, 80],
        ],
        'audio'
      ),
      createElement(
        'card-1',
        [
          [300, 0],
          [500, 160],
        ],
        'card'
      ),
    ]);

    const [line] = createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['audio-1'],
      resultElementId: 'card-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
    });

    expect(board.children).toContain(line);
    expect(isCanvasAssociationLine(line)).toBe(true);
    expect(line.locked).toBe(true);
    expect(line.source.boundId).toBeUndefined();
    expect(line.target.boundId).toBeUndefined();
    expect(line.canvasAssociation).toMatchObject({
      boardId: 'board-1',
      sourceElementId: 'audio-1',
      resultElementId: 'card-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
    });
  });

  it('is idempotent for duplicate sources and completion retries', () => {
    const board = createBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    const options = {
      boardId: 'board-1',
      sourceElementIds: ['source-1', 'source-1'],
      resultElementId: 'result-1',
    };

    const first = createCanvasAssociationLines(board, options);
    const retried = createCanvasAssociationLines(board, options);

    expect(first).toHaveLength(1);
    expect(retried).toEqual(first);
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(1);
  });

  it.each(['generation-anchor', 'workzone'])(
    'allows %s as a task target without allowing it as a source',
    (targetType) => {
      const board = createBoard([
        createElement('source-1', [
          [0, 0],
          [100, 100],
        ]),
        createElement(
          'task-target-1',
          [
            [300, 0],
            [420, 100],
          ],
          targetType
        ),
      ]);

      const [line] = createCanvasAssociationLines(board, {
        boardId: 'board-1',
        sourceElementIds: ['source-1'],
        resultElementId: 'task-target-1',
        workflowId: 'workflow-1',
      });

      expect(line?.canvasAssociation.resultElementId).toBe('task-target-1');
      expect(isCanvasAssociationCandidate(board.children[1])).toBe(false);
      expect(isCanvasAssociationTarget(board.children[1])).toBe(true);
      expect(reconcileCanvasAssociationLines(board)).toEqual({
        removed: 0,
        updated: 0,
      });
    }
  );

  it('retargets the original task line to the final result idempotently', () => {
    const board = createBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement(
        'anchor-1',
        [
          [300, 0],
          [400, 100],
        ],
        'generation-anchor'
      ),
      createElement('result-1', [
        [600, 0],
        [700, 100],
      ]),
    ]);
    const [originalLine] = createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'anchor-1',
      workflowId: 'workflow-1',
    });

    const first = retargetCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      previousResultElementId: 'anchor-1',
      resultElementId: 'result-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
    });
    const retried = retargetCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      previousResultElementId: 'anchor-1',
      resultElementId: 'result-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
    });

    expect(first).toHaveLength(1);
    expect(retried).toHaveLength(1);
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(1);
    const [retargetedLine] = board.children.filter(isCanvasAssociationLine);
    expect(retargetedLine.id).toBe(originalLine.id);
    expect(retargetedLine.canvasAssociation).toMatchObject({
      sourceElementId: 'source-1',
      resultElementId: 'result-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
    });
    expect(retargetedLine.points).toEqual([
      [100, 50],
      [600, 50],
    ]);
  });

  it('keeps the migrated line when the temporary task target is removed', async () => {
    const board = createHistoryBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement(
        'workzone-1',
        [
          [300, 0],
          [400, 100],
        ],
        'workzone'
      ),
      createElement('result-1', [
        [600, 0],
        [700, 100],
      ]),
    ]);
    const [originalLine] = createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'workzone-1',
      workflowId: 'workflow-1',
    });
    await flushBoardChanges();

    retargetCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      previousResultElementId: 'workzone-1',
      resultElementId: 'result-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
    });
    await flushBoardChanges();
    const workzoneIndex = board.children.findIndex(
      (element) => element.id === 'workzone-1'
    );
    Transforms.removeNode(board, [workzoneIndex]);
    await flushBoardChanges();

    const associationLines = board.children.filter(isCanvasAssociationLine);
    expect(associationLines).toHaveLength(1);
    expect(associationLines[0].id).toBe(originalLine.id);
    expect(associationLines[0].canvasAssociation.resultElementId).toBe(
      'result-1'
    );
  });

  it('creates the final line when the temporary task line is already gone', () => {
    const board = createBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);

    const lines = retargetCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      previousResultElementId: 'missing-workzone',
      resultElementId: 'result-1',
      workflowId: 'workflow-1',
      taskId: 'task-1',
    });

    expect(lines).toHaveLength(1);
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(1);
    expect(lines[0].canvasAssociation.resultElementId).toBe('result-1');
  });

  it('updates endpoints after either canvas element moves', () => {
    const board = createBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'result-1',
    });
    const sourceIndex = board.children.findIndex(
      (element) => element.id === 'source-1'
    );
    Transforms.setNode(
      board,
      {
        points: [
          [0, 200],
          [100, 300],
        ],
      },
      [sourceIndex]
    );

    expect(reconcileCanvasAssociationLines(board)).toEqual({
      removed: 0,
      updated: 1,
    });
    expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
      [100, 250],
      [300, 50],
    ]);
  });

  it('rebuilds its index when a reused board receives another board snapshot', async () => {
    const persistedBoard = createBoard([
      createElement('source-b', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-b', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(persistedBoard, {
      boardId: 'board-b',
      sourceElementIds: ['source-b'],
      resultElementId: 'result-b',
    });

    const board = createHistoryBoard([
      createElement('source-a', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-a', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    board.children = persistedBoard.children;

    Transforms.setNode(
      board,
      {
        points: [
          [0, 200],
          [100, 300],
        ],
      },
      [0]
    );
    await flushBoardChanges();

    expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
      [100, 250],
      [300, 50],
    ]);

    Transforms.removeNode(board, [0]);
    await flushBoardChanges();
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
    expect(board.children.some((element) => element.id === 'result-b')).toBe(
      true
    );
  });

  it('rebuilds before a queued reconcile runs on a replacement snapshot', async () => {
    const persistedBoard = createBoard([
      createElement('source-b', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-b', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(persistedBoard, {
      boardId: 'board-b',
      sourceElementIds: ['source-b'],
      resultElementId: 'result-b',
    });
    Transforms.setNode(
      persistedBoard,
      {
        points: [
          [0, 200],
          [100, 300],
        ],
      },
      [0]
    );

    const board = createHistoryBoard([
      createElement('source-a', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-a', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(board, {
      boardId: 'board-a',
      sourceElementIds: ['source-a'],
      resultElementId: 'result-a',
    });
    await flushBoardChanges();

    Transforms.setNode(
      board,
      {
        points: [
          [0, 100],
          [100, 200],
        ],
      },
      [0]
    );
    board.children = persistedBoard.children;
    await flushBoardChanges();

    expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
      [100, 250],
      [300, 50],
    ]);
  });

  it('undoes an endpoint move and its reconciled line update together', async () => {
    const board = createHistoryBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'result-1',
    });
    await flushBoardChanges();
    board.history.undos.length = 0;
    board.history.redos.length = 0;

    Transforms.setNode(
      board,
      {
        points: [
          [0, 200],
          [100, 300],
        ],
      },
      [0]
    );
    await flushBoardChanges();

    expect(board.history.undos).toHaveLength(1);
    expect(board.history.undos[0]).toHaveLength(2);
    expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
      [100, 250],
      [300, 50],
    ]);

    board.undo();
    await flushBoardChanges();

    expect(
      board.children.find((element) => element.id === 'source-1')?.points
    ).toEqual([
      [0, 0],
      [100, 100],
    ]);
    expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
      [100, 50],
      [300, 50],
    ]);
    expect(board.history.undos).toHaveLength(0);
    expect(board.history.redos).toHaveLength(1);

    board.redo();
    await flushBoardChanges();

    expect(
      board.children.find((element) => element.id === 'source-1')?.points
    ).toEqual([
      [0, 200],
      [100, 300],
    ]);
    expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
      [100, 250],
      [300, 50],
    ]);
    expect(board.history.undos).toHaveLength(1);
    expect(board.history.redos).toHaveLength(0);
  });

  it('does not create undo history when a system endpoint is removed without saving', async () => {
    const board = createHistoryBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'result-1',
    });
    await flushBoardChanges();
    board.history.undos.length = 0;
    board.history.redos.length = 0;

    PlaitHistoryBoard.withoutSaving(board, () => {
      Transforms.removeNode(board, [1]);
    });
    await flushBoardChanges();

    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
    expect(board.history.undos).toHaveLength(0);
    expect(board.history.redos).toHaveLength(0);
  });

  it('does not measure association endpoints after an unrelated element changes', async () => {
    const measuredElementIds: string[] = [];
    const board = createMeasuredHistoryBoard(
      [
        createElement('source-1', [
          [0, 0],
          [100, 100],
        ]),
        createElement('result-1', [
          [300, 0],
          [400, 100],
        ]),
        createElement('unrelated-1', [
          [600, 0],
          [700, 100],
        ]),
      ],
      (element) => measuredElementIds.push(element.id)
    );
    createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'result-1',
    });
    await flushBoardChanges();
    measuredElementIds.length = 0;

    Transforms.setNode(
      board,
      {
        points: [
          [600, 200],
          [700, 300],
        ],
      },
      [2]
    );
    await flushBoardChanges();

    expect(measuredElementIds).toEqual([]);
  });

  it('coalesces endpoint operations and measures only the affected association', async () => {
    const measuredElementIds: string[] = [];
    const board = createMeasuredHistoryBoard(
      [
        createElement('source-1', [
          [0, 0],
          [100, 100],
        ]),
        createElement('result-1', [
          [300, 0],
          [400, 100],
        ]),
        createElement('other-source', [
          [0, 400],
          [100, 500],
        ]),
        createElement('other-result', [
          [300, 400],
          [400, 500],
        ]),
      ],
      (element) => measuredElementIds.push(element.id)
    );
    createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'result-1',
    });
    createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['other-source'],
      resultElementId: 'other-result',
    });
    await flushBoardChanges();
    measuredElementIds.length = 0;

    Transforms.setNode(
      board,
      {
        points: [
          [0, 150],
          [100, 250],
        ],
      },
      [0]
    );
    Transforms.setNode(
      board,
      {
        points: [
          [0, 200],
          [100, 300],
        ],
      },
      [0]
    );
    await flushBoardChanges();

    expect(measuredElementIds).toEqual(['source-1', 'result-1']);
    expect(
      board.children.find(
        (element) =>
          isCanvasAssociationLine(element) &&
          element.canvasAssociation.sourceElementId === 'source-1'
      )?.points
    ).toEqual([
      [100, 250],
      [300, 50],
    ]);
  });

  it('creates, updates, and removes a line for a nested source element', () => {
    const board = createBoard([
      createElement(
        'group-1',
        [
          [0, 0],
          [120, 120],
        ],
        'group',
        [
          createElement('nested-source-1', [
            [10, 10],
            [60, 60],
          ]),
        ]
      ),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);

    const [line] = createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['nested-source-1'],
      resultElementId: 'result-1',
    });

    expect(line?.canvasAssociation.sourceElementId).toBe('nested-source-1');
    expect(line?.points).toEqual([
      [60, 35],
      [300, 50],
    ]);

    Transforms.setNode(
      board,
      {
        points: [
          [0, 200],
          [50, 250],
        ],
      },
      [0, 0]
    );

    expect(reconcileCanvasAssociationLines(board)).toEqual({
      removed: 0,
      updated: 1,
    });
    expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
      [50, 225],
      [300, 50],
    ]);

    Transforms.removeNode(board, [0, 0]);

    expect(reconcileCanvasAssociationLines(board)).toEqual({
      removed: 1,
      updated: 0,
    });
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
    expect(board.children.some((element) => element.id === 'group-1')).toBe(
      true
    );
    expect(board.children.some((element) => element.id === 'result-1')).toBe(
      true
    );
  });

  it.each(['source-1', 'result-1'])(
    'removes only the line when endpoint %s is deleted',
    (deletedId) => {
      const board = createBoard([
        createElement('source-1', [
          [0, 0],
          [100, 100],
        ]),
        createElement('result-1', [
          [300, 0],
          [400, 100],
        ]),
      ]);
      createCanvasAssociationLines(board, {
        boardId: 'board-1',
        sourceElementIds: ['source-1'],
        resultElementId: 'result-1',
      });
      const deletedIndex = board.children.findIndex(
        (element) => element.id === deletedId
      );
      Transforms.removeNode(board, [deletedIndex]);

      expect(reconcileCanvasAssociationLines(board)).toEqual({
        removed: 1,
        updated: 0,
      });
      expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
      const survivingEndpoint =
        deletedId === 'source-1' ? 'result-1' : 'source-1';
      expect(
        board.children.some((element) => element.id === survivingEndpoint)
      ).toBe(true);
    }
  );

  it('undoes an endpoint deletion and its reconciled line removal together', async () => {
    const board = createHistoryBoard([
      createElement('source-1', [
        [0, 0],
        [100, 100],
      ]),
      createElement('result-1', [
        [300, 0],
        [400, 100],
      ]),
    ]);
    createCanvasAssociationLines(board, {
      boardId: 'board-1',
      sourceElementIds: ['source-1'],
      resultElementId: 'result-1',
    });
    await flushBoardChanges();
    board.history.undos.length = 0;
    board.history.redos.length = 0;

    Transforms.removeNode(board, [0]);
    await flushBoardChanges();

    expect(board.children.some((element) => element.id === 'source-1')).toBe(
      false
    );
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
    expect(board.history.undos).toHaveLength(1);
    expect(board.history.undos[0]).toHaveLength(2);

    board.undo();
    await flushBoardChanges();

    expect(board.children.some((element) => element.id === 'source-1')).toBe(
      true
    );
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(1);
    expect(board.history.undos).toHaveLength(0);
    expect(board.history.redos).toHaveLength(1);

    board.redo();
    await flushBoardChanges();

    expect(board.children.some((element) => element.id === 'source-1')).toBe(
      false
    );
    expect(board.children.filter(isCanvasAssociationLine)).toHaveLength(0);
    expect(board.history.undos).toHaveLength(1);
    expect(board.history.redos).toHaveLength(0);
  });

  it('excludes transient feedback and association lines from references', () => {
    expect(
      isCanvasAssociationCandidate({
        id: 'anchor-1',
        type: 'generation-anchor',
      })
    ).toBe(false);
    expect(
      isCanvasAssociationCandidate({ id: 'workzone-1', type: 'workzone' })
    ).toBe(false);
  });
});
