import { getImageReferencePorts, hitImageReferencePort, IMAGE_REFERENCE_CONNECTIONS, IMAGE_REFERENCE_PORT_RADIUS } from '../services/image-reference-ports';
import { addGenerationReference, generationConnectionSides, generationInputPort, isGenerationNode, isGenerationSource } from '../services/generation-node';
import {
  PlaitBoard,
  PlaitHistoryBoard,
  PlaitElement,
  PlaitPointerType,
  BoardTransforms,
  rotateAntiPointsByElement,
  toActivePoint,
  toHostPoint,
  toViewBoxPoint,
  Transforms,
  Direction,
  rotatePointsByElement,
  RectangleClient,
  clearSelectedElement,
  addSelectedElement,
  Point,
} from '@plait/core';
import {
  BasicShapes,
  createDefaultGeometry,
  DrawPointerType,
  getAutoCompletePoints,
  getHitIndexOfAutoCompletePoint,
  getSelectedDrawElements,
  PlaitDrawElement,
  ArrowLineAutoCompleteGenerator,
  insertElement,
  createArrowLineElement,
  ArrowLineShape,
  ArrowLineMarkerType,
  getHitConnection,
  GeometryShapes,
  drawArrowLine,
} from '@plait/draw';
import { getDirectionByIndex } from '@plait/common';

/**
 * 自动完成形状选择状态
 */
export interface AutoCompleteShapeState {
  /** 是否显示形状选择器 */
  visible: boolean;
  /** 选择器位置（屏幕坐标） */
  position: { x: number; y: number };
  /** 当前源元素 */
  sourceElement: PlaitElement | null;
  /** 当前源元素的形状 */
  currentShape: DrawPointerType | null;
  /** hover 的连接点索引 */
  hitIndex: number;
  /** hover 的连接点坐标 (viewBox 坐标，用于创建元素) */
  hitPoint: [number, number] | null;
  /** 点击菜单保持打开；只有 hover 菜单随鼠标离开关闭。 */
  mode: 'hover' | 'click' | 'arrowLine';
  /** 箭头线模式下的箭头线元素 */
  arrowLineElement?: PlaitElement | null;
  /** 箭头线模式下的终点位置 */
  arrowLineEndPoint?: Point | null;
}

const initialState: AutoCompleteShapeState = {
  visible: false,
  position: { x: 0, y: 0 },
  sourceElement: null,
  currentShape: null,
  hitIndex: -1,
  hitPoint: null,
  mode: 'hover',
  arrowLineElement: null,
  arrowLineEndPoint: null,
};

// WeakMap 存储每个 board 的状态
const BOARD_TO_AUTO_COMPLETE_STATE = new WeakMap<PlaitBoard, AutoCompleteShapeState>();
const BOARD_TO_PENDING_PREVIEW = new WeakMap<PlaitBoard, SVGGElement>();
const BOARD_TO_STATE_CALLBACK = new WeakMap<PlaitBoard, (state: AutoCompleteShapeState) => void>();

/**
 * 获取 board 的自动完成状态
 */
export function getAutoCompleteState(board: PlaitBoard): AutoCompleteShapeState {
  return BOARD_TO_AUTO_COMPLETE_STATE.get(board) || initialState;
}

/**
 * 设置 board 的自动完成状态
 */
export function setAutoCompleteState(board: PlaitBoard, state: AutoCompleteShapeState): void {
  BOARD_TO_AUTO_COMPLETE_STATE.set(board, state);
  const callback = BOARD_TO_STATE_CALLBACK.get(board);
  if (callback) {
    callback(state);
  }
}

/**
 * 注册状态变化回调
 */
export function registerAutoCompleteStateCallback(
  board: PlaitBoard,
  callback: (state: AutoCompleteShapeState) => void
): () => void {
  BOARD_TO_STATE_CALLBACK.set(board, callback);
  return () => {
    BOARD_TO_STATE_CALLBACK.delete(board);
  };
}

/**
 * 重置自动完成状态
 */
export function resetAutoCompleteState(board: PlaitBoard): void {
  BOARD_TO_PENDING_PREVIEW.get(board)?.remove();
  BOARD_TO_PENDING_PREVIEW.delete(board);
  setAutoCompleteState(board, initialState);
}

