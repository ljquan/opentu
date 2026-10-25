import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasImageToolsDialog } from './canvas-image-tools-dialog';
import { getCanvasImageDetails } from '../../../utils/canvas-image-details';
import { getCanvasGenerationDetailsSource } from '../../../utils/canvas-generation-details-source';
import {
  clearSelectedElement,
  createBoard,
  createTestingBoard,
  getSelectedElements,
  getTemporaryRef,
  PlaitBoard,
  Transforms,
  withOptions,
  withSelection,
} from '@plait/core';
import { setCanvasBoard } from '../../../services/canvas-operations/canvas-board-ref';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  insert: vi.fn(),
  prefill: vi.fn(),
  success: vi.fn(),
  drawPreview: vi.fn(),
  associate: vi.fn(),
}));
vi.mock('tdesign-react', () => ({
  MessagePlugin: { success: mocks.success },
}));
vi.mock('../../../data/image', () => ({
  loadImageElementForCanvas: mocks.load,
}));
vi.mock('../../../services/canvas-operations/canvas-insertion', () => ({
  executeCanvasInsertion: mocks.insert,
}));
vi.mock('../../../services/ai-input-ui-events', () => ({
  requestAIInputPrefill: mocks.prefill,
}));
vi.mock('../../../plugins/canvas-association', () => ({
  createCanvasAssociationLines: mocks.associate,
}));
vi.mock('../../dialog/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
const element = {
  id: 'one',
  type: 'image',
  url: 'data:image/png;base64,eA==',
  points: [
    [0, 0],
    [100, 100],
  ],
};
const board = createBoard([element]);
beforeEach(() => {
  vi.clearAllMocks();
  clearSelectedElement(board);
  // Component logic only: the app normally resolves the mounted board container.
  vi.spyOn(PlaitBoard, 'getBoardContainer').mockReturnValue(document.body);
  setCanvasBoard(board, 'first');
  mocks.load.mockResolvedValue({ width: 100, height: 50, src: element.url });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: mocks.drawPreview,
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCanvasBoard(null);
});
describe('main canvas image tool interactions', () => {
  it.each(['resize', 'split', 'angle'] as const)(
    'renders %s previews from decoded cached pixels without reloading a virtual or expired URL',
    async (mode) => {
      const cachedElement = {
        ...element,
        url: '/__aitu_cache__/image/original.png',
      };
      const decoded = {
        width: 1920,
        height: 1080,
        src: 'blob:already-revoked',
      };
      mocks.load.mockResolvedValue(decoded);
      render(
        <CanvasImageToolsDialog
          board={board}
          element={cachedElement}
          mode={mode}
          onClose={vi.fn()}
        />
      );
      const preview = await screen.findByRole('img', {
        name: '原图与操作预览',
      });
      expect(preview.tagName).toBe('CANVAS');
      expect(preview.getAttribute('width')).toBe('498');
      expect(preview.getAttribute('height')).toBe('280');
      expect(mocks.drawPreview).toHaveBeenCalledWith(decoded, 0, 0, 498, 280);
      expect(preview.hasAttribute('src')).toBe(false);
      expect(mocks.load).toHaveBeenCalledExactlyOnceWith(cachedElement.url);
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(mocks.prefill).not.toHaveBeenCalled();
    }
  );
  it('reports preview errors without a broken image or disabling the original tool', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(
      <CanvasImageToolsDialog
        board={board}
        element={element}
        mode="angle"
        onClose={vi.fn()}
      />
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      '图片预览暂不可用'
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      screen.getByRole('button', { name: '填入生成输入栏' }).disabled
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '填入生成输入栏' }));
    expect(mocks.prefill).toHaveBeenCalledTimes(1);
  });
  it('fills angle instructions only after confirmation without submitting a generation task', async () => {
    render(
      <CanvasImageToolsDialog
        board={board}
        element={element}
        mode="angle"
        onClose={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '填入生成输入栏' }).disabled
      ).toBe(false)
    );
    expect(mocks.prefill).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('水平角度（°）'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByRole('button', { name: '填入生成输入栏' }));
    expect(mocks.prefill).toHaveBeenCalledWith(
      expect.objectContaining({
        generationType: 'image',
        prompt: expect.stringContaining('20°'),
        images: [expect.objectContaining({ url: element.url })],
      })
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('rejects stale selection when the canvas changes', async () => {
    render(
      <CanvasImageToolsDialog
        board={board}
        element={element}
        mode="angle"
        onClose={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '填入生成输入栏' }).disabled
      ).toBe(false)
    );
    setCanvasBoard(board, 'other');
    fireEvent.click(screen.getByRole('button', { name: '填入生成输入栏' }));
    expect(screen.getByRole('alert').textContent).toContain('画布已切换');
    expect(mocks.prefill).not.toHaveBeenCalled();
  });
  it('shows load failures and disables confirmation', async () => {
    mocks.load.mockRejectedValueOnce(new Error('missing'));
    render(
      <CanvasImageToolsDialog
        board={board}
        element={element}
        mode="split"
        onClose={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('图片读取失败')
    );
    expect(screen.getByRole('button', { name: '确认' }).disabled).toBe(true);
  });
  it('splits the original into four local images through the guarded insertion service', async () => {
    const draw = vi.fn();
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage: draw,
      } as unknown as CanvasRenderingContext2D);
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,bG9jYWw=');
    const onClose = vi.fn();
    mocks.insert.mockResolvedValue({ success: true, data: { items: [] } });
    try {
      render(
        <CanvasImageToolsDialog
          board={board}
          element={element}
          mode="split"
          onClose={onClose}
        />
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '确认' }).disabled).toBe(
          false
        )
      );
      draw.mockClear();
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      const insertion = mocks.insert.mock.calls[0][0];
      expect(insertion.items).toHaveLength(4);
      expect(draw.mock.calls.map((call) => call.slice(1, 5))).toEqual([
        [0, 0, 50, 25],
        [50, 0, 50, 25],
        [0, 25, 50, 25],
        [50, 25, 50, 25],
      ]);
      expect(insertion.boardGuard()).toBe(true);
      setCanvasBoard(board, 'changed');
      expect(insertion.boardGuard()).toBe(false);
      expect(board.children).toEqual([element]);
      expect(mocks.prefill).not.toHaveBeenCalled();
    } finally {
      context.mockRestore();
      encode.mockRestore();
    }
  });
  it('resizes proportionally and surfaces insertion errors without closing the editor', async () => {
    const draw = vi.fn();
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage: draw,
      } as unknown as CanvasRenderingContext2D);
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,bG9jYWw=');
    const onClose = vi.fn();
    mocks.insert.mockResolvedValue({ success: false, error: '缓存写入失败' });
    try {
      render(
        <CanvasImageToolsDialog
          board={board}
          element={element}
          mode="resize"
          onClose={onClose}
        />
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '确认' }).disabled).toBe(
          false
        )
      );
      draw.mockClear();
      fireEvent.change(screen.getByLabelText('目标长边（像素）'), {
        target: { value: '400' },
      });
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('缓存写入失败')
      );
      expect(draw.mock.calls[0].slice(-2)).toEqual([400, 200]);
      expect(mocks.insert.mock.calls[0][0].items).toHaveLength(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(mocks.prefill).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByLabelText('目标长边（像素）').disabled).toBe(false);
      expect(screen.getByRole('button', { name: '确认' }).disabled).toBe(false);
    } finally {
      context.mockRestore();
      encode.mockRestore();
    }
  });
  it('paints both resize stages before the work, blocks duplicate clicks and reports saved dimensions', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const paint = async () => {
      await act(async () => {
        const frame = frames.shift();
        if (!frame) throw new Error('Expected a pending paint frame');
        frame(0);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    const draw = vi.fn();
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage: draw,
      } as unknown as CanvasRenderingContext2D);
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,bG9jYWw=');
    let finishInsertion!: (value: unknown) => void;
    mocks.insert.mockReturnValue(
      new Promise((resolve) => {
        finishInsertion = resolve;
      })
    );
    mocks.load.mockResolvedValue({
      width: 1920,
      height: 1920,
      src: element.url,
    });
    const onClose = vi.fn();
    try {
      render(
        <CanvasImageToolsDialog
          board={board}
          element={element}
          mode="resize"
          onClose={onClose}
        />
      );
      const confirm = screen.getByRole('button', { name: '确认' });
      await waitFor(() => expect(confirm.disabled).toBe(false));
      draw.mockClear();
      fireEvent.click(confirm);
      expect(screen.getByRole('status').textContent).toContain('第 1 / 2 步');
      expect(screen.getByRole('status').textContent).toContain('3840 × 3840');
      expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
      expect(draw).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
      expect(screen.getByLabelText('目标长边（像素）').disabled).toBe(true);
      expect(screen.getByLabelText('插值方式').disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '正在处理…' }));
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      expect(onClose).not.toHaveBeenCalled();
      await paint();
      expect(screen.getByRole('status').textContent).toContain('第 2 / 2 步');
      expect(draw).toHaveBeenCalledTimes(1);
      expect(draw.mock.calls[0].slice(-2)).toEqual([3840, 3840]);
      expect(mocks.insert).not.toHaveBeenCalled();
      await paint();
      expect(mocks.insert).toHaveBeenCalledTimes(1);
      expect(mocks.insert.mock.calls[0][0].items[0].metadata).toMatchObject({
        localImageOperation: {
          type: 'resize',
          sourceWidth: 1920,
          sourceHeight: 1920,
          outputWidth: 3840,
          outputHeight: 3840,
          algorithm: 'high',
          createdAt: expect.any(Number),
        },
      });
      expect(screen.getByRole('status').textContent).toContain('第 2 / 2 步');
      expect(mocks.success).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => {
        finishInsertion({ success: true, data: { items: [] } });
      });
      expect(mocks.success).toHaveBeenCalledWith(
        expect.stringContaining('3840 × 3840'),
        4000
      );
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(board.children).toEqual([element]);
    } finally {
      context.mockRestore();
      encode.mockRestore();
    }
  });
  it('cancels resize before encoding if the board changes while waiting for paint', async () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const onClose = vi.fn();
    try {
      render(
        <CanvasImageToolsDialog
          board={board}
          element={element}
          mode="resize"
          onClose={onClose}
        />
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '确认' }).disabled).toBe(
          false
        )
      );
      context.mockClear();
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
      setCanvasBoard(board, 'other');
      await act(async () => {
        frame(0);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.getByRole('alert').textContent).toContain('画布已切换');
      expect(context).not.toHaveBeenCalled();
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      context.mockRestore();
    }
  });
  it.each([true, false])('notifies the board with the current resize node when insertion selection is pending=%s', async (selectionPending) => {
    const renderedSelection = vi.fn();
    const resizeBoard = createTestingBoard([
      (current) => {
        // Observe selection at the same onChange boundary used by the board
        // renderer, rather than only checking the WeakMap after submit.
        current.onChange = () => renderedSelection(getSelectedElements(current));
        return current;
      },
      withOptions,
      withSelection,
    ], [element]);
    setCanvasBoard(resizeBoard, 'first');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,bG9jYWw='
    );
    mocks.load.mockResolvedValue({ width: 1920, height: 1080, src: element.url });
    mocks.insert.mockImplementation(async ({ items }: {
      items: Array<{ content: string; metadata?: Record<string, unknown> }>;
    }) => {
      const resized = {
        id: 'resized-result',
        type: 'image',
        url: items[0].content,
        points: [[500, 200], [900, 425]],
      };
      Transforms.insertNode(resizeBoard, resized, [1]);
      // DrawTransforms queues selection before the insertion service patches
      // metadata. Real transforms replace nodes, leaving this pending ref old.
      Transforms.addSelectionWithTemporaryElements(resizeBoard, [resized]);
      Transforms.setNode(resizeBoard, items[0].metadata || {}, [1]);
      if (!selectionPending) {
        // Also cover the old selection task having run before insertion returns.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return {
        success: true,
        data: { items: [{ type: 'image', elementId: resized.id }] },
      };
    });
    render(
      <CanvasImageToolsDialog
        board={resizeBoard}
        element={element}
        mode="resize"
        onClose={vi.fn()}
      />
    );
    const confirm = screen.getByRole('button', { name: '确认' });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(getSelectedElements(resizeBoard).map((item) => item.id)).toEqual([
        'resized-result',
      ])
    );
    await waitFor(() => expect(getTemporaryRef(resizeBoard)).toBeUndefined());
    const selectedImage = getSelectedElements(resizeBoard)[0];
    expect(selectedImage).toBe(resizeBoard.children[1]);
    expect(renderedSelection).toHaveBeenLastCalledWith([selectedImage]);
    expect(selectedImage.localImageOperation).toMatchObject({
      type: 'resize',
      sourceWidth: 1920,
      sourceHeight: 1080,
      outputWidth: 3840,
      outputHeight: 2160,
      algorithm: 'high',
    });
    const detailsSource = getCanvasGenerationDetailsSource(selectedImage);
    if (!detailsSource) throw new Error('Resize result has no details source');
    expect(detailsSource?.localOperation).toEqual(
      selectedImage.localImageOperation
    );
    expect(getCanvasImageDetails(detailsSource).localOperation).toEqual(
      selectedImage.localImageOperation
    );
  });
});
