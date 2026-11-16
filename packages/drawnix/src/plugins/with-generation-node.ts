import {
  isCanvasAssociationLine,
  retargetCanvasAssociationLines,
} from './canvas-association';
import {
  draftFromGenerationProgress,
  markGenerationProgressHistoryRestore,
  isGenerationProgress,
  readGenerationOrigin,
  remapGenerationOrigin,
} from '../services/generation-node-lifecycle';
import { bindGenerationThumbnail } from '../services/generation-node-thumbnail';
import { requestAIInputFocus } from '../services/ai-input-ui-events';
import { insertClipboardData } from '@plait/common';
import {
  PlaitBoard,
  PlaitPointerType,
  getSelectedElements,
  PlaitElement,
  PlaitHistoryBoard,
  PlaitPlugin,
  Point,
  toHostPoint,
  toViewBoxPoint,
  RectangleClient,
  rotatePointsByElement,
  Transforms,
} from '@plait/core';
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  createArrowLineElement,
  GeometryComponent,
  PlaitDrawElement,
} from '@plait/draw';
import {
  notifyGenerationNodeChange,
  generationConnectionSides,
  generationInputPort,
  isGenerationNode,
  isGenerationSource,
  remapGenerationNode,
  snapshotGenerationReferences,
  updateGenerationNode,
} from '../services/generation-node';