// 新形状与源元素的默认距离（viewBox 坐标系中的距离）
const AUTO_COMPLETE_DISTANCE = 100;

/**
 * 创建并插入连接线和新形状
 * 参考 @plait/draw 原生 withArrowLineAutoComplete 实现
 */
export function createAutoCompleteElements(
  board: PlaitBoard,
  sourceElement: PlaitDrawElement,
  hitIndex: number,
  hitPoint: [number, number],
  targetShape: DrawPointerType
): void {
  // 获取方向（0: 右, 1: 下, 2: 左, 3: 上）
  const direction = getDirectionByIndex(hitIndex);
  
  // 使用源元素的尺寸来计算新形状的大小（与源元素保持一致）
  const sourceRect = RectangleClient.getRectangleByPoints(sourceElement.points);
  const sourceWidth = sourceRect.width;
  const sourceHeight = sourceRect.height;
  const sourceCenterX = sourceRect.x + sourceWidth / 2;
  const sourceCenterY = sourceRect.y + sourceHeight / 2;
  
  // 获取源元素边缘中心点作为箭头线起点（viewBox 坐标）
  const sourceEdgeCenterPoints = RectangleClient.getEdgeCenterPoints(sourceRect);
  const arrowLineStartPoint = sourceEdgeCenterPoints[hitIndex];
  
  // 计算新形状的中心位置（基于源形状中心对齐）
  // 水平方向：新形状与源形状垂直居中对齐
  // 垂直方向：新形状与源形状水平居中对齐
  let newCenterX: number;
  let newCenterY: number;
  
  switch (direction) {
    case Direction.right:
      // 新形状在源元素右侧，垂直居中
      newCenterX = sourceCenterX + sourceWidth / 2 + AUTO_COMPLETE_DISTANCE + sourceWidth / 2;
      newCenterY = sourceCenterY;
      break;
    case Direction.bottom:
      // 新形状在源元素下方，水平居中
      newCenterX = sourceCenterX;
      newCenterY = sourceCenterY + sourceHeight / 2 + AUTO_COMPLETE_DISTANCE + sourceHeight / 2;
      break;
    case Direction.left:
      // 新形状在源元素左侧，垂直居中
      newCenterX = sourceCenterX - sourceWidth / 2 - AUTO_COMPLETE_DISTANCE - sourceWidth / 2;
      newCenterY = sourceCenterY;
      break;
    case Direction.top:
      // 新形状在源元素上方，水平居中
      newCenterX = sourceCenterX;
      newCenterY = sourceCenterY - sourceHeight / 2 - AUTO_COMPLETE_DISTANCE - sourceHeight / 2;
      break;
    default:
      newCenterX = sourceCenterX + sourceWidth / 2 + AUTO_COMPLETE_DISTANCE + sourceWidth / 2;
      newCenterY = sourceCenterY;
  }
  
  // 基于新中心点创建新形状的 points（左上角和右下角）
  const newShapePoints: [[number, number], [number, number]] = [
    [newCenterX - sourceWidth / 2, newCenterY - sourceHeight / 2],
    [newCenterX + sourceWidth / 2, newCenterY + sourceHeight / 2],
  ];
  
  // 创建新形状
  const newShapeElement = createDefaultGeometry(board, newShapePoints, targetShape as GeometryShapes);
  
  // 设置默认白色填充（让图形中间可点击，方便双击编辑文字）
  newShapeElement.fill = '#ffffff';
  
  // 复制源元素的样式（仅对 ShapeElement）
  if (PlaitDrawElement.isShapeElement(sourceElement) && !PlaitDrawElement.isText(sourceElement)) {
    const typedSource = sourceElement as PlaitDrawElement & {
      angle?: number;
      fill?: string;
      strokeColor?: string;
      strokeStyle?: unknown;
      strokeWidth?: number;
    };
    
    if (typedSource.angle !== undefined) newShapeElement.angle = typedSource.angle;
    // 复制源元素的填充色（如果有）
    if (typedSource.fill && typedSource.fill !== 'none') {
      newShapeElement.fill = typedSource.fill;
    }
    if (typedSource.strokeColor !== undefined) newShapeElement.strokeColor = typedSource.strokeColor;
    if (typedSource.strokeStyle !== undefined) {
      (newShapeElement as typeof typedSource).strokeStyle = typedSource.strokeStyle;
    }
    if (typedSource.strokeWidth !== undefined) newShapeElement.strokeWidth = typedSource.strokeWidth;
  }
  
  // 计算连接点（使用 viewBox 坐标）
  const rotatedArrowLineStartPoint = rotatePointsByElement(arrowLineStartPoint, sourceElement) || arrowLineStartPoint;
  // 使用类型断言确保 sourceElement 是 ShapeElement
  const sourceConnection = PlaitDrawElement.isShapeElement(sourceElement) 
    ? getHitConnection(board, rotatedArrowLineStartPoint, sourceElement as Parameters<typeof getHitConnection>[2])
    : undefined;
  
  // 计算目标连接点（新形状面向源的那个点）
  // getEdgeCenterPoints 返回顺序: 0=上, 1=右, 2=下, 3=左
  let targetHitIndex: number;
  switch (direction) {
    case Direction.right:
      targetHitIndex = 3; // 新形状在右侧，连接点在左边
      break;
    case Direction.bottom:
      targetHitIndex = 0; // 新形状在下方，连接点在上边
      break;
    case Direction.left:
      targetHitIndex = 1; // 新形状在左侧，连接点在右边
      break;
    case Direction.top:
      targetHitIndex = 2; // 新形状在上方，连接点在下边
      break;
    default:
      targetHitIndex = 3;
  }
  
  // 获取新形状的边缘中心点（viewBox 坐标）
  const newShapeRect = RectangleClient.getRectangleByPoints(newShapeElement.points);
  const targetEdgeCenterPoints = RectangleClient.getEdgeCenterPoints(newShapeRect);
  const arrowLineEndPoint = targetEdgeCenterPoints[targetHitIndex];
  const rotatedArrowLineEndPoint = rotatePointsByElement(arrowLineEndPoint, newShapeElement) || arrowLineEndPoint;
  const targetConnection = getHitConnection(board, rotatedArrowLineEndPoint, newShapeElement);
  
  // 创建箭头线（使用直线而非折线）
  const arrowLineElement = createArrowLineElement(
    ArrowLineShape.straight,
    [rotatedArrowLineStartPoint, rotatedArrowLineEndPoint],
    {
      marker: ArrowLineMarkerType.none,
      connection: sourceConnection,
      boundId: sourceElement.id,
    },
    {
      marker: ArrowLineMarkerType.arrow,
      connection: targetConnection,
      boundId: newShapeElement.id,
    },
    [],
    {}
  );
  
  // 插入元素
  Transforms.insertNode(board, arrowLineElement, [board.children.length]);
  // insertElement 内部会自动选中新元素并切换到选择模式
  insertElement(board, newShapeElement);

  // 重置状态
  resetAutoCompleteState(board);
  
  // 延迟再次确保选中并触发渲染（防止后续事件覆盖选中状态）
  const newElementId = newShapeElement.id;
  setTimeout(() => {
    const insertedElementIndex = board.children.findIndex(el => el.id === newElementId);
    const insertedElement = insertedElementIndex >= 0 ? board.children[insertedElementIndex] : null;
    if (insertedElement) {
      clearSelectedElement(board);
      addSelectedElement(board, insertedElement);
      BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
      // 使用 Transforms.setNode 设置临时标记来触发 board.apply() 从而触发渲染
      // 先设置一个临时标记，然后立即删除它
      Transforms.setNode(board, { _forceRender: Date.now() } as any, [insertedElementIndex]);
      Transforms.setNode(board, { _forceRender: undefined } as any, [insertedElementIndex]);
    }
  }, 50);
}

