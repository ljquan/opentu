import React, { useRef, useState } from 'react';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { SunoFileInput } from '../../shared/SunoFileInput';
import { SunoNativeResultDetails } from '../../shared/SunoNativeResultDetails';
import { buildSunoNativeInputParams, collectSunoNativeResources, getSunoNativeParams } from '../../../services/suno-native-params';
import { getSunoNativeAction } from '../../../services/suno-native';
import { resolveInvocationPlanFromRoute } from '../../../services/provider-routing';
import { useTaskQueue } from '../../../hooks/useTaskQueue';
import { taskQueueService } from '../../../services/task-queue';
import { TaskType } from '../../../types/task.types';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-types';
import type { ModelConfig } from '../../../constants/model-config';
import type { MusicAnalysisRecord } from '../types';
import { updateRecord } from '../storage';

interface Props {
  record: MusicAnalysisRecord; model: string; modelRef: ModelRef | null; models: ModelConfig[];
  onSelectModel: (model: string, ref?: ModelRef | null) => void;
  onRecordUpdate: (record: MusicAnalysisRecord) => void; onRecordsChange: (records: MusicAnalysisRecord[]) => void;
}
export const SunoNativePage: React.FC<Props> = ({ record, model, modelRef, models, onSelectModel, onRecordUpdate, onRecordsChange }) => {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const draft = record.sunoNativeDrafts?.[model] || {};
    try { getSunoNativeAction(model, draft); return draft; } catch { return {}; }
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const { tasks, cancelTask } = useTaskQueue();
  const plan = resolveInvocationPlanFromRoute('audio', modelRef || model);
  const profileId = plan?.provider.profileId || '';
  const resources = [...(record.sunoNativeResults || []).flatMap((item) => item.result.resources),
    ...collectSunoNativeResources(tasks.filter((task) => record.generateTaskIds?.includes(task.id)))];
  const unique = Array.from(new Map(resources.map((resource) => [JSON.stringify(resource), resource])).values());
  const fields = getSunoNativeParams(model, values, unique.filter((resource) => resource.profileId === profileId));
  const action = getSunoNativeAction(model, values);
  const available = plan?.binding.protocol === 'tuzi.suno.native' && models.some((item) => item.id === model && item.sourceProfileId === profileId);
  const setField = (name: string, value: string) => setValues((current) => name === 'sunoNativeAction' ? { sunoNativeAction: value, callBackUrl: current.callBackUrl || '' } : { ...current, [name]: value });
  const submit = async () => {
    if (!available || lock.current || !plan) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const params = buildSunoNativeInputParams(model, values, record.creationPrompt || '', profileId, unique);
      const task = taskQueueService.createTask({ model, modelRef: { modelId: model, profileId }, params,
        prompt: String(params.sunoNativeBody.prompt || action.label), batchId: `ma_${record.id}_native_0`, batchIndex: 0, batchTotal: 1,
        autoInsertToCanvas: action.resultKind === 'audio' }, TaskType.AUDIO);
      const records = await updateRecord(record.id, { generateTaskIds: [...(record.generateTaskIds || []), task.id],
        sunoNativeDrafts: { ...record.sunoNativeDrafts, [model]: values } });
      onRecordsChange(records); onRecordUpdate(records.find((item) => item.id === record.id) || record);
      setMessage(`${action.label}已提交`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '提交失败'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="va-page ma-v2-page">
    <ModelDropdown selectedModel={model} selectedSelectionKey={getSelectionKey(model, modelRef)} models={models} onSelect={onSelectModel} variant="form" />
    <p>当前动作：{action.label}。可从同渠道结果填入资源，也可输入该渠道已有的公开 ID。</p>
    {!available && <p role="status">当前渠道没有配置此 Suno 入口。</p>}
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset className="ma-v2-fields" disabled={!available || busy}>
        {fields.map((field) => {
          const value = values[field.id] ?? field.defaultValue ?? '';
          return <label className="ma-field" key={`${action.action}:${field.id}`}>
            <span>{field.label}</span>
            {field.control === 'file' ? <SunoFileInput label={field.label} value={value} onChange={(next) => setField(field.id, next)} />
              : field.options ? <select className="ma-select" value={value} onChange={(event) => setField(field.id, event.target.value)}>
                <option value="">请选择</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              : field.control === 'textarea' ? <textarea className="ma-textarea" rows={3} value={value} onChange={(event) => setField(field.id, event.target.value)} />
              : <input className="ma-input" type={field.valueType === 'number' ? 'number' : 'text'} min={field.min} max={field.max} step={field.integer ? 1 : 'any'} value={value} onChange={(event) => setField(field.id, event.target.value)} />}
            {field.description && <details><summary>参数说明</summary><small>{field.description}</small></details>}
          </label>;
        })}
      </fieldset>
      {message && <p role="status">{message}</p>}
      <button type="submit" className="va-btn-primary" disabled={!available || busy}>{busy ? '提交中' : action.label}</button>
    </form>
    {tasks.filter((task) => record.generateTaskIds?.includes(task.id) && task.params.params?.sunoNativeAction).map((task) => <div key={task.id} className="ma-v2-task">
      <span>{task.params.prompt} · {task.status === 'failed' ? task.error?.message : task.status}</span>
      {['pending', 'processing'].includes(task.status) && <button type="button" onClick={() => cancelTask(task.id)}>停止等待</button>}
    </div>)}
    {(record.sunoNativeResults || []).map(({ taskId, result }) => <div className="ma-v2-results" key={taskId}><SunoNativeResultDetails result={result} /></div>)}
  </div>;
};
