import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  createTestingBoard,
  fakeNodeWeakMap,
  IS_BOARD_ALIVE,
  withHistory,
} from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgToolsButton } from './svg-tools-button';
import { inspectSvgSource } from '../../../utils/svg-source';
import { setCanvasBoard } from '../../../services/canvas-operations/canvas-board-ref';
import { setSvgPlaybackState } from '../../../services/svg-playback-state';
import type { SvgImageElement } from '../../../services/svg-canvas-edit';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  measure: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  boardId: 'board-1',
}));
vi.mock('../../../services/svg-canvas-source', () => ({
  readSvgCanvasSource: mocks.read,
}));
vi.mock('../../../services/svg-canvas-edit', () => ({
  measureSvgVectorParts: mocks.measure,
  insertEditableSvgParts: mocks.insert,
  updateSvgVectorPart: mocks.update,
}));
vi.mock('../../../services/workspace-service', () => ({
  workspaceService: { getState: () => ({ currentBoardId: mocks.boardId }) },
}));
vi.mock('tdesign-react', () => ({ MessagePlugin: { success: mocks.success } }));
vi.mock('../../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@aitu/utils', () => ({
  isPromiseLike: (value: unknown) => value instanceof Promise,
}));

const staticSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle r="10" fill="blue"/></svg>';
const animatedSvg = staticSvg.replace(
  '/></svg>',
  '><animate attributeName="r" values="10;20;10" dur="1s"/></circle></svg>'
);
const originalPause = Object.getOwnPropertyDescriptor(
  SVGSVGElement.prototype,
  'pauseAnimations'
);
function setup(imageOverrides: Partial<SvgImageElement> = {}) {
  const image: SvgImageElement = {
    id: 'svg-image',
    type: 'image',
    url: '/__aitu_cache__/image/a.svg',
    points: [
      [0, 0],
      [400, 400],
    ],
    ...imageOverrides,
  };
  const board = createTestingBoard([withHistory], [image]);
  IS_BOARD_ALIVE.set(board, true);
  fakeNodeWeakMap(board);
  setCanvasBoard(board, 'board-1');
  return { image, board };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.boardId = 'board-1';
  mocks.read.mockResolvedValue(inspectSvgSource(staticSvg));
  mocks.insert.mockResolvedValue(1);
  mocks.measure.mockResolvedValue([{}]);
  mocks.update.mockResolvedValue(undefined);
  Object.defineProperty(SVGSVGElement.prototype, 'pauseAnimations', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  setCanvasBoard(null);
  if (originalPause)
    Object.defineProperty(
      SVGSVGElement.prototype,
      'pauseAnimations',
      originalPause
    );
  else
    delete (SVGSVGElement.prototype as Partial<SVGSVGElement>).pauseAnimations;
});

describe('source-aware SVG toolbar', () => {
  it('offers an editable copy for a static vector and no fake playback control', async () => {
    const { image, board } = setup();
    render(<SvgToolsButton image={image} board={board} />);
    fireEvent.click(screen.getByRole('button', { name: 'SVG 工具' }));
    expect(await screen.findByText(/静态 SVG/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /播放 SVG|暂停 SVG/ })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '转为可编辑副本' }));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        '已创建 1 个可编辑矢量部件，原图已保留'
      )
    );
    expect(board.children).toEqual([image]);
  });
  it('requires a ready native renderer, then persists pause/resume with undo', async () => {
    const { image, board } = setup();
    mocks.read.mockResolvedValue(inspectSvgSource(animatedSvg));
    const { rerender } = render(<SvgToolsButton image={image} board={board} />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '暂停 SVG 动画' })).toBeNull();
    act(() =>
      setSvgPlaybackState(board, image.id, { url: image.url, status: 'ready' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: '暂停 SVG 动画' })
    );
    expect(board.children[0].svgPlayback).toBe('paused');
    rerender(
      <SvgToolsButton
        image={board.children[0] as SvgImageElement}
        board={board}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '播放 SVG 动画' }));
    expect(board.children[0].svgPlayback).toBe('playing');
    board.undo();
    expect(board.children[0].svgPlayback).toBe('paused');
    expect(mocks.measure).not.toHaveBeenCalled();
  });
  it('keeps raster and missing-original SVG honest about unavailable editing', async () => {
    const { image, board } = setup();
    mocks.read.mockResolvedValue(
      inspectSvgSource(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="data:image/png;base64,aQ==" width="10" height="10"/></svg>'
      )
    );
    const { unmount } = render(<SvgToolsButton image={image} board={board} />);
    fireEvent.click(screen.getByRole('button', { name: 'SVG 工具' }));
    expect(await screen.findByText(/不能作为纯矢量拆分/)).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: '转为可编辑副本',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    unmount();
    mocks.read.mockRejectedValue(new Error('SVG 原文件缓存缺失'));
    render(<SvgToolsButton image={image} board={board} />);
    fireEvent.click(screen.getByRole('button', { name: 'SVG 工具' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'SVG 原文件缓存缺失'
    );
  });
  it('edits only the selected fragment and rejects a board switch during asynchronous preparation', async () => {
    const { image, board } = setup({
      svgVectorPart: {
        version: 1,
        sourceUrl: '/original.svg',
        sourceElementId: 'original',
        partId: 'p',
        label: 'flower',
        fill: 'blue',
        text: 'Garden',
      },
    });
    const { unmount } = render(<SvgToolsButton image={image} board={board} />);
    fireEvent.click(screen.getByRole('button', { name: 'SVG 工具' }));
    fireEvent.change(await screen.findByLabelText('填充颜色'), {
      target: { value: '#ff0000' },
    });
    fireEvent.change(screen.getByLabelText('文字内容'), {
      target: { value: 'New garden' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith('SVG 部件已更新，可撤销')
    );
    expect(mocks.update.mock.calls[0][3]).toEqual({
      fill: '#ff0000',
      text: 'New garden',
    });
    unmount();
    const original = setup();
    let finish!: (value: unknown[]) => void;
    mocks.measure.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    mocks.insert.mockImplementation(
      async (_board, _image, _source, _parts, current) => {
        if (!current()) throw new Error('画布已变化');
        return 1;
      }
    );
    render(<SvgToolsButton image={original.image} board={original.board} />);
    fireEvent.click(screen.getByRole('button', { name: 'SVG 工具' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '转为可编辑副本' })
    );
    await waitFor(() => expect(mocks.measure).toHaveBeenCalled());
    mocks.boardId = 'board-2';
    finish([{}]);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '画布已变化'
    );
    expect(original.board.children).toEqual([original.image]);
  });
  it('does not read ordinary PNGs or add SVG controls to them', () => {
    const { image, board } = setup({ url: '/image.png' });
    render(<SvgToolsButton image={image} board={board} />);
    expect(screen.queryByRole('button', { name: 'SVG 工具' })).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('cancels in-flight conversion when the toolbar unmounts without inserting any nodes', async () => {
    const { image, board } = setup();
    let conversionSignal: AbortSignal | undefined;
    mocks.measure.mockImplementation((_source, signal: AbortSignal) => {
      conversionSignal = signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        })
      );
    });
    const { unmount } = render(<SvgToolsButton image={image} board={board} />);
    fireEvent.click(screen.getByRole('button', { name: 'SVG 工具' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '转为可编辑副本' })
    );
    await waitFor(() => expect(conversionSignal).toBeDefined());
    await act(async () => {
      unmount();
    });
    expect(conversionSignal?.aborted).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(board.children).toEqual([image]);
  });
});
