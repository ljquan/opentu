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
import { Seedream55LayerDialog } from './Seedream55LayerDialog';
import { setCanvasBoard } from '../../services/canvas-operations/canvas-board-ref';
const mocks = vi.hoisted(() => ({ run: vi.fn(), board: null as unknown }));
vi.mock('../../hooks/use-drawnix', () => ({
  useDrawnix: () => ({ board: mocks.board }),
}));
vi.mock('../../services/layer-decomposition/seedream55', () => ({
  decomposeSeedream55: mocks.run,
}));
vi.mock('../dialog/ConfirmDialog', () => ({
  ConfirmDialog: ({
    children,
    footer,
  }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock('tdesign-react', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
const source = { id: 'source', type: 'image', url: '/source.png' };
const board = createBoard([source]);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.board = board;
  setCanvasBoard(board, 'b');
  mocks.run.mockResolvedValue({ layerCount: 17, textLayerCount: 3 });
});
afterEach(() => {
  cleanup();
  setCanvasBoard(null);
});
it('does not submit on open, defaults to 16, and forwards user-selected 99/OCR=false', async () => {
  render(
    <Seedream55LayerDialog board={board} source={source} onClose={vi.fn()} />
  );
  expect(mocks.run).not.toHaveBeenCalled();
  const count = screen.getByRole('spinbutton', {
    name: '最多前景图层（1–99）',
  }) as HTMLInputElement;
  expect(count.value).toBe('16');
  fireEvent.change(count, { target: { value: '99' } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText(/最多返回 100 张图片/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '开始分层' }));
  await screen.findByText(/已生成 17 张图层/);
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0][2]).toMatchObject({
    maxLayers: 99,
    textRecognition: false,
  });
  expect(screen.queryByRole('button', { name: '开始分层' })).toBeNull();
});
it.each(['', '0', '100', '1.5'])('blocks invalid limit %s', (value) => {
  render(
    <Seedream55LayerDialog board={board} source={source} onClose={vi.fn()} />
  );
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '开始分层' }));
  expect(mocks.run).not.toHaveBeenCalled();
});
it('prevents duplicate submissions and aborts on cancel', async () => {
  let complete!: (result: unknown) => void;
  mocks.run.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const close = vi.fn();
  render(
    <Seedream55LayerDialog board={board} source={source} onClose={close} />
  );
  const start = screen.getByRole('button', { name: '开始分层' });
  fireEvent.click(start);
  fireEvent.click(start);
  expect(mocks.run).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '取消等待' }));
  expect(mocks.run.mock.calls[0][2].signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  complete({ layerCount: 17, textLayerCount: 0 });
  await waitFor(() => expect(screen.queryByText(/已生成/)).toBeNull());
});
it('reports failure without automatic resubmission', async () => {
  mocks.run.mockRejectedValue(new Error('network interrupted'));
  render(
    <Seedream55LayerDialog board={board} source={source} onClose={vi.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: '开始分层' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    '先核对调用记录'
  );
  expect(mocks.run).toHaveBeenCalledOnce();
});
it('aborts when the active board changes', () => {
  mocks.run.mockReturnValue(new Promise(() => undefined));
  const close = vi.fn();
  const { rerender } = render(
    <Seedream55LayerDialog board={board} source={source} onClose={close} />
  );
  fireEvent.click(screen.getByRole('button', { name: '开始分层' }));
  mocks.board = createBoard([]);
  rerender(
    <Seedream55LayerDialog board={board} source={source} onClose={close} />
  );
  expect(mocks.run.mock.calls[0][2].signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});
it('offers only retrieval after a submitted request fails', async () => {
  const recovery = { requestId: 'req-existing', recover: vi.fn() };
  mocks.run
    .mockImplementationOnce(async (_binding, _source, options) => {
      options.onRecoveryAvailable(recovery);
      throw new Error('连接中断');
    })
    .mockResolvedValueOnce({ layerCount: 3, textLayerCount: 1 });
  render(
    <Seedream55LayerDialog board={board} source={source} onClose={vi.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: '开始分层' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '开始分层' })).toBeNull();
  expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(
    true
  );
  expect(screen.getByText(/req-existing/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '获取已有结果' }));
  await screen.findByText(/已生成 3 张图层/);
  expect(mocks.run.mock.calls[1][2].recovery).toBe(recovery);
});
it('closes a recovery session when the selected source changes', () => {
  mocks.run.mockReturnValue(new Promise(() => undefined));
  const close = vi.fn();
  const { rerender } = render(
    <Seedream55LayerDialog board={board} source={source} onClose={close} />
  );
  fireEvent.click(screen.getByRole('button', { name: '开始分层' }));
  rerender(
    <Seedream55LayerDialog
      board={board}
      source={{ ...source, id: 'other' }}
      onClose={close}
    />
  );
  expect(mocks.run.mock.calls[0][2].signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});
