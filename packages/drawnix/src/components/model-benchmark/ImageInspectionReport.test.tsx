// @vitest-environment jsdom
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageInspectionReport } from './ImageInspectionReport';

const mocks = vi.hoisted(() => ({
  client: {
    getModels: vi.fn(),
    createRun: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    stopRun: vi.fn(),
    exportRun: vi.fn(),
  },
}));

vi.mock('tdesign-react', () => ({
  Input: ({
    value,
    onChange,
    ...props
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      {...props}
    />
  ),
  MessagePlugin: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../utils/settings-manager', () => ({
  providerProfilesSettings: {
    get: () => [
      {
        id: 'tuzi',
        name: 'Tuzi',
        enabled: true,
        apiKey: 'test-token',
        baseUrl: 'https://api.tu-zi.com',
      },
    ],
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('../../services/image-inspection-api', () => ({
  createImageInspectionApiClient: () => mocks.client,
  isImageInspectionRunActive: (status: string) =>
    status === 'pending' || status === 'running',
  selectImageInspectionProfile: (profiles: unknown[]) => profiles[0] || null,
}));

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

function setDocumentVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
}

describe('ImageInspectionReport connectivity events', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    setNavigatorOnline(true);
    setDocumentVisibility('visible');
    mocks.client.getModels.mockResolvedValue({ models: [], groups: {} });
    mocks.client.listRuns.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    setNavigatorOnline(true);
    setDocumentVisibility('visible');
  });

  it.each(['focus', 'pageshow'])(
    '%s 时离线不会误显示在线或触发刷新',
    async (eventName) => {
      render(<ImageInspectionReport />);

      await waitFor(() =>
        expect(mocks.client.listRuns).toHaveBeenCalledTimes(1)
      );

      setNavigatorOnline(false);
      act(() => {
        window.dispatchEvent(new Event(eventName));
      });

      expect(
        await screen.findByText(/网络已断开；服务端巡检仍在后台继续运行/)
      ).toBeTruthy();
      expect(mocks.client.listRuns).toHaveBeenCalledTimes(1);
    }
  );

  it('恢复在线并聚焦时立即刷新报表', async () => {
    render(<ImageInspectionReport />);

    await waitFor(() => expect(mocks.client.listRuns).toHaveBeenCalledTimes(1));

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mocks.client.listRuns).toHaveBeenCalledTimes(2));
  });

  it('连续恢复事件合并为一次后续刷新，不会互相取消', async () => {
    let resolveFirst: ((runs: unknown[]) => void) | null = null;
    mocks.client.listRuns
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValue([]);
    render(<ImageInspectionReport />);
    await waitFor(() => expect(mocks.client.listRuns).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mocks.client.listRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.client.listRuns).toHaveBeenCalledTimes(2));
    expect(mocks.client.listRuns).toHaveBeenCalledTimes(2);
  });

  it('页面隐藏时停止轮询，重新可见后立即同步', async () => {
    render(<ImageInspectionReport />);
    await waitFor(() => expect(mocks.client.listRuns).toHaveBeenCalledTimes(1));

    setDocumentVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(mocks.client.listRuns).toHaveBeenCalledTimes(1);

    setDocumentVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(mocks.client.listRuns).toHaveBeenCalledTimes(2));
  });

  it('组件卸载时会取消尚未完成的启动请求', async () => {
    mocks.client.createRun.mockImplementation(
      (_prompt: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const view = render(<ImageInspectionReport />);
    await waitFor(() => expect(mocks.client.listRuns).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '立即运行一次' }));
    await waitFor(() =>
      expect(mocks.client.createRun).toHaveBeenCalledTimes(1)
    );
    const signal = mocks.client.createRun.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    view.unmount();

    expect(signal.aborted).toBe(true);
  });

  it('同一时间只挂载一张实际图片预览', async () => {
    const run = {
      id: 1,
      status: 'completed',
      trigger_type: 'manual',
      total_cases: 2,
      passed_cases: 2,
      warning_cases: 0,
      failed_cases: 0,
      stopped_cases: 0,
      created_at: 1,
    };
    const imageCase = (id: number) => ({
      id,
      group: 'default',
      model: 'gpt-image-2',
      aspect_ratio: '1x1',
      requested_resolution: '1k',
      requested_size: '1024x1024',
      expected_width: 1024,
      expected_height: 1024,
      actual_width: 1024,
      actual_height: 1024,
      status: 'passed',
      task_id: `task-${id}`,
      image_url: `https://example.com/${id}.png`,
      duration_ms: 1000,
      formula: '1024 × 1024',
      message: '通过',
      error: '',
      started_at: 1,
      finished_at: 2,
    });
    mocks.client.listRuns.mockResolvedValue([run]);
    mocks.client.getRun.mockResolvedValue({
      run,
      cases: [imageCase(1), imageCase(2)],
      caseTotal: 2,
    });
    render(<ImageInspectionReport />);
    const summaries = await screen.findAllByText('查看图片');

    fireEvent.click(summaries[0]);
    expect(
      (await screen.findByAltText('default gpt-image-2')).getAttribute('src')
    ).toBe('https://example.com/1.png');
    fireEvent.click(summaries[1]);

    await waitFor(() =>
      expect(
        screen.getByAltText('default gpt-image-2').getAttribute('src')
      ).toBe('https://example.com/2.png')
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