/** Native geometry retains movement, hit testing, history and clipboard behavior. */
class GenerationNodeComponent extends GeometryComponent {
  private summary?: SVGGElement;
  private summaryKey = '';
  private thumbnailCleanups: Array<() => void> = [];
  private clearThumbnails() {
    this.thumbnailCleanups.forEach((cleanup) => cleanup());
    this.thumbnailCleanups = [];
  }
  renderSummary() {
    if (!isGenerationNode(this.element)) return;
    // The native body is replaced visually, but its geometry remains authoritative.
    if (this.shapeGenerator.g) this.shapeGenerator.g.style.display = 'none';
    const { generationNode: data } = this.element;
    const rect = RectangleClient.getRectangleByPoints(this.element.points);
    const sides = data.references.map((ref) => {
      const source = this.board.children.find(
        (element) => element.id === ref.sourceElementId
      );
      return source?.points
        ? generationConnectionSides(
            RectangleClient.getRectangleByPoints(source.points),
            rect
          ).targetX
        : 0;
    });
    const key = JSON.stringify([rect.width, rect.height, data, sides]);
    if (this.summary && this.summaryKey === key) {
      this.positionSummary(rect);
      return;
    }
    this.clearThumbnails();
    this.summary?.remove();
    this.summaryKey = key;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('pointer-events', 'none');
    group.setAttribute('data-generation-node', this.element.id);
    group.setAttribute(
      'aria-label',
      data.generationType === 'video' ? '视频生成卡片' : '图片生成卡片'
    );
    const el = (
      tag: string,
      attrs: Record<string, string | number>,
      parent = group
    ) => {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attrs))
        child.setAttribute(name, String(value));
      parent.appendChild(child);
      return child;
    };
    const text = (
      value: string,
      x: number,
      y: number,
      size = 12,
      fill = '#747887',
      weight = 400
    ) => {
      const child = el('text', {
        x,
        y,
        'font-size': size,
        fill,
        'font-weight': weight,
        'font-family': 'system-ui, sans-serif',
      });
      child.textContent = value;
    };
    const w = rect.width,
      h = rect.height;
    el('rect', {
      x: 0,
      y: 3,
      width: w,
      height: h,
      rx: 16,
      fill: '#20203a',
      opacity: 0.035,
    });
    el('rect', {
      width: w,
      height: h,
      rx: 16,
      fill: 'var(--island-bg-color, #fff)',
      stroke: '#dcdbe5',
      'stroke-width': 1,
      'data-generation-card-body': '',
    });
    el('rect', {
      x: 16,
      y: 16,
      width: 32,
      height: 32,
      rx: 10,
      fill: '#f0ecff',
    });
    el('path', {
      d:
        data.generationType === 'video'
          ? 'M25 25h12v14H25z M37 29l6 -3v12l-6 -3'
          : 'M24 25h16v14H24z M24 35l5 -5 5 5 3 -3 3 3',
      fill: 'none',
      stroke: '#8270c7',
      'stroke-width': 1.5,
      'stroke-linejoin': 'round',
    });
    if (w > 130)
      text(
        data.generationType === 'video' ? '生成视频' : '生成图片',
        58,
        37,
        15,
        'var(--text-primary-color, #303342)',
        600
      );
    if (w > 260) text('草稿', w - 44, 36, 11, '#9697a4');
    if (h > 165 && w > 140) {
      const maxThumbs = Math.max(1, Math.min(4, Math.floor((w - 100) / 48)));
      data.references.slice(0, maxThumbs).forEach((ref, i) => {
        const x = 18 + i * 48;
        const clipId = `generation-thumb-${this.element.id}-${i}`;
        const clip = el('clipPath', { id: clipId });
        el(
          'rect',
          { x, y: 64, width: 40, height: 40, rx: 8 },
          clip as SVGGElement
        );
        el('rect', {
          x,
          y: 64,
          width: 40,
          height: 40,
          rx: 8,
          fill: '#f2f3f6',
          stroke: '#ebeaf0',
        });
        const thumbnail = el('image', {
          x,
          y: 64,
          width: 40,
          height: 40,
          preserveAspectRatio: 'xMidYMid slice',
          'clip-path': `url(#${clipId})`,
        });
        this.thumbnailCleanups.push(
          bindGenerationThumbnail(thumbnail, ref.url)
        );
      });
      const countX = 18 + Math.min(data.references.length, maxThumbs) * 48;
      text(
        data.references.length
          ? `${data.references.length} 张参考图`
          : '连接图片作为参考',
        countX,
        88,
        11
      );
    }
    if (h > 130 && w > 120) {
      const promptY = h > 165 ? 132 : 76;
      const chars = Math.max(4, Math.floor((w - 36) / 13));
      const prompt = data.prompt.replace(/\s+/g, ' ').trim();
      text(
        prompt ? prompt.slice(0, chars) : '描述你想要的画面…',
        18,
        promptY,
        13,
        prompt ? '#535666' : '#a0a1ad'
      );
      if (h > 200)
        text(
          prompt.length > chars
            ? prompt.slice(chars, chars * 2 - 1) +
                (prompt.length > chars * 2 - 1 ? '…' : '')
            : '点击卡片，编辑提示词与参数',
          18,
          promptY + 22,
          12,
          '#9697a4'
        );
    }
    if (h > 100 && w > 140) {
      el('path', {
        d: `M16 ${h - 44}H${w - 16}`,
        stroke: '#eeedf3',
        'stroke-width': 1,
      });
      const model = data.model || '选择模型';
      const limit = Math.max(5, Math.floor((w - 110) / 7));
      text(
        model.length > limit ? model.slice(0, limit - 1) + '…' : model,
        18,
        h - 18,
        11
      );
      text(`${data.count} 个结果`, w - 68, h - 18, 11);
    }
    data.references.forEach((ref, index) => {
      const [, y] = generationInputPort(index, data.references.length, h);
      el('circle', {
        cx: sides[index] * w,
        cy: y * h,
        r: 4,
        fill: '#fff',
        stroke: '#a394d8',
        'stroke-width': 1.5,
        'data-generation-port': ref.referenceId,
      });
    });
    this.summary = group;
    this.positionSummary(rect);
    this.getElementG().appendChild(group);
  }
  private positionSummary(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) {
    this.summary?.setAttribute(
      'transform',
      `translate(${rect.x} ${rect.y}) rotate(${
        ((this.element.angle || 0) * 180) / Math.PI
      } ${rect.width / 2} ${rect.height / 2})`
    );
  }
  initialize() {
    super.initialize();
    this.renderSummary();
  }
  onContextChanged(...args: Parameters<GeometryComponent['onContextChanged']>) {
    super.onContextChanged(...args);
    this.renderSummary();
  }
  destroy() {
    this.clearThumbnails();
    this.summary?.remove();
    super.destroy();
  }
}

export function isGenerationInputLine(element: PlaitElement): boolean {
  return (
    element.type === 'arrow-line' && element.generationInput?.version === 1
  );
}