/**
 * 为已存在的箭头线创建连接的形状
 * 用于箭头线拖拽完成后，在终点位置创建形状
 */
export function createShapeForArrowLine(
  board: PlaitBoard,
  arrowLineElement: PlaitElement,
  endPoint: Point,
  targetShape: DrawPointerType
): void {
  // 默认形状尺寸（当找不到源元素时使用）
  let shapeWidth = 100;
  let shapeHeight = 100;
  
  // 尝试从箭头线的源元素获取尺寸
  const arrowLine = arrowLineElement as PlaitElement & {
    source?: { boundId?: string };
    target?: { boundId?: string };
    points?: Point[];
  };
  
  const sourceBoundId = arrowLine.source?.boundId;
  if (sourceBoundId) {
    // 找到源元素
    const sourceElement = board.children.find(el => el.id === sourceBoundId) as PlaitDrawElement | undefined;
    if (sourceElement && PlaitDrawElement.isShapeElement(sourceElement)) {
      // 使用源元素的尺寸
      const sourceRect = RectangleClient.getRectangleByPoints(sourceElement.points);
      shapeWidth = sourceRect.width;
      shapeHeight = sourceRect.height;
    }
  }
  
  // 计算新形状的位置（以终点为中心）
  const newShapePoints: [[number, number], [number, number]] = [
    [endPoint[0] - shapeWidth / 2, endPoint[1] - shapeHeight / 2],
    [endPoint[0] + shapeWidth / 2, endPoint[1] + shapeHeight / 2],
  ];
  
  // 创建新形状
  const newShapeElement = createDefaultGeometry(board, newShapePoints, targetShape as GeometryShapes);
  
  // 设置默认白色填充
  newShapeElement.fill = '#ffffff';
  
  // 计算连接点
  const newShapeRect = RectangleClient.getRectangleByPoints(newShapeElement.points);
  const targetEdgeCenterPoints = RectangleClient.getEdgeCenterPoints(newShapeRect);
  
  // 根据箭头线的方向确定连接点
  const arrowPoints = arrowLine.points || [];
  
  if (arrowPoints.length >= 2) {
    const startPoint = arrowPoints[0];
    const lineEndPoint = arrowPoints[arrowPoints.length - 1];
    
    // 计算箭头线的方向
    const dx = lineEndPoint[0] - startPoint[0];
    const dy = lineEndPoint[1] - startPoint[1];
    
    // 根据方向选择最近的连接点
    let targetHitIndex: number;
    if (Math.abs(dx) > Math.abs(dy)) {
      // 水平方向为主
      targetHitIndex = dx > 0 ? 3 : 1; // 从右边来连左边，从左边来连右边
    } else {
      // 垂直方向为主
      targetHitIndex = dy > 0 ? 0 : 2; // 从下边来连上边，从上边来连下边
    }
    
    const connectionPoint = targetEdgeCenterPoints[targetHitIndex];
    const targetConnection = getHitConnection(board, connectionPoint, newShapeElement);
    
    // 更新箭头线的终点连接
    const arrowLineIndex = board.children.findIndex(el => el.id === arrowLineElement.id);
    if (arrowLineIndex !== -1) {
      // 更新箭头线的 target 属性
      Transforms.setNode(
        board,
        {
          target: {
            marker: ArrowLineMarkerType.arrow,
            connection: targetConnection,
            boundId: newShapeElement.id,
          },
          points: [startPoint, connectionPoint],
        },
        [arrowLineIndex]
      );
    }
  }
  
  // 插入新形状（insertElement 内部会自动选中新元素并切换到选择模式）
  insertElement(board, newShapeElement);
  
  // 重置状态
  resetAutoCompleteState(board);
  
  // 延迟再次确保选中并触发渲染（防止后续事件覆盖选中状态）
  const newElementId = newShapeElement.id;
  setTimeout(() => {
    const insertedElementIndex = board.children.findIndex(el => el.id === newElementId);
    const insertedElement = insertedElementIndex >= 0 ? board.children[insertedElementIndex] : null;
    if (insertedElement) {
      clearSelectedElement(board);
      addSelectedElement(board, insertedElement);
      BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
      // 使用 Transforms.setNode 设置临时标记来触发 board.apply() 从而触发渲染
      // 先设置一个临时标记，然后立即删除它
      Transforms.setNode(board, { _forceRender: Date.now() } as any, [insertedElementIndex]);
      Transforms.setNode(board, { _forceRender: undefined } as any, [insertedElementIndex]);
    }
  }, 50);
}

