import type { PlaitBoard } from '@plait/core';

export const SVG_PLAYBACK_STATE_EVENT = 'aitu:svg-playback-state';
export type SvgPlaybackState = {
  url: string;
  status: 'loading' | 'ready' | 'error';
};
const states = new WeakMap<PlaitBoard, Map<string, SvgPlaybackState>>();

export function getSvgPlaybackState(
  board: PlaitBoard,
  id: string,
  url: string
): SvgPlaybackState | undefined {
  const state = states.get(board)?.get(id);
  return state?.url === url ? state : undefined;
}

export function setSvgPlaybackState(
  board: PlaitBoard,
  id: string,
  state?: SvgPlaybackState
): void {
  let entries = states.get(board);
  if (!entries) {
    entries = new Map();
    states.set(board, entries);
  }
  if (state) entries.set(id, state);
  else entries.delete(id);
  window.dispatchEvent(
    new CustomEvent(SVG_PLAYBACK_STATE_EVENT, { detail: { board, id } })
  );
}
