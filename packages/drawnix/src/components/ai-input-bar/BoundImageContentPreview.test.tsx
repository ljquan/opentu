// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { BoundImageContentPreview } from './BoundImageContentPreview';

const { exportMask, findMasks } = vi.hoisted(() => ({
  exportMask: vi.fn(), findMasks: vi.fn(),
}));
vi.mock('../../utils/selection-utils', () => ({
  AI_SELECTION_CONTENT_REFRESH_EVENT: 'mask-preview-refresh',
  getImageMaskEditForAI: exportMask,
}));
vi.mock('../../utils/ai-mask-brush', () => ({
  isMaskBrushEligibleImage: (element: { type?: string } | undefined) => element?.type === 'image',
  findMaskBrushesForImage: findMasks,
}));
vi.mock('../retry-image', () => ({ RetryImage: (props: { src: string; alt: string }) => <img src={props.src} alt={props.alt} /> }));
vi.mock('../shared/hover', () => ({ HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const image = { id: 'cups', type: 'image', url: '/cups.png', points: [[0, 0], [400, 400]] };
const target = { type: 'image', elementId: 'cups', url: image.url };
const board = { children: [image] } as unknown as PlaitBoard;
const items = [{ type: 'image' as const, url: image.url, name: '参考图' }];

beforeEach(() => {
  vi.useFakeTimers();
  findMasks.mockReset().mockReturnValue([{ id: 'left', points: [[80, 160]], strokeWidth: 20 }]);
  exportMask.mockReset().mockResolvedValue({ url: image.url, maskImage: '/mask.png', width: 1254, height: 1254 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flushPreview() {
  await act(async () => { await vi.advanceTimersByTimeAsync(60); });
}

describe('bound image content preview', () => {
  it('绑定图片缩略图与悬停大图均显示独立蒙版', async () => {
    render(<BoundImageContentPreview board={board} target={target} items={items} language="zh" />);
    await flushPreview();
    expect(screen.getByAltText('参考图 mask').getAttribute('src')).toBe('/mask.png');
    fireEvent.mouseEnter(screen.getByAltText('参考图').parentElement!.parentElement!);
    expect(screen.getByAltText('Preview mask').getAttribute('src')).toBe('/mask.png');
    expect(exportMask).toHaveBeenCalledWith(board, 'cups');
  });

  it('鼠标移动不导出蒙版，点击输入栏也不重复导出未变化的笔迹', async () => {
    render(<BoundImageContentPreview board={board} target={target} items={items} />);
    await flushPreview();
    fireEvent.pointerMove(document);
    fireEvent.pointerUp(document);
    await flushPreview();
    expect(exportMask).toHaveBeenCalledTimes(1);
  });

  it('新增笔迹后刷新预览，包括已经打开的悬停大图', async () => {
    render(<BoundImageContentPreview board={board} target={target} items={items} />);
    await flushPreview();
    fireEvent.mouseEnter(screen.getByAltText('参考图').parentElement!.parentElement!);
    findMasks.mockReturnValue([{ id: 'left', points: [[90, 170]], strokeWidth: 30 }]);
    exportMask.mockResolvedValueOnce({ url: image.url, maskImage: '/updated-mask.png' });
    fireEvent.pointerUp(document);
    await flushPreview();
    expect(screen.getByAltText('参考图 mask').getAttribute('src')).toBe('/updated-mask.png');
    expect(screen.getByAltText('Preview mask').getAttribute('src')).toBe('/updated-mask.png');
  });

  it('移除蒙版笔迹后不保留旧蒙版', async () => {
    render(<BoundImageContentPreview board={board} target={target} items={items} />);
    await flushPreview();
    fireEvent.mouseEnter(screen.getByAltText('参考图').parentElement!.parentElement!);
    findMasks.mockReturnValue([]);
    fireEvent.keyUp(document, { key: 'Delete' });
    await flushPreview();
    expect(screen.queryByAltText('参考图 mask')).toBeNull();
    expect(screen.queryByAltText('Preview mask')).toBeNull();
    expect(exportMask).toHaveBeenCalledTimes(1);
  });

  it('换图后忽略前一张图片的迟到预览', async () => {
    let resolveOld!: (value: { url: string; maskImage: string }) => void;
    exportMask.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const { rerender } = render(<BoundImageContentPreview board={board} target={target} items={items} />);
    rerender(<BoundImageContentPreview board={board} target={null} items={[{ type: 'image', url: '/other.png', name: 'other' }]} />);
    await act(async () => { resolveOld({ url: image.url, maskImage: '/old-mask.png' }); });
    expect(screen.queryByAltText('other mask')).toBeNull();
    expect(screen.getByAltText('other').getAttribute('src')).toBe('/other.png');
  });

  it('导出失败显示错误，下一次选区刷新可以重试', async () => {
    exportMask.mockRejectedValueOnce(new Error('cache missing'));
    render(<BoundImageContentPreview board={board} target={target} items={items} language="zh" />);
    await flushPreview();
    expect(screen.getByRole('alert').textContent).toBe('蒙版预览失败');
    fireEvent(document, new Event('mask-preview-refresh'));
    await flushPreview();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByAltText('参考图 mask')).toBeTruthy();
  });
});
