import { requestAIInputPrefill, requestCanvasImageEdit } from '../services/ai-input-ui-events';
import { getCanvasBoardBinding } from '../services/canvas-operations/canvas-board-ref';
import { createGenerationNode, isGenerationSource } from '../services/generation-node';
import { useState, useEffect, useCallback } from 'react';
import { PlaitBoard, PlaitHistoryBoard, Transforms, RectangleClient } from '@plait/core';
import { BasicShapes, DrawPointerType, PlaitDrawElement } from '@plait/draw';
import {
  AutoCompleteShapeState,
  getAutoCompleteState,
  registerAutoCompleteStateCallback,
  resetAutoCompleteState,
  createAutoCompleteElements,
  createShapeForArrowLine,
} from '../plugins/with-arrow-line-auto-complete-extend';

const initialState: AutoCompleteShapeState = {
  visible: false,
  position: { x: 0, y: 0 },
  sourceElement: null,
  currentShape: null,
  hitIndex: -1,
  hitPoint: null,
  mode: 'hover',
};

/**
 * 连接插件状态和 React 组件的 Hook
 */
export function useAutoCompleteShapePicker(board: PlaitBoard | null) {
  const [state, setState] = useState<AutoCompleteShapeState>(initialState);

  // 注册状态回调
  useEffect(() => {
    if (!board) return;

    // 初始化状态
    setState(getAutoCompleteState(board));

    // 注册回调
    const unregister = registerAutoCompleteStateCallback(board, (newState) => {
      setState(newState);
    });

    return () => {
      unregister();
    };
  }, [board]);

  // 选择形状并创建元素
  const selectShape = useCallback((shape: DrawPointerType) => {
    if (!board) return;
    
    const currentState = getAutoCompleteState(board);
    
    if (currentState.mode === 'arrowLine') {
      // 箭头线模式：为已存在的箭头线创建形状
      if (currentState.arrowLineElement && currentState.arrowLineEndPoint) {
        createShapeForArrowLine(
          board,
          currentState.arrowLineElement,
          currentState.arrowLineEndPoint,
          shape
        );
      }
    } else {
      // hover 模式：创建并插入连接线和新形状
      if (currentState.sourceElement && 
          currentState.hitPoint && 
          currentState.hitIndex >= 0) {
        createAutoCompleteElements(
          board,
          currentState.sourceElement as PlaitDrawElement,
          currentState.hitIndex,
          currentState.hitPoint,
          shape
        );
      }
    }
    // 状态重置已在 createAutoCompleteElements/createShapeForArrowLine 内部完成
  }, [board]);

  // 关闭选择器
  const closePicker = useCallback(() => {
    if (!board) return;
    const pending = getAutoCompleteState(board);
    if (isGenerationSource(pending.sourceElement || undefined) && pending.arrowLineElement) {
      const index = board.children.findIndex(element => element.id === pending.arrowLineElement?.id);
      if (index >= 0) PlaitHistoryBoard.withMerging(board, () => Transforms.removeNode(board, [index]));
    }
    resetAutoCompleteState(board);
  }, [board]);

  const selectGeneration = useCallback((type: 'image' | 'video' | 'text' | 'edit' | 'line') => {
    if (!board) return;
    const pending = getAutoCompleteState(board);
    const source = board.children.find(element => element.id === pending.sourceElement?.id);
    if (!source || !isGenerationSource(source)) { resetAutoCompleteState(board); return; }
    if (type === 'text' || type === 'edit') {
      const index = board.children.findIndex(element => element.id === pending.arrowLineElement?.id);
      if (index >= 0) PlaitHistoryBoard.withMerging(board, () => Transforms.removeNode(board, [index]));
      resetAutoCompleteState(board);
      const boardId = getCanvasBoardBinding()?.boardId || undefined;
      if (type === 'edit') requestCanvasImageEdit({ elementId: source.id, boardId });
      else requestAIInputPrefill({
        intent: 'edit', source: 'canvas-toolbar', boardId, generationType: 'text',
        prompt: '', count: 1,
        images: [{ url: source.url, name: source.name || '参考图', sourceElementId: source.id, sourceElementUrl: source.url }],
      });
      return;
    }
    if (type !== 'line') {
      const rect = RectangleClient.getRectangleByPoints(source.points || []);
      const drop = pending.arrowLineEndPoint;
      const point: [number, number] = drop
        ? [drop[0] - (pending.hitIndex === 2 ? 344 : pending.hitIndex % 2 ? 172 : 0), drop[1] - (pending.hitIndex === 3 ? 224 : 0)]
        : pending.hitIndex === 1 ? [rect.x + rect.width / 2 - 172, rect.y + rect.height + 100]
        : pending.hitIndex === 3 ? [rect.x + rect.width / 2 - 172, rect.y - 324]
        : [pending.hitIndex === 2 ? rect.x - 444 : rect.x + rect.width + 100, rect.y];
      const existingLine = board.children.some(element => element.id === pending.arrowLineElement?.id);
      if (existingLine) {
        const index = board.children.findIndex(element => element.id === pending.arrowLineElement?.id);
        if (index >= 0) PlaitHistoryBoard.withMerging(board, () => Transforms.removeNode(board, [index]));
      }
      const create = () => createGenerationNode(board, point, type, source);
      if (existingLine) PlaitHistoryBoard.withMerging(board, create);
      else PlaitHistoryBoard.withNewBatch(board, create);
    } else if (pending.arrowLineElement && !board.children.some(element => element.id === pending.arrowLineElement?.id)) {
      PlaitHistoryBoard.withNewBatch(board, () => Transforms.insertNode(board, pending.arrowLineElement!, [board.children.length]));
    } else if ((pending.mode === 'hover' || pending.mode === 'click') && pending.hitPoint && pending.hitIndex >= 0) {
      // Clicking an image port retains the ordinary shape connection action.
      createAutoCompleteElements(board, source as PlaitDrawElement, (pending.hitIndex + 1) % 4, pending.hitPoint, pending.currentShape || BasicShapes.rectangle);
    }
    resetAutoCompleteState(board);
  }, [board]);

  return {
    state,
    selectShape,
    selectGeneration,
    closePicker,
  };
}