/**
 * 扩展 @plait/draw 的自动完成功能
 * 
 * 功能：
 * 1. 在 hover 到连接点时显示形状选择器
 * 2. 允许用户选择下一个节点的形状类型
 * 3. 默认使用同类形状
 * 4. 在箭头线拖拽完成后，如果终点未连接形状，显示形状选择器
 */
export const withArrowLineAutoCompleteExtend = (board: PlaitBoard) => {
  const { pointerMove, pointerLeave, pointerDown, pointerCancel, globalPointerUp } = board;
  
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastHitIndex = -1;
  
  // 记录上一次 children 的长度，用于检测新插入的箭头线
  let gestureIds: Set<string> | null = null;
  board.pointerDown = event => {
    gestureIds = new Set(board.children.map(element => element.id));
    pointerDown(event);
  };
  board.pointerCancel = event => { gestureIds = null; pointerCancel(event); };
  // 记录鼠标位置
  let lastMousePosition = { x: 0, y: 0 };

  board.pointerMove = (event: PointerEvent) => {
    // 记录鼠标位置
    lastMousePosition = { x: event.clientX, y: event.clientY };
    
    // 清除之前的延迟
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }

    const selectedElements = getSelectedDrawElements(board);
    const originElement = selectedElements.length === 1 && selectedElements[0];
    const currentState = getAutoCompleteState(board);

    if (!originElement || 
        !PlaitDrawElement.isShapeElement(originElement) || 
        PlaitDrawElement.isText(originElement)) {
      if (currentState.visible && currentState.mode === 'hover') {
        setAutoCompleteState(board, { ...initialState });
      }
      lastHitIndex = -1;
      // 下层 withArrowLineAutoCompleteReaction 对 isShapeElement 的元素（含 Text）
      // 会不安全地调用 ref.getGenerator()。如果选中的 ShapeElement 还未渲染
      //（ref 为 undefined），直接跳过本帧，避免 TypeError。
      if (originElement && PlaitDrawElement.isShapeElement(originElement)) {
        const ref = PlaitElement.getElementRef(originElement);
        if (!ref) {
          return;
        }
      }
      pointerMove(event);
      return;
    }

    // 检查选中元素是否已有 elementRef（新插入的元素可能还未渲染）
    // @plait/draw 的 withAutoComplete 内部会不安全地调用 ref.getGenerator()，
    // 如果 ref 为 undefined 会抛出 TypeError，所以此处直接跳过本帧 pointerMove
    const selectedRef = PlaitElement.getElementRef(originElement);
    if (!selectedRef) {
      lastHitIndex = -1;
      return;
    }

    // Image ports open the action menu on click/drop, never on a 50ms hover.
    // This also avoids the native provisional shape while connecting references.
    if (isGenerationSource(originElement)) return;
    const activePoint = toActivePoint(board, event.x, event.y);
    const points = getAutoCompletePoints(board, originElement, true);
    const rotatedPoint = rotateAntiPointsByElement(board, activePoint, originElement, true) || activePoint;
    const hitIndex = getHitIndexOfAutoCompletePoint(rotatedPoint, points);
    const hitPoint = points[hitIndex];

    if (hitPoint) {
      // 只有当 hitIndex 变化或选择器未显示时才更新
      if (hitIndex !== lastHitIndex || !currentState.visible) {
        lastHitIndex = hitIndex;
        
        // 保存当前鼠标位置用于显示选择器
        const mouseX = event.clientX;
        const mouseY = event.clientY;
        
        // 延迟显示选择器
        hoverTimeout = setTimeout(() => {
          // 获取元素的形状类型
          const shape = PlaitDrawElement.isImage(originElement)
            ? BasicShapes.rectangle
            : (originElement as { shape?: DrawPointerType }).shape || BasicShapes.rectangle;
          
          setAutoCompleteState(board, {
            visible: true,
            // 选择器宽度约 280px，水平居中显示在鼠标正下方
            position: { x: mouseX - 140, y: mouseY + 20 },
            sourceElement: originElement,
            currentShape: shape,
            hitIndex,
            hitPoint,
            mode: 'hover',
          });
        }, 50); // 50ms 延迟，避免快速移动时频繁触发
      }
    } else {
      lastHitIndex = -1;
      if (currentState.visible && currentState.mode === 'hover') {
        // 延迟隐藏，给用户时间移动到选择器
        hoverTimeout = setTimeout(() => {
          const state = getAutoCompleteState(board);
          if (state.visible && state.mode === 'hover') {
            setAutoCompleteState(board, { ...initialState });
          }
        }, 300);
      }
    }

    const elementRef = PlaitElement.getElementRef(originElement);
    const generator = (elementRef as any)?.getGenerator?.(ArrowLineAutoCompleteGenerator.key);
    if (!generator) {
      return;
    }

    pointerMove(event);
  };

  board.pointerLeave = (event: PointerEvent) => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    // 不立即关闭，让用户有机会移动到选择器
    pointerLeave(event);
  };
  
  board.globalPointerUp = (event: PointerEvent) => {
    // 先调用原始的 globalPointerUp
    globalPointerUp(event);
    
    const before = gestureIds;
    gestureIds = null;
    if (!before) return;
    const newLines = board.children.filter(element => !before.has(element.id) && PlaitDrawElement.isArrowLine(element) && !element.canvasAssociation && !element.generationInput);
    if (newLines.length !== 1) return;
    const line = newLines[0];
    const source = board.children.find(element => element.id === line.source?.boundId);

    if (!line.points?.length) return;
    const endPoint = line.points[line.points.length - 1];
    const node = board.children.find(element => isGenerationNode(element) && (element.id === line.target?.boundId || board.isHit(element, endPoint)));
    if (isGenerationSource(source) && source && isGenerationNode(node)) {
      PlaitHistoryBoard.withMerging(board, () => {
        Transforms.removeNode(board, [board.children.findIndex(element => element.id === line.id)]);
        addGenerationReference(board, node, source);
      });
      resetAutoCompleteState(board);
      return;
    }
    if (line.target?.boundId) return;
    setAutoCompleteState(board, {
      visible: true,
      position: { x: event.clientX - 140, y: event.clientY + 20 },
      sourceElement: source || null,
      currentShape: BasicShapes.rectangle,
      hitIndex: -1, hitPoint: null, mode: 'arrowLine',
      arrowLineElement: line, arrowLineEndPoint: endPoint,
    });
  };

  return withImageReferenceGesture(board);
};


