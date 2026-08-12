import type { PlaitBoard } from '@plait/core';

export interface CanvasBoardBinding {
  board: PlaitBoard;
  boardId: string | null;
}

let boardBinding: CanvasBoardBinding | null = null;

export function setCanvasBoard(
  board: PlaitBoard | null,
  boardId?: string | null
): void {
  boardBinding = board ? { board, boardId: boardId?.trim() || null } : null;
}

export function clearCanvasBoard(board: PlaitBoard): void {
  if (boardBinding?.board === board) boardBinding = null;
}

export function getCanvasBoard(): PlaitBoard | null {
  return boardBinding?.board || null;
}

export function getCanvasBoardBinding(): CanvasBoardBinding | null {
  return boardBinding;
}
