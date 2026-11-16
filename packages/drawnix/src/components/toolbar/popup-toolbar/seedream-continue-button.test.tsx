import React from 'react';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createBoard } from '@plait/core';
import { SeedreamContinueButton } from './seedream-continue-button';
import { setCanvasBoard } from '../../../services/canvas-operations/canvas-board-ref';
import { TaskStatus, TaskType, type Task } from '../../../types/task.types';
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  prefill: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock('../../../services/task-queue', () => ({
  taskQueueService: { findImageTaskByResultUrl: mocks.find },
}));
vi.mock('../../../services/ai-input-ui-events', () => ({
  requestAIInputPrefill: mocks.prefill,
}));
vi.mock('tdesign-react', () => ({
  MessagePlugin: { warning: mocks.warning, info: mocks.info },
}));
vi.mock('../../shared/hover', () => ({
  HoverTip: ({ children }: React.PropsWithChildren) => children,
}));
const element = { id: 'selected', type: 'image', url: '/second.png' };
const board = createBoard([element]);
function task(model = 'doubao-seedream-5-5-261028'): Task {
  return {
    id: 'task',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    createdAt: 1,
    updatedAt: 1,
    params: {
      prompt: 'first',
      model,
      referenceImages: ['/source.png'],
      params: { watermark: 'false' },
    },
    result: {
      url: '/first.png',
      urls: ['/first.png', '/second.png'],
      format: 'png',
      size: 1,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  board.children = [element];
  setCanvasBoard(board, 'b');
  mocks.find.mockResolvedValue(task());
});
afterEach(() => {
  cleanup();
  setCanvasBoard(null);
});
it('clicking the native button prefills the selected output, not the first output, without generation', async () => {
  render(<SeedreamContinueButton board={board} element={element} />);
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(mocks.prefill).toHaveBeenCalledOnce();
  expect(mocks.prefill.mock.calls[0][0]).toMatchObject({
    requireExactModelRef: true,
    prompt: '',
    count: 1,
    images: [
      { url: '/second.png', sourceElementId: 'selected' },
      { url: '/source.png' },
    ],
  });
});
it('does not offer continuation for other models or missing history', async () => {
  mocks.find.mockResolvedValue(undefined);
  const { rerender } = render(
    <SeedreamContinueButton board={board} element={element} />
  );
  await waitFor(() => expect(mocks.find).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button')).toBeNull();
  mocks.find.mockResolvedValue(task('gpt-image-2'));
  rerender(
    <SeedreamContinueButton
      board={board}
      element={{ ...element, url: '/other.png' }}
    />
  );
  await waitFor(() => expect(mocks.find).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button')).toBeNull();
  expect(mocks.prefill).not.toHaveBeenCalled();
});
it('rejects a deleted image and shows reference overflow without discarding images', async () => {
  const history = task();
  history.params.referenceImages = Array.from(
    { length: 10 },
    (_, i) => `/ref-${i}.png`
  );
  mocks.find.mockResolvedValue(history);
  render(<SeedreamContinueButton board={board} element={element} />);
  const button = await screen.findByRole('button', { name: '继续编辑' });
  fireEvent.click(button);
  expect(mocks.prefill.mock.calls[0][0].images).toHaveLength(11);
  expect(mocks.warning).toHaveBeenCalledWith(
    expect.stringContaining('超过 10')
  );
  board.children = [];
  fireEvent.click(button);
  expect(mocks.prefill).toHaveBeenCalledOnce();
});
