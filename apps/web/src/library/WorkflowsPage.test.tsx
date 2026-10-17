/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowsPage } from './WorkflowsPage';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('WorkflowsPage', () => {
  it('opens creation without passing a click event as a model identifier', () => {
    const openCreation = vi.fn();
    render(<WorkflowsPage onGoHome={vi.fn()} onGoCreativeCenter={openCreation} onOpenWorks={vi.fn()} onOpenAccount={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '创作中心', exact: true }));
    expect(openCreation).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getAllByRole('button', { name: '使用工作流' })[0]);
    expect(openCreation).toHaveBeenLastCalledWith({
      prompt: '从一句方向开始，整理参考图、色彩和三组视觉方案。',
      mode: 'canvas',
    });
    expect(openCreation).toHaveBeenCalledTimes(2);
  });

  it('creates and displays a local workflow draft', () => {
    render(
      <WorkflowsPage
        onGoHome={vi.fn()}
        onGoCreativeCenter={vi.fn()}
        onOpenWorks={vi.fn()}
        onOpenAccount={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '新建工作流' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), {
      target: { value: '内容发布流程' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '描述' }), {
      target: { value: '整理一组发布物料' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }));

    expect(screen.getByText('内容发布流程')).toBeTruthy();
    expect(screen.getByText('我的草稿')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除内容发布流程' }));
    expect(screen.queryByText('内容发布流程')).toBeNull();
  });
});