/** Only references are authoritative. These lines are projections of that list. */
export function reconcileGenerationInputLines(
  board: PlaitBoard,
  affected?: Set<string>
): void {
  const wanted = new Map<string, PlaitElement>();
  const byId = new Map(board.children.map((element) => [element.id, element]));
  const nodes = board.children
    .filter(isGenerationNode)
    .filter(
      (node) =>
        !affected ||
        affected.has(node.id) ||
        node.generationNode.references.some(
          (ref) => ref.sourceElementId && affected.has(ref.sourceElementId)
        )
    );
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    // Source movement can change the facing port without changing the card itself.
    const component = PlaitElement.getElementRef(node);
    if (component instanceof GenerationNodeComponent) component.renderSummary();
    let changed = false;
    const references = node.generationNode.references.map((ref) => {
      const source = ref.sourceElementId
        ? byId.get(ref.sourceElementId)
        : undefined;
      if (source && isGenerationSource(source) && source.url !== ref.url) {
        changed = true;
        return { ...ref, url: source.url, sourceElementUrl: source.url };
      }
      return ref;
    });
    if (changed)
      updateGenerationNode(board, node.id, {
        ...node.generationNode,
        references,
      });
    for (const [refIndex, ref] of references.entries()) {
      const source = ref.sourceElementId
        ? byId.get(ref.sourceElementId)
        : undefined;
      if (!isGenerationSource(source) || !source) continue;
      const from = RectangleClient.getRectangleByPoints(source.points!);
      const to = RectangleClient.getRectangleByPoints(node.points);
      if (!from || !to) continue;
      const sides = generationConnectionSides(from, to);
      const sourcePoint: Point = rotatePointsByElement(
        [from.x + from.width * sides.sourceX, from.y + from.height / 2],
        source
      ) || [from.x + from.width * sides.sourceX, from.y + from.height / 2];
      const targetConnection = generationInputPort(
        refIndex,
        references.length,
        to.height
      );
      targetConnection[0] = sides.targetX;
      const targetPoint: Point = rotatePointsByElement(
        [
          to.x + to.width * sides.targetX,
          to.y + to.height * targetConnection[1],
        ],
        node
      ) || [
        to.x + to.width * sides.targetX,
        to.y + to.height * targetConnection[1],
      ];
      const line = createArrowLineElement(
        ArrowLineShape.curve,
        [sourcePoint, targetPoint],
        {
          marker: ArrowLineMarkerType.none,
          boundId: source.id,
          connection: [sides.sourceX, 0.5],
        },
        {
          marker: ArrowLineMarkerType.none,
          boundId: node.id,
          connection: targetConnection,
        },
        [],
        { strokeColor: '#aaa0cf', strokeWidth: 1.5 }
      );
      line.id = `generation-input:${node.id}:${ref.referenceId}`;
      const value = {
        ...line,
        generationInput: {
          version: 1,
          nodeId: node.id,
          referenceId: ref.referenceId,
        },
      };
      wanted.set(line.id, value);
    }
  }
  for (let index = board.children.length - 1; index >= 0; index--) {
    const element = board.children[index];
    if (!isGenerationInputLine(element)) continue;
    if (
      affected &&
      !nodeIds.has(element.generationInput.nodeId) &&
      byId.has(element.generationInput.nodeId)
    )
      continue;
    const next = wanted.get(element.id);
    if (!next) Transforms.removeNode(board, [index]);
    else {
      const props = {
        points: next.points,
        shape: next.shape,
        source: next.source,
        target: next.target,
        strokeColor: next.strokeColor,
        strokeWidth: next.strokeWidth,
      };
      if (
        Object.entries(props).some(
          ([key, value]) =>
            JSON.stringify(element[key]) !== JSON.stringify(value)
        )
      )
        Transforms.setNode(board, props, [index]);
      wanted.delete(element.id);
    }
  }
  for (const line of wanted.values())
    Transforms.insertNode(board, line, [board.children.length]);
}

