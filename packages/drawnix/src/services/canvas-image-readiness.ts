import type { PlaitBoard } from '@plait/core';

interface ImageRender {
  url: string;
  ready: boolean;
}

interface BoardImageReadiness {
  images: Map<string, ImageRender>;
  listeners: Set<() => void>;
}

const boards = new WeakMap<PlaitBoard, BoardImageReadiness>();

function getState(board: PlaitBoard): BoardImageReadiness {
  let state = boards.get(board);
  if (!state) {
    state = { images: new Map(), listeners: new Set() };
    boards.set(board, state);
  }
  return state;
}

// Only the actual canvas renderer can acknowledge readiness, not task previews.
export function registerCanvasImage(
  board: PlaitBoard,
  elementId: string,
  url: string
) {
  const state = getState(board);
  const render: ImageRender = { url, ready: false };
  const notify = () => state.listeners.forEach((listener) => listener());
  state.images.set(elementId, render);
  notify();

  return {
    setReady(ready: boolean) {
      if (state.images.get(elementId) !== render || render.ready === ready) {
        return;
      }
      render.ready = ready;
      notify();
    },
    dispose() {
      if (state.images.get(elementId) === render) {
        state.images.delete(elementId);
        notify();
      }
    },
  };
}

export function isCanvasImageReady(
  board: PlaitBoard,
  elementId: string,
  url: string
): boolean {
  const render = boards.get(board)?.images.get(elementId);
  return render?.url === url && render.ready;
}

export function subscribeCanvasImageReadiness(
  board: PlaitBoard,
  listener: () => void
): () => void {
  const { listeners } = getState(board);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
