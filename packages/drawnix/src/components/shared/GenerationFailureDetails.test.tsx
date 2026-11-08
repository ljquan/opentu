import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationFailureDetails } from './GenerationFailureDetails';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const details = {
  requestId: 'provider-id',
  error: '[HTTP 404 · model_not_found] Model not found',
  modelId: 'actual-model',
  remoteId: 'remote-task',
};

describe('compact generation failure details', () => {
  it('shows only the four requested fields and omits absent remote IDs', () => {
    const { container, rerender } = render(
      <GenerationFailureDetails details={details} />
    );
    expect(
      Array.from(
        container.querySelectorAll('.generation-failure-details__label')
      ).map((el) => el.textContent)
    ).toEqual(['Request ID', '错误', '模型', '任务 ID']);
    rerender(
      <GenerationFailureDetails
        details={{ ...details, remoteId: undefined, requestId: undefined }}
      />
    );
    expect(screen.queryByText('任务 ID')).toBeNull();
    expect(
      screen.queryByRole('button', { name: '复制 Request ID' })
    ).toBeNull();
    expect(screen.getByText('未获取到')).toBeTruthy();
  });
  it('copies the complete formatted report without feedback rows or canvas selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const click = vi.fn();
    const { container } = render(
      <div onClick={click}>
        <GenerationFailureDetails details={details} />
      </div>
    );
    const rows = container.querySelectorAll(
      '.generation-failure-details__row'
    ).length;
    const button = screen.getByRole('button', { name: '复制 全部错误信息' });
    fireEvent.click(button);
    await waitFor(() => expect(button.title).toBe('已复制'));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(writeText).toHaveBeenCalledWith(
      'Request ID：provider-id\n错误：[HTTP 404 · model_not_found] Model not found\n模型：actual-model\n任务 ID：remote-task'
    );
    expect(click).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('.generation-failure-details__row').length
    ).toBe(rows);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('copies missing-ID placeholders and indents multiline errors without an empty task row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <GenerationFailureDetails
        details={{
          error: 'Rejected\r\nMore details',
          requestId: undefined,
          modelId: undefined,
          remoteId: undefined,
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '复制 全部错误信息' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'Request ID：未获取到\n错误：Rejected\n  More details\n模型：未记录'
      )
    );
  });
});
