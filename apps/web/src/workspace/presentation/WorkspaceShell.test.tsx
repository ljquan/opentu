/* @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_INPUT_PREFILL_EVENT,
  requestAIInputCreate,
  requestMusicPlayerOpen,
} from '@drawnix/drawnix/ui-events';
import { WorkspaceShell } from './WorkspaceShell';

vi.mock('@drawnix/drawnix/ui-events', () => ({
  AI_INPUT_PREFILL_EVENT: 'aitu:ai-input-prefill',
  requestAIInputCreate: vi.fn(),
  requestMusicPlayerOpen: vi.fn(),
}));

afterEach(() => cleanup());

describe('WorkspaceShell', () => {
  it('provides a focused creation workflow and context tabs', () => {
    const onCreateBoard = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceShell
        boardName="产品探索"
        boardId="board-123456"
        elementCount={4}
        isReady
        onCreateBoard={onCreateBoard}
        onSwitchBoard={vi.fn().mockResolvedValue(undefined)}
      >
        <div data-testid="canvas">canvas</div>
      </WorkspaceShell>
    );

    expect(screen.getByText('产品探索')).toBeTruthy();
    expect(screen.getByTestId('canvas')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: '工作区上下文' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开右侧面板' }));
    expect(
      screen.getByRole('complementary', { name: '工作区上下文' })
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('属性面板画面比例'), {
      target: { value: '16x9' },
    });
    fireEvent.change(screen.getByLabelText('属性面板输出分辨率'), {
      target: { value: '2k' },
    });
    fireEvent.change(screen.getByLabelText('属性面板生成数量'), {
      target: { value: '3' },
    });

    fireEvent.change(screen.getByLabelText('AI 创作描述'), {
      target: { value: '暖色调的产品概念图' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交创作任务' }));
    expect(requestAIInputCreate).toHaveBeenCalledWith({
      generationType: 'image',
      prompt: '暖色调的产品概念图',
      model: 'gpt-image-2',
      params: {
        quality: 'high',
        resolution: '2k',
        size: '16x9',
      },
      count: 3,
    });
    expect(screen.getByRole('status').textContent).toContain(
      '创作任务已加入队列'
    );

    fireEvent.click(screen.getByRole('tab', { name: '视频' }));
    fireEvent.change(screen.getByLabelText('AI 创作描述'), {
      target: { value: '镜头缓慢推进的产品展示' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交创作任务' }));
    expect(requestAIInputCreate).toHaveBeenLastCalledWith({
      generationType: 'video',
      prompt: '镜头缓慢推进的产品展示',
      model: 'seedance-1.5-pro',
      params: undefined,
      count: 3,
    });

    fireEvent.click(screen.getByRole('tab', { name: '属性' }));
    fireEvent.click(screen.getByRole('button', { name: /高级设置/ }));
    fireEvent.click(
      screen.getByRole('button', { name: /探索 3 个产品视觉方向/ })
    );
    expect(
      (screen.getByLabelText('AI 创作描述') as HTMLInputElement).value
    ).toBe('探索 3 个产品视觉方向');
  });

  it('shows pending creation requests in the visible composer', async () => {
    render(
      <WorkspaceShell
        boardName="工作区"
        boardId="board-prefill"
        elementCount={0}
        isReady
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
      >
        <div />
      </WorkspaceShell>
    );

    window.dispatchEvent(
      new CustomEvent(AI_INPUT_PREFILL_EVENT, {
        detail: {
          generationType: 'image',
          prompt: '紫色山谷中的护肤产品主视觉',
          model: 'gpt-image-2',
          images: [{ url: 'data:image/png;base64,ref', name: '参考图.png' }],
          params: { size: '16:9', quality: 'standard' },
        },
      })
    );

    await waitFor(() => {
      expect(
        (screen.getByRole('textbox', { name: 'AI 创作描述' }) as HTMLInputElement)
          .value
      ).toBe('紫色山谷中的护肤产品主视觉');
      expect(
        (screen.getByRole('combobox', { name: '画面比例' }) as HTMLSelectElement)
          .value
      ).toBe('16x9');
      expect(screen.getByText('已带入创作描述和参考图')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '提交创作任务' }));
    expect(requestAIInputCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: '紫色山谷中的护肤产品主视觉',
        images: [{ url: 'data:image/png;base64,ref', name: '参考图.png' }],
        params: expect.objectContaining({ size: '16x9', quality: 'medium' }),
      })
    );
  });

  it('opens and filters the command palette', () => {
    render(
      <WorkspaceShell
        boardName="工作区"
        elementCount={0}
        isReady
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
        onSwitchBoard={vi.fn().mockResolvedValue(undefined)}
      >
        <div />
      </WorkspaceShell>
    );

    fireEvent.click(
      within(
        screen.getByRole('complementary', { name: '工作区导航' })
      ).getByRole('button', { name: '命令面板' })
    );
    const palette = screen.getByRole('dialog', { name: '命令面板' });
    expect(palette).toBeTruthy();
    fireEvent.change(screen.getByLabelText('搜索命令'), {
      target: { value: '素材' },
    });
    expect(screen.getByRole('button', { name: /打开素材库/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /新建创作空间/ })).toBeNull();

    fireEvent.change(screen.getByLabelText('搜索命令'), {
      target: { value: '生成' },
    });
    fireEvent.keyDown(screen.getByLabelText('搜索命令'), { key: 'Enter' });
    expect(screen.getByText('已准备好创作入口')).toBeTruthy();

    fireEvent.click(
      within(
        screen.getByRole('complementary', { name: '工作区导航' })
      ).getByRole('button', { name: '音乐播放器' })
    );
    expect(requestMusicPlayerOpen).toHaveBeenCalledTimes(1);
  });

  it('connects canvas controls and focus mode to the real workspace surface', () => {
    const zoomIn = vi.fn();
    const { container } = render(
      <WorkspaceShell
        boardName="工作区"
        elementCount={0}
        isReady
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
      >
        <button type="button" aria-label="放大 — Cmd++" onClick={zoomIn}>
          canvas zoom
        </button>
      </WorkspaceShell>
    );

    const controls = screen.getByRole('toolbar', { name: '画布快捷控制' });
    fireEvent.click(within(controls).getByRole('button', { name: '放大' }));
    expect(zoomIn).toHaveBeenCalledTimes(1);

    fireEvent.click(within(controls).getByRole('button', { name: '专注画布' }));
    expect(
      container
        .querySelector('.next-workspace')
        ?.classList.contains('next-workspace--focus')
    ).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      container
        .querySelector('.next-workspace')
        ?.classList.contains('next-workspace--focus')
    ).toBe(false);
  });

  it('keeps an empty board calm and opens the C1 starter scene on demand', () => {
    render(
      <WorkspaceShell
        boardName="空白空间"
        boardId="empty-board"
        elementCount={0}
        isReady
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
      >
        <div data-testid="canvas" />
      </WorkspaceShell>
    );

    expect(screen.getByText('从空白画布开始')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'C1 节点式创作画布' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '使用 C1 创作模板' }));
    expect(screen.getByRole('region', { name: 'C1 节点式创作画布' })).toBeTruthy();
  });

  it('allows the creation dock to collapse and reopen', () => {
    render(
      <WorkspaceShell
        boardName="工作区"
        elementCount={0}
        isReady
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
      >
        <div />
      </WorkspaceShell>
    );

    fireEvent.click(screen.getByRole('button', { name: '收起 AI 创作助手' }));
    expect(screen.getByRole('button', { name: '打开 AI 创作助手' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开 AI 创作助手' }));
    expect(screen.getByRole('textbox', { name: 'AI 创作描述' })).toBeTruthy();
  });
});