export const withGenerationNode: PlaitPlugin = (board) => {
  const {
    drawElement,
    apply,
    afterChange,
    insertFragment,
    buildFragment,
    dblClick,
    pointerDown,
    pointerUp,
    pointerCancel,
  } = board;
  board.drawElement = (context) =>
    isGenerationNode(context.element)
      ? GenerationNodeComponent
      : drawElement(context);
  let pressed: { id: string; x: number; y: number } | undefined;
  board.pointerDown = (event) => {
    pressed = undefined;
    if (
      event.button === 0 &&
      !event.shiftKey &&
      PlaitBoard.isPointer(board, PlaitPointerType.selection)
    ) {
      const point = toViewBoxPoint(
        board,
        toHostPoint(board, event.clientX, event.clientY)
      );
      const node = [...board.children]
        .reverse()
        .find(
          (element) => isGenerationNode(element) && board.isHit(element, point)
        );
      if (node) pressed = { id: node.id, x: event.clientX, y: event.clientY };
    }
    pointerDown(event);
  };
  board.pointerCancel = (event) => {
    pressed = undefined;
    pointerCancel(event);
  };
  board.pointerUp = (event) => {
    const click = pressed;
    pressed = undefined;
    pointerUp(event);
    if (
      !click ||
      Math.hypot(event.clientX - click.x, event.clientY - click.y) > 6
    )
      return;
    // Selection is committed by the native onChange microtask. A deliberate
    // click must also reopen an already selected/dismissed card.
    queueMicrotask(() => {
      const selected = getSelectedElements(board);
      if (
        PlaitBoard.isAlive(board) &&
        selected.length === 1 &&
        selected[0].id === click.id
      )
        notifyGenerationNodeChange(board, click.id);
    });
  };
  board.dblClick = (event) => {
    const point = toViewBoxPoint(
      board,
      toHostPoint(board, event.clientX, event.clientY)
    );
    const node = board.children.find(
      (element) => isGenerationNode(element) && board.isHit(element, point)
    );
    if (isGenerationNode(node)) {
      requestAIInputFocus({
        generationType: node.generationNode.generationType,
      });
      return;
    }
    dblClick(event);
  };
  let reconciling = false;
  let scheduled = false;
  let initialized = false;
  const affected = new Set<string>();
  board.apply = (operation) => {
    let completedTarget:
      | { progressId: string; resultId: string; taskId?: string }
      | undefined;
    if (
      operation.type === 'insert_node' &&
      isGenerationProgress(operation.node as PlaitElement) &&
      PlaitHistoryBoard.isSaving(board) === false
    ) {
      const progress = operation.node as PlaitElement;
      markGenerationProgressHistoryRestore(
        board,
        progress.id,
        progress.phase === 'completed' ||
          progress.workflow?.status === 'completed'
      );
    }
    // Store the immutable inputs on every output, including manual/frame inserts.
    // Never look at selection: multiple workflows may finish on the same board.
    if (operation.type === 'insert_node' || operation.type === 'set_node') {
      const value =
        operation.type === 'insert_node'
          ? operation.node
          : operation.newProperties;
      const metadata = value as PlaitElement;
      const nodeId = metadata.generationNodeId;
      const taskId = metadata.generationTaskId;
      if ((nodeId || taskId) && !metadata.generationOrigin) {
        const progress = board.children.filter(isGenerationProgress);
        const owner =
          progress.find(
            (element) =>
              taskId &&
              (element.taskIds?.includes(taskId) ||
                element.workflow?.steps?.some(
                  (step: { result?: { taskId?: string } }) =>
                    step.result?.taskId === taskId
                ))
          ) ||
          progress.find(
            (element) =>
              nodeId && readGenerationOrigin(element)?.draft.id === nodeId
          );
        const origin = readGenerationOrigin(owner);
        if (origin && owner) {
          const patch = {
            ...value,
            generationNodeId: origin.draft.id,
            generationOrigin: structuredClone(origin),
          };
          completedTarget = {
            progressId: owner.id,
            resultId:
              operation.type === 'insert_node'
                ? metadata.id
                : board.children[operation.path[0]]?.id,
            taskId,
          };
          operation =
            operation.type === 'insert_node'
              ? { ...operation, node: patch as PlaitElement }
              : { ...operation, newProperties: patch };
        }
      }
    }
    if (
      !reconciling &&
      ['insert_node', 'remove_node', 'set_node'].includes(operation.type)
    ) {
      const element =
        'node' in operation
          ? (operation.node as PlaitElement)
          : 'path' in operation
          ? board.children[operation.path[0]]
          : undefined;
      if (element && (isGenerationNode(element) || isGenerationSource(element)))
        affected.add(element.id);
      if (element && isGenerationInputLine(element))
        affected.add(element.generationInput.nodeId);
    }
    // Deleting a displayed input line edits the draft in the same history batch.
    if (
      !reconciling &&
      operation.type === 'remove_node' &&
      PlaitHistoryBoard.isSaving(board) !== false &&
      isGenerationInputLine(operation.node as PlaitElement)
    ) {
      const metadata = (operation.node as PlaitElement).generationInput;
      const node = board.children.find((el) => el.id === metadata.nodeId);
      if (isGenerationNode(node))
        (board.operations.length
          ? PlaitHistoryBoard.withMerging
          : PlaitHistoryBoard.withNewBatch)(board, () => {
          updateGenerationNode(board, node.id, {
            ...node.generationNode,
            references: node.generationNode.references.filter(
              (ref) => ref.referenceId !== metadata.referenceId
            ),
          });
          apply(operation);
        });
      else apply(operation);
      return;
    }
    apply(operation);
    if (completedTarget?.resultId) {
      const target = completedTarget;
      const links = board.children
        .filter(isCanvasAssociationLine)
        .filter(
          (line) => line.canvasAssociation.resultElementId === target.progressId
        );
      for (const line of links) {
        const metadata = line.canvasAssociation;
        retargetCanvasAssociationLines(board, {
          boardId: metadata.boardId,
          sourceElementIds: [metadata.sourceElementId],
          workflowId: metadata.workflowId,
          taskId: target.taskId,
          previousResultElementId: target.progressId,
          resultElementId: target.resultId,
        });
      }
    }
  };
  board.afterChange = () => {
    afterChange();
    if (scheduled || reconciling) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!PlaitBoard.isAlive(board)) return;
      reconciling = true;
      try {
        if (!initialized || affected.size) {
          const changed = initialized ? new Set(affected) : undefined;
          affected.clear();
          initialized = true;
          PlaitHistoryBoard.withoutSaving(board, () =>
            reconcileGenerationInputLines(board, changed)
          );
        }
      } finally {
        reconciling = false;
      }
      notifyGenerationNodeChange(board);
    });
  };
  board.buildFragment = (context, rectangle, operationType, originData) => {
    const result = buildFragment(context, rectangle, operationType, originData);
    for (const element of result?.elements || []) {
      if (isGenerationNode(element))
        element.generationNode = {
          ...element.generationNode,
          references: snapshotGenerationReferences(
            element.generationNode,
            board.children
          ),
        };
    }
    return result;
  };
  board.insertFragment = (data, point, operationType) => {
    if (
      !data?.elements?.some(
        (element) =>
          isGenerationNode(element) ||
          element.generationNodeId ||
          readGenerationOrigin(element)
      )
    )
      return insertFragment(data, point, operationType);
    const elements = structuredClone(data.elements)
      .filter((el: PlaitElement) => !isGenerationInputLine(el))
      .map((el: PlaitElement) =>
        isGenerationProgress(el)
          ? { ...draftFromGenerationProgress(el), id: el.id }
          : el
      );
    const drawElements = elements.filter(PlaitDrawElement.isDrawElement);
    insertClipboardData(board, drawElements, point, (element, ids) => {
      if (isGenerationNode(element))
        element.generationNode = remapGenerationNode(
          element.generationNode,
          new Map(Object.entries(ids))
        );
      if (element.generationNodeId)
        element.generationNodeId = ids[element.generationNodeId];
      const origin = readGenerationOrigin(element);
      if (origin)
        element.generationOrigin = remapGenerationOrigin(
          origin,
          new Map(Object.entries(ids))
        );
    });
    const remaining = elements.filter(
      (el) => !PlaitDrawElement.isDrawElement(el)
    );
    if (remaining.length)
      insertFragment({ ...data, elements: remaining }, point, operationType);
  };
  return board;
};
