// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SunoV2Page } from './SunoV2Page';
import { SUNO_V2_ACTIONS, type SunoV2Resource } from '../../../services/suno-v2';
import type { ModelConfig } from '../../../constants/model-config';
import type { MusicAnalysisRecord } from '../types';

const { createTask, updateRecord, onSelectModel } = vi.hoisted(() => ({
  createTask: vi.fn(), updateRecord: vi.fn(), onSelectModel: vi.fn(),
}));
vi.mock('../../../hooks/useTaskQueue', () => ({ useTaskQueue: () => ({ tasks: [], cancelTask: vi.fn() }) }));
vi.mock('../../../services/task-queue', () => ({ taskQueueService: { createTask } }));
vi.mock('../../../services/provider-routing', () => ({ resolveInvocationPlanFromRoute: () => ({
  provider: { profileId: 'p' }, binding: { protocol: 'tuzi.suno.v2' },
}) }));
vi.mock('../storage', () => ({ updateRecord }));
// ModelDropdown has its own settings/pricing subscriptions; selection is controlled by this page's parent.
vi.mock('../../ai-input-bar/ModelDropdown', () => ({ ModelDropdown: () => null }));
vi.mock('../../shared/hover/HoverTip', () => ({ HoverTip: ({ children }: { children: React.ReactNode }) => children }));

const base: MusicAnalysisRecord = { id: 'record', createdAt: 1, source: 'scratch', sourceLabel: '新建', starred: false };
const models = SUNO_V2_ACTIONS.map((action) => ({ id: action.model, sourceProfileId: 'p' })) as ModelConfig[];
function show(model: string, patch: Partial<MusicAnalysisRecord> = {}) {
  render(<SunoV2Page record={{ ...base, ...patch }} model={model} modelRef={{ profileId: 'p', modelId: model }}
    models={models} onSelectModel={onSelectModel} onRecordUpdate={vi.fn()} onRecordsChange={vi.fn()} />);
}
function result(resource: SunoV2Resource) {
  return [{ taskId: 'previous', result: { action: resource.kind === 'model_id' ? 'create-model' : 'persona',
    profileId: resource.profileId, resources: [resource], files: [], lyrics: [], data: {} } }];
}
beforeEach(() => {
  vi.clearAllMocks();
  createTask.mockReturnValue({ id: 'new-task' });
  updateRecord.mockImplementation(async (_id, patch) => [{ ...base, ...patch }]);
});
afterEach(cleanup);

describe('Suno music tool parameter submission', () => {
  it.each(['suno/create-voice', 'suno/add-instrumental', 'suno/add-vocals'])('disables a saved excluded model %s and hides its parameters', (model) => {
    show(model);
    const option = screen.getByRole('option', { name: /未开放/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(screen.queryByRole('textbox', { name: '音频地址' })).toBeNull();
    const submit = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true); fireEvent.click(submit);
    expect(createTask).not.toHaveBeenCalled();
  });
  it('omits excluded models from available actions and result follow-ups', () => {
    show('suno/music', { sunoV2Results: result({ id: 'music', kind: 'music_id', profileId: 'p' }) });
    const selector = screen.getByRole('combobox', { name: '制作动作' }) as HTMLSelectElement;
    for (const id of ['suno/create-voice', 'suno/add-instrumental', 'suno/add-vocals']) expect(Array.from(selector.options).map((option) => option.value)).not.toContain(id);
    expect(screen.queryByRole('button', { name: '添加伴奏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '添加人声' })).toBeNull();
  });

  it('preserves newlines while entering training URLs and submits a trimmed array', async () => {
    show('suno/create-model');
    const input = screen.getByPlaceholderText('每行一个可公开下载的音频 URL');
    fireEvent.change(input, { target: { value: 'https://cdn.test/1.mp3\n' } });
    expect((input as HTMLTextAreaElement).value).toBe('https://cdn.test/1.mp3\n');
    const urls = Array.from({ length: 6 }, (_, index) => `https://cdn.test/${index}.mp3`);
    fireEvent.change(input, { target: { value: `${urls.join('\n')}\n  ` } });
    fireEvent.change(screen.getByRole('textbox', { name: /^名称/ }), { target: { value: '我的模型' } });
    fireEvent.click(screen.getByRole('button', { name: '专属模型训练' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledOnce());
    expect(createTask.mock.calls[0][0]).toMatchObject({ model: 'suno/create-model',
      params: { sunoV2Body: { name: '我的模型', audio_urls: urls } } });
    expect(await screen.findByText('专属模型训练已提交')).toBeTruthy();
  });

  it.each(['persona_id', 'model_id'] as const)('reuses a %s result through a documented follow-up action', async (kind) => {
    show(kind === 'model_id' ? 'suno/create-model' : 'suno/persona', {
      sunoV2Results: result({ id: 'public-resource', kind, profileId: 'p' }),
    });
    fireEvent.click(screen.getByRole('button', { name: '音乐生成' }));
    await waitFor(() => expect(onSelectModel).toHaveBeenCalledWith('suno/music', { profileId: 'p', modelId: 'suno/music' }));
    expect(updateRecord.mock.calls[0][1].sunoV2Drafts['suno/music']).toMatchObject({ [kind]: 'public-resource' });
    if (kind === 'persona_id') expect(updateRecord.mock.calls[0][1].sunoV2Drafts['suno/music'].custom).toBe(true);
  });

  it('rejects a saved resource from a different provider before creating a task', async () => {
    show('suno/music', { sunoV2Drafts: { 'suno/music': { custom: false, instrumental: false, gpt_description_prompt: 'piano', model_id: 'foreign-model' } },
      sunoV2Results: result({ id: 'foreign-model', kind: 'model_id', profileId: 'other' }),
    });
    expect(screen.queryByRole('option', { name: 'foreign-model' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '音乐生成' })[0]);
    expect(await screen.findByText('请选择当前渠道已完成的 Suno v2 资源')).toBeTruthy();
    expect(createTask).not.toHaveBeenCalled();
  });
});
