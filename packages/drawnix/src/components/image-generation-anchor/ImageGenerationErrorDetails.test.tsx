import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ImageGenerationErrorDetails } from './ImageGenerationErrorDetails';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const props = {
  phaseLabel: '失败',
  localTaskId: 'local-task',
  workflowId: 'wf-1',
  anchorType: 'ratio',
  transitionMode: 'hold',
  failure: {
    requestId: 'provider-request-full-id',
    modelId: 'gpt-image-2',
    remoteId: 'remote-task',
    error: '[HTTP 400 · policy] 请求被拒绝',
  },
};

describe('ImageGenerationErrorDetails', () => {
  it('shows all diagnostic rows together without a technical-details toggle', () => {
    const { container } = render(<ImageGenerationErrorDetails {...props} />);
    const labels = Array.from(
      container.querySelectorAll('.image-generation-anchor__detail-label')
    ).map((node) => node.textContent);
    expect(labels).toEqual([
      '阶段',
      '模型',
      '错误',
      'Request ID',
      '任务 ID',
      '本地任务',
      '工作流',
      '形态',
      '过渡',
    ]);
    expect(container.querySelector('[hidden]')).toBeNull();
    expect(screen.queryByRole('button', { name: /技术详情/ })).toBeNull();
    expect(screen.getByText('local-task')).toBeTruthy();
    expect(screen.getByText('wf-1')).toBeTruthy();
  });

  it('copies all visible diagnostics without a success row or canvas actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onClick = vi.fn();
    render(
      <div onClick={onClick}>
        <ImageGenerationErrorDetails {...props} />
      </div>
    );
    const button = screen.getByRole('button', { name: '复制 全部错误信息' });
    fireEvent.click(button);
    await waitFor(() => expect(button.title).toBe('已复制'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(writeText).toHaveBeenCalledWith(
      '阶段：失败\n模型：gpt-image-2\n错误：[HTTP 400 · policy] 请求被拒绝\nRequest ID：provider-request-full-id\n任务 ID：remote-task\n本地任务：local-task\n工作流：wf-1\n形态：ratio\n过渡：hold'
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it('reports clipboard failure and hides the optional API task row when absent', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(
      <ImageGenerationErrorDetails
        {...props}
        failure={{ ...props.failure, remoteId: undefined }}
      />
    );
    expect(screen.queryByText('任务 ID')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制 全部错误信息' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '复制 全部错误信息' }).title
      ).toContain('复制失败')
    );
  });

  it('still copies the report when provider identifiers are unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <ImageGenerationErrorDetails
        {...props}
        failure={{ error: 'Failed to fetch' }}
      />
    );
    expect(screen.getByText('未获取到')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: '复制 Request ID' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制 全部错误信息' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '阶段：失败\n模型：未记录\n错误：Failed to fetch\nRequest ID：未获取到\n本地任务：local-task\n工作流：wf-1\n形态：ratio\n过渡：hold'
      )
    );
  });
});
