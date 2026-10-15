// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SunoNativePage } from './SunoNativePage';
import type { ModelConfig } from '../../../constants/model-config';
import type { MusicAnalysisRecord } from '../types';
const { createTask, updateRecord } = vi.hoisted(() => ({ createTask: vi.fn(), updateRecord: vi.fn() }));
vi.mock('../../../hooks/useTaskQueue', () => ({ useTaskQueue: () => ({ tasks: [], cancelTask: vi.fn() }) }));
vi.mock('../../../services/task-queue', () => ({ taskQueueService: { createTask } }));
vi.mock('../../../services/provider-routing', () => ({ resolveInvocationPlanFromRoute: () => ({ provider: { profileId: 'p' }, binding: { protocol: 'tuzi.suno.native' } }) }));
vi.mock('../storage', () => ({ updateRecord }));
vi.mock('../../ai-input-bar/ModelDropdown', () => ({ ModelDropdown: () => null }));
const base: MusicAnalysisRecord = { id: 'record', createdAt: 1, source: 'scratch', sourceLabel: '新建', starred: false };
function show(patch: Partial<MusicAnalysisRecord> = {}, configured = true) {
  render(<SunoNativePage record={{ ...base, ...patch }} model="suno_act_mp4" modelRef={{ profileId: 'p', modelId: 'suno_act_mp4' }}
    models={configured ? [{ id: 'suno_act_mp4', sourceProfileId: 'p' }] as ModelConfig[] : []} onSelectModel={vi.fn()} onRecordUpdate={vi.fn()} onRecordsChange={vi.fn()} />);
}
beforeEach(() => { vi.clearAllMocks(); createTask.mockReturnValue({ id: 'new-task' }); updateRecord.mockImplementation(async (_id, patch) => [{ ...base, ...patch }]); });
afterEach(cleanup);

describe('native Suno music tool', () => {
  it('submits MP4 with public source IDs and exact callback/branding fields', async () => {
    show({ sunoNativeResults: [{ taskId: 'local', result: { action: 'generate', profileId: 'p', resources: [{ profileId: 'p', sourceAction: 'generate', taskId: 'public-task', audioId: 'public-audio', title: 'My song' }], files: [], lyrics: [], data: {} } }] });
    const source = screen.getByRole('combobox', { name: '从已完成结果填入资源' }) as HTMLSelectElement;
    fireEvent.change(source, { target: { value: source.options[1].value } });
    fireEvent.change(screen.getByRole('textbox', { name: /^回调地址/ }), { target: { value: 'https://callback.test' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^视频作者/ }), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'MP4 音乐视频' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledOnce());
    expect(createTask.mock.calls[0][0]).toMatchObject({ model: 'suno_act_mp4', autoInsertToCanvas: false,
      params: { sunoNativeAction: 'mp4', sunoNativeBody: { taskId: 'public-task', audioId: 'public-audio', callBackUrl: 'https://callback.test', author: 'Alice' } } });
  });
  it('switches action fields, clears stale MP4 parameters, and allows synchronous credits without a prompt', async () => {
    show({ sunoNativeDrafts: { suno_act_mp4: { author: 'Old author', taskId: 'old-task', callBackUrl: 'https://callback.test' } } });
    fireEvent.change(screen.getByRole('combobox', { name: '制作动作' }), { target: { value: 'credits' } });
    expect(screen.queryByRole('textbox', { name: /^视频作者/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查询上游剩余额度' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledOnce());
    expect(createTask.mock.calls[0][0].params).toMatchObject({ sunoNativeAction: 'credits', sunoNativeBody: {} });
  });
  it('reports missing prerequisite fields before queueing and disables unconfigured providers', async () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'MP4 音乐视频' }));
    expect(await screen.findByText('缺少必填参数 taskId')).toBeTruthy(); expect(createTask).not.toHaveBeenCalled();
    cleanup(); show({}, false);
    expect((screen.getByRole('button', { name: 'MP4 音乐视频' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