/** A reference drag is a transient preview; only dropping records a history entry. */
function withImageReferenceGesture(board: PlaitBoard): PlaitBoard {
  const { pointerDown, pointerMove, globalPointerMove, globalPointerUp, pointerCancel, keyDown, afterChange } = board;
  let gesture: { source: PlaitElement; start: Point; pointerStart: Point; hitIndex: number; sourceConnection: Point; preview: SVGGElement; target?: PlaitElement; line?: ReturnType<typeof createArrowLineElement> } | null = null;
  let portsGroup: SVGGElement | null = null;
  let portsKey = '';
  let hoveredPort = -1;
  const renderPorts = () => {
    const selected = getSelectedDrawElements(board);
    const source = selected.length === 1 && isGenerationSource(selected[0]) ? selected[0] : undefined;
    if (!source || !PlaitBoard.isPointer(board, PlaitPointerType.selection) || PlaitBoard.isReadonly(board)) {
      portsGroup?.remove(); portsGroup = null; portsKey = ''; return;
    }
    const ref = PlaitElement.getElementRef(source) as { getGenerator?: (key: string) => ArrowLineAutoCompleteGenerator } | undefined;
    const generator = ref?.getGenerator?.(ArrowLineAutoCompleteGenerator.key);
    if (generator?.g) generator.g.style.visibility = 'hidden';
    const points = getImageReferencePorts(board, source);
    const key = JSON.stringify([source.id, points, source.angle, hoveredPort]);
    if (portsGroup?.isConnected && portsKey === key) return;
    portsGroup?.remove(); portsKey = key;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('data-image-reference-ports', source.id);
    group.setAttribute('pointer-events', 'none');
    const center = [(points[0][0] + points[2][0]) / 2, (points[1][1] + points[3][1]) / 2];
    group.setAttribute('transform', `rotate(${(source.angle || 0) * 180 / Math.PI} ${center[0]} ${center[1]})`);
    points.forEach(([x, y], index) => {
      const button = document.createElementNS(group.namespaceURI, 'g');
      button.setAttribute('data-image-reference-port', String(index));
      const title = document.createElementNS(group.namespaceURI, 'title');
      title.textContent = '拖动添加参考，点击选择操作'; button.appendChild(title);
      const circle = document.createElementNS(group.namespaceURI, 'circle');
      Object.entries({ cx: x, cy: y, r: IMAGE_REFERENCE_PORT_RADIUS, fill: hoveredPort === index ? '#8270c7' : '#fff', stroke: '#a394d8', 'stroke-width': 1.5 }).forEach(([name, value]) => circle.setAttribute(name, String(value)));
      const plus = document.createElementNS(group.namespaceURI, 'path');
      plus.setAttribute('d', `M${x - 4} ${y}h8 M${x} ${y - 4}v8`);
      plus.setAttribute('stroke', hoveredPort === index ? '#fff' : '#8270c7');
      plus.setAttribute('stroke-width', '1.5'); plus.setAttribute('stroke-linecap', 'round');
      button.append(circle, plus); group.appendChild(button);
    });
    PlaitBoard.getActiveHost(board).appendChild(group); portsGroup = group;
  };
  board.afterChange = () => { afterChange(); queueMicrotask(() => { if (PlaitBoard.isAlive(board)) renderPorts(); }); };
  const hoverPorts = (event: PointerEvent) => {
    const selected = getSelectedDrawElements(board);
    const source = selected.length === 1 && isGenerationSource(selected[0]) ? selected[0] : undefined;
    const point = toActivePoint(board, event.clientX, event.clientY);
    const index = source ? hitImageReferencePort(rotateAntiPointsByElement(board, point, source, true) || point, getImageReferencePorts(board, source)) : -1;
    if (index !== hoveredPort) { hoveredPort = index; renderPorts(); }
  };
  let highlight: Element | null = null;
  let previewFrame: number | null = null;
  const clearHighlight = () => {
    highlight?.setAttribute('stroke', '#dcdbe5');
    highlight?.setAttribute('stroke-width', '1');
    highlight = null;
  };
  const cleanup = () => {
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    previewFrame = null;
    gesture?.preview.remove();
    gesture = null;
    clearHighlight();
  };
  const update = (event: PointerEvent) => {
    if (!gesture) return;
    const point = toViewBoxPoint(board, toHostPoint(board, event.clientX, event.clientY));
    const padding = 20 / board.viewport.zoom;
    const target = [...board.children].reverse().find(element => {
      if (!isGenerationNode(element)) return false;
      const rect = RectangleClient.getRectangleByPoints(element.points);
      const local = rotateAntiPointsByElement(board, point, element) || point;
      return local[0] >= rect.x - padding && local[0] <= rect.x + rect.width + padding && local[1] >= rect.y - padding && local[1] <= rect.y + rect.height + padding;
    });
    if (target?.id !== gesture.target?.id) {
      clearHighlight();
      if (target) {
        highlight = PlaitElement.getElementG(target)?.querySelector('[data-generation-card-body]') || null;
        highlight?.setAttribute('stroke', '#8c76d1');
        highlight?.setAttribute('stroke-width', '2.5');
      }
    }
    gesture.target = target;
    let end = point;
    let start = gesture.start;
    let sourceConnection = gesture.sourceConnection;
    let connection: Point | undefined;
    if (isGenerationNode(target)) {
      const rect = RectangleClient.getRectangleByPoints(target.points);
      const refs = target.generationNode.references;
      const existing = refs.findIndex(ref => ref.sourceElementId === gesture!.source.id);
      const sourceRect = RectangleClient.getRectangleByPoints(gesture.source.points!);
      const sides = generationConnectionSides(sourceRect, rect);
      sourceConnection = [sides.sourceX, 0.5];
      const sourcePoint: Point = [sourceRect.x + sourceRect.width * sides.sourceX, sourceRect.y + sourceRect.height / 2];
      start = rotatePointsByElement(sourcePoint, gesture.source) || sourcePoint;
      connection = generationInputPort(existing >= 0 ? existing : refs.length, existing >= 0 ? refs.length : refs.length + 1, rect.height);
      connection[0] = sides.targetX;
      const targetPoint: Point = [rect.x + rect.width * sides.targetX, rect.y + rect.height * connection[1]];
      end = rotatePointsByElement(targetPoint, target) || targetPoint;
    }
    gesture.line = createArrowLineElement(ArrowLineShape.curve, [start, end],
      { boundId: gesture.source.id, connection: sourceConnection, marker: ArrowLineMarkerType.none },
      { boundId: target?.id, connection, marker: ArrowLineMarkerType.none }, [],
      { strokeColor: target ? '#8c76d1' : '#aaa0cf', strokeWidth: target ? 2 : 1.5 });
    gesture.preview.replaceChildren(drawArrowLine(board, gesture.line));
  };
  const schedule = (event: PointerEvent) => {
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(() => { previewFrame = null; update(event); });
  };
  board.pointerDown = event => {
    if (!PlaitBoard.isReadonly(board) && PlaitBoard.isPointer(board, PlaitPointerType.selection) && event.button === 0) {
      const selected = getSelectedDrawElements(board);
      const source = selected.length === 1 ? selected[0] : undefined;
      if (source && PlaitDrawElement.isImage(source) && isGenerationSource(source)) {
        const point = toActivePoint(board, event.clientX, event.clientY);
        const index = hitImageReferencePort(rotateAntiPointsByElement(board, point, source, true) || point, getImageReferencePorts(board, source));
        if (index >= 0) {
          event.preventDefault();
          resetAutoCompleteState(board);
          const rect = RectangleClient.getRectangleByPoints(source.points);
          const sourceConnection = IMAGE_REFERENCE_CONNECTIONS[index];
          const edgePoint: Point = [rect.x + rect.width * sourceConnection[0], rect.y + rect.height * sourceConnection[1]];
          const start = rotatePointsByElement(edgePoint, source) || edgePoint;
          const preview = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          preview.setAttribute('pointer-events', 'none');
          preview.setAttribute('data-generation-connection-preview', '');
          PlaitBoard.getElementTopHost(board).appendChild(preview);
          gesture = { source, start, pointerStart: [event.clientX, event.clientY], hitIndex: index, sourceConnection, preview };
          return;
        }
      }
    }
    pointerDown(event);
  };
  board.pointerMove = event => { if (gesture) { schedule(event); return; } pointerMove(event); hoverPorts(event); };
  board.globalPointerMove = event => { if (gesture) { schedule(event); return; } globalPointerMove(event); };
  board.pointerCancel = event => { cleanup(); pointerCancel(event); };
  board.keyDown = event => {
    if (event.key === 'Escape' && gesture) { event.preventDefault(); cleanup(); return; }
    keyDown(event);
  };
  board.globalPointerUp = event => {
    if (!gesture) { globalPointerUp(event); return; }
    update(event);
    const { source, target, line, start, pointerStart, hitIndex } = gesture;
    cleanup();
    if (isGenerationNode(target)) {
      PlaitHistoryBoard.withNewBatch(board, () => {
        addGenerationReference(board, target, source);
        clearSelectedElement(board);
        addSelectedElement(board, board.children.find(element => element.id === target.id)!);
      });
      return;
    }
    if (!line) return;
    const point = line.points[line.points.length - 1];
    const clicked = Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) <= 6;
    if (!clicked && board.children.some(element => element.id !== source.id && !PlaitDrawElement.isArrowLine(element) && board.isHit(element, point))) return;
    if (!clicked) {
      // A menu awaiting a choice is a preview, not a saved canvas operation.
      const preview = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      preview.setAttribute('pointer-events', 'none');
      preview.setAttribute('data-generation-connection-preview', '');
      preview.appendChild(drawArrowLine(board, line));
      PlaitBoard.getElementTopHost(board).appendChild(preview);
      BOARD_TO_PENDING_PREVIEW.set(board, preview);
    }
    setAutoCompleteState(board, {
      visible: true, position: { x: event.clientX + 12, y: event.clientY + 12 }, sourceElement: source,
      currentShape: BasicShapes.rectangle, hitIndex, hitPoint: start,
      mode: clicked ? 'click' : 'arrowLine', arrowLineElement: clicked ? null : line,
      arrowLineEndPoint: clicked ? null : point,
    });
  };
  return board;
}
