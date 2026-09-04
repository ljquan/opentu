// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerDecompositionDialog } from './LayerDecompositionDialog';

const mocks = vi.hoisted(() => ({
  decompose: vi.fn(),
  insert: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  activeBoard: null as unknown,
}));

vi.mock('../../hooks/use-drawnix', () => ({
  useDrawnix: () => ({ board: mocks.activeBoard }),
}));

vi.mock('../../services/layer-decomposition', () => ({
  createLayerDecompositionApiClient: () => ({ decompose: mocks.decompose }),
  insertLayerDecomposition: mocks.insert,
  LayerDecompositionCorrectionRequiredError: class extends Error {},
}));

vi.mock('../dialog/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    children,
    footer,
  }: React.PropsWithChildren<{
    open: boolean;
    title: React.ReactNode;
    footer?: React.ReactNode;
  }>) =>
    open ? (
      <div>
        <div>{title}</div>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock('tdesign-react', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Progress: () => <div data-testid="progress" />,
  MessagePlugin: {
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
  },
}));

vi.mock('lucide-react', () => ({
  Layers3: () => <span aria-hidden="true" />,
  X: () => <span aria-hidden="true" />,
}));

describe('LayerDecompositionDialog one-click flow', () => {
  beforeEach(() => {
    const source = {
      id: 'source-image',
      type: 'image',
      url: 'data:image/webp;base64,UklGRg==',
      points: [
        [0, 0],
        [100, 100],
      ],
    };
    const board = { children: [source] };
    mocks.activeBoard = board;
    mocks.decompose.mockResolvedValue({
      groupId: 'group-1',
      background: { zIndex: 0 },
      layers: [{ zIndex: 1 }, { zIndex: 2 }],
      quality: { passed: true },
    });
    mocks.insert.mockResolvedValue({
      groupId: 'group-1',
      elementIds: ['background', 'layer-1', 'layer-2'],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('自动提交并应用，不显示二次确认操作', async () => {
    const onClose = vi.fn();
    const board = mocks.activeBoard as any;

    render(
      <React.StrictMode>
        <LayerDecompositionDialog
          open
          board={board}
          sourceElementId="source-image"
          imageUrl="data:image/webp;base64,UklGRg=="
          language="zh"
          automatic
          onClose={onClose}
        />
      </React.StrictMode>
    );

    expect(screen.queryByText('开始分层')).toBeNull();
    expect(screen.queryByText('应用到画布')).toBeNull();
    expect(screen.queryByText('自动识别')).toBeNull();

    await waitFor(() => {
      expect(mocks.decompose).toHaveBeenCalledTimes(1);
      expect(mocks.insert).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(mocks.decompose).toHaveBeenCalledWith(
      {
        image: 'data:image/webp;base64,UklGRg==',
        mode: 'auto',
        maxLayers: 16,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mocks.success).toHaveBeenCalledWith('已生成 3 个可编辑图层');
  });

  it('测试后端结果不会作为真实图层写入画布', async () => {
    mocks.decompose.mockResolvedValueOnce({
      groupId: 'test-group',
      background: { zIndex: 0 },
      layers: [{ zIndex: 1 }],
      resultKind: 'test',
      quality: { passed: true },
    });
    const onClose = vi.fn();
    const board = mocks.activeBoard as any;

    render(
      <LayerDecompositionDialog
        open
        board={board}
        sourceElementId="source-image"
        imageUrl="data:image/webp;base64,UklGRg=="
        language="zh"
        automatic
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(mocks.decompose).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(
      '当前为测试后端，未接入真实 AI 分层模型；源图片未修改'
    );
  });
});
