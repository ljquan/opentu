import React, { useRef, useState } from 'react';
import { Square, WandSparkles } from 'lucide-react';
import { SunoV2ResultDetails } from '../../shared/SunoV2ResultDetails';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { HoverTip } from '../../shared/hover/HoverTip';
import { useTaskQueue } from '../../../hooks/useTaskQueue';
import { taskQueueService } from '../../../services/task-queue';
import { resolveInvocationPlanFromRoute } from '../../../services/provider-routing';
import {
  buildSunoV2Body, getSunoV2Action, getSunoV2Fields, SUNO_V2_ACTIONS, isSunoV2FieldVisible as visibleField,
  type SunoV2Field, type SunoV2Resource,
} from '../../../services/suno-v2';
import { TaskType } from '../../../types/task.types';
import type { ModelConfig } from '../../../constants/model-config';
import type { ModelRef } from '../../../utils/settings-manager';
import { getSelectionKey } from '../../../utils/model-selection';
import type { MusicAnalysisRecord } from '../types';
import { updateRecord } from '../storage';

interface Props {
  record: MusicAnalysisRecord;
  model: string;
  modelRef: ModelRef | null;
  models: ModelConfig[];
  onSelectModel: (model: string, modelRef?: ModelRef | null) => void;
  onRecordUpdate: (record: MusicAnalysisRecord) => void;
  onRecordsChange: (records: MusicAnalysisRecord[]) => void;
}

function initialBody(record: MusicAnalysisRecord, model: string): Record<string, unknown> {
  if (record.sunoV2Drafts?.[model]) return { ...record.sunoV2Drafts[model] };
  const fields = getSunoV2Action(model)?.supported ? getSunoV2Fields(model) : [];
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) body[field.name] = field.default;
  }
  if (fields.some((field) => field.name === 'title') && record.title) body.title = record.title;
  if (fields.some((field) => field.name === 'tags') && record.styleTags?.length) body.tags = record.styleTags.join(', ');
  if (fields.some((field) => field.name === 'prompt') && record.lyricsDraft) {
    body.prompt = record.lyricsDraft;
    if (fields.some((field) => field.name === 'custom')) body.custom = true;
  }
  if (fields.some((field) => field.name === 'gpt_description_prompt') && record.creationPrompt) body.gpt_description_prompt = record.creationPrompt;
  if (fields.some((field) => field.name === 'sound') && record.creationPrompt) body.sound = record.creationPrompt;
  if (fields.some((field) => field.name === 'instrumental')) body.instrumental = record.instrumental === true;
  if (model === 'suno/download') body.formats = ['mp3'];
  return body;
}

export const SunoV2Page: React.FC<Props> = ({ record, model, modelRef, models, onSelectModel, onRecordUpdate, onRecordsChange }) => {
  const [body, setBody] = useState(() => initialBody(record, model));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { tasks, cancelTask } = useTaskQueue();
  const action = getSunoV2Action(model);
  const fields = action?.supported ? getSunoV2Fields(model) : [];
  const sourceModel = models.find((item) => item.id === model && (!modelRef?.profileId || item.sourceProfileId === modelRef.profileId));
  const profileId = modelRef?.profileId || sourceModel?.sourceProfileId || '';
  const plan = resolveInvocationPlanFromRoute('audio', modelRef || model);
  const selectedInCatalog = models.some((item) => item.id === model && (!profileId || item.sourceProfileId === profileId));
  const available = !!action?.supported && selectedInCatalog && !!plan && plan.binding.protocol === 'tuzi.suno.v2';
  const resources = Array.from(new Map((record.sunoV2Results || [])
    .flatMap((item) => item.result.resources)
    .map((resource) => [`${resource.profileId}:${resource.kind}:${resource.id}`, resource])).values());
  const localResources = resources.filter((resource) => resource.profileId === (plan?.provider.profileId || profileId));
  const recordTasks = tasks.filter((task) => record.generateTaskIds?.includes(task.id) && task.params.model?.startsWith('suno/'));

  const setField = (name: string, value: unknown) => setBody((current) => ({ ...current, [name]: value }));
  const submit = async () => {
    if (submittingRef.current || !available || !plan) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage('');
    try {
      const visibleBody = Object.fromEntries(fields.filter((field) => visibleField(field, body))
        .map((field) => [field.name, field.name === 'audio_urls' && Array.isArray(body[field.name])
          ? (body[field.name] as string[]).map((url) => url.trim()).filter(Boolean) : body[field.name]])
        .filter(([, value]) => value !== undefined && value !== ''));
      const params = { sunoV2Body: visibleBody, sunoV2Resources: localResources };
      buildSunoV2Body({ model, modelRef, prompt: String(visibleBody.prompt || visibleBody.gpt_description_prompt || action?.label || ''), params }, plan.provider.profileId);
      const task = taskQueueService.createTask({
        model, modelRef: { profileId: plan.provider.profileId, modelId: model },
        prompt: String(visibleBody.prompt || visibleBody.gpt_description_prompt || action?.label || ''),
        params,
        batchId: `ma_${record.id}_v2_0`, batchIndex: 0, batchTotal: 1,
        autoInsertToCanvas: action?.resultKind === 'musics',
      }, TaskType.AUDIO);
      const patch: Partial<MusicAnalysisRecord> = {
        generateTaskIds: [...(record.generateTaskIds || []), task.id],
        sunoV2Drafts: { ...record.sunoV2Drafts, [model]: body },
      };
      const records = await updateRecord(record.id, patch);
      onRecordsChange(records);
      onRecordUpdate(records.find((item) => item.id === record.id) || { ...record, ...patch });
      setMessage(`${action?.label}已提交`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '任务提交失败');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="va-page ma-v2-page">
      <div className="ma-fields-grid">
        <label className="ma-field">
          <span>Suno 模型</span>
          <ModelDropdown selectedModel={model} selectedSelectionKey={getSelectionKey(model, modelRef)}
            onSelect={onSelectModel} models={models} variant="form" placement="down" />
        </label>
        <label className="ma-field">
          <span>制作动作</span>
          <select className="ma-select" value={model} disabled={submitting} onChange={(event) => {
            const next = models.find((item) => item.id === event.target.value && item.sourceProfileId === profileId);
            if (next) onSelectModel(next.id, { profileId: profileId || plan?.provider.profileId || null, modelId: next.id });
          }}>
            {SUNO_V2_ACTIONS.filter((item) => item.supported || item.model === model).map((item) => {
              const configured = models.some((entry) => entry.id === item.model && entry.sourceProfileId === profileId);
              return <option key={item.model} value={item.model} disabled={!item.supported || !configured}>
                {item.label}{!item.supported ? '（未开放）' : !configured ? '（渠道未配置）' : ''}
              </option>;
            })}
          </select>
        </label>
      </div>

      {!available && <p role="status" className="ma-progress">当前渠道未提供可用的 Suno v2 {action?.label || model}。</p>}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={!available || submitting} className="ma-v2-fields">
          {fields.filter((field) => visibleField(field, body)).map((field) => (
            <ParameterField key={`${model}:${field.name}`} field={field} value={body[field.name]}
              required={action?.required.includes(field.name) || (field.name === 'gpt_description_prompt' && model === 'suno/music' && body.custom === false)}
              resources={localResources} onChange={(value) => setField(field.name, value)} />
          ))}
        </fieldset>
        {message && <p role="status" className="ma-progress">{message}</p>}
        <div className="va-page-actions">
          <button className="va-btn-primary" type="submit" disabled={!available || submitting}>
            <WandSparkles size={16} aria-hidden="true" /> {submitting ? '提交中' : action?.label || '提交'}
          </button>
        </div>
      </form>

      {recordTasks.length > 0 && <section className="ma-v2-results" aria-label="Suno 任务">
        {recordTasks.map((task) => <div className="ma-v2-task" key={task.id}>
          <span>{getSunoV2Action(task.params.model)?.label || task.params.model}</span>
          <span>{task.status === 'completed' ? '已完成' : task.status === 'failed' ? task.error?.message || '失败' : task.status === 'cancelled' ? '已取消' : `${task.progress || 0}%`}</span>
          {['pending', 'processing'].includes(task.status) && <HoverTip content="停止等待">
            <button type="button" aria-label="停止等待" onClick={() => cancelTask(task.id)}><Square size={16} /></button>
          </HoverTip>}
        </div>)}
      </section>}

      {(record.sunoV2Results || []).map(({ taskId, result }) => <section className="ma-v2-results" key={taskId} aria-label={getSunoV2Action(`suno/${result.action}`)?.label}>
        <h3>{getSunoV2Action(`suno/${result.action}`)?.label || result.action}</h3>
        {result.resources.map((resource) => <div className="ma-v2-result" key={`${resource.kind}:${resource.id}`}>
          <span>{resource.title || resource.id}</span>
          {resource.audioUrl && <audio controls preload="none" src={resource.audioUrl} aria-label={resource.title || 'Suno 音频'} />}
          <div className="ma-v2-actions">
            {SUNO_V2_ACTIONS.filter((entry) => entry.supported && getSunoV2Fields(entry.model).some((field) =>
              field.name === resource.kind || (resource.kind === 'music_id' && field.name === 'mashup_music_id'))).map(({ action: nextAction }) => {
              const target = models.find((entry) => entry.id === `suno/${nextAction}` && entry.sourceProfileId === resource.profileId);
              return <button key={nextAction} type="button" disabled={!target} onClick={async () => {
                const nextModel = `suno/${nextAction}`;
                const nextBody = { ...initialBody(record, nextModel),
                  ...(nextAction === 'mashup' && resource.kind === 'music_id' ? { mashup_music_id: [resource.id] } : { [resource.kind]: resource.id }),
                  ...(resource.kind === 'persona_id' ? { model_id: undefined,
                    ...(getSunoV2Fields(nextModel).some((field) => field.name === 'custom') ? { custom: true } : {}) } : {}),
                  ...(resource.kind === 'model_id' ? { persona_id: undefined } : {}) };
                try {
                  const records = await updateRecord(record.id, { sunoV2Drafts: { ...record.sunoV2Drafts, [nextModel]: nextBody } });
                  onRecordsChange(records);
                  onRecordUpdate(records.find((item) => item.id === record.id) || record);
                  onSelectModel(nextModel, { profileId: resource.profileId, modelId: nextModel });
                  if (nextModel === model) setBody(nextBody);
                } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
              }}>{getSunoV2Action(`suno/${nextAction}`)?.label}</button>;
            })}
          </div>
        </div>)}
        <SunoV2ResultDetails result={result} showResources={false} />
        {result.lyrics.map((lyrics, index) => <details key={index} open={index === 0}>
          <summary>{lyrics.title || `歌词 ${index + 1}`}</summary>
          <pre>{lyrics.text}</pre>
        </details>)}
      </section>)}
    </div>
  );
};

const ParameterField: React.FC<{
  field: SunoV2Field; value: unknown; required?: boolean;
  resources: SunoV2Resource[]; onChange: (value: unknown) => void;
}> = ({ field, value, required, resources, onChange }) => {
  const resourceKind = field.name === 'mashup_music_id' ? 'music_id' : field.name;
  const choices = resources.filter((resource) => resource.kind === resourceKind);
  let control: React.ReactNode;
  if (['music_id', 'persona_id', 'model_id', 'file_id', 'mashup_music_id'].includes(field.name)) {
    const multiple = field.type === 'array';
    control = <select className="ma-select" required={required} multiple={multiple}
      value={multiple ? (Array.isArray(value) ? value : []) as string[] : String(value || '')}
      onChange={(event) => onChange(multiple ? Array.from(event.target.selectedOptions).map((option) => option.value) : event.target.value)}>
      {!multiple && <option value="">请选择资源</option>}
      {choices.map((resource) => <option key={resource.id} value={resource.id}>{resource.title || resource.id}</option>)}
    </select>;
  } else if (field.type === 'boolean') {
    control = <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
  } else if (field.enum) {
    control = <select className="ma-select" required={required} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
      <option value="">默认</option>
      {field.enum.map((option, index) => <option key={option} value={option}>{field.enumLabels?.[index] || option}</option>)}
    </select>;
  } else if (field.name === 'formats') {
    control = <div className="ma-v2-actions">{['mp3', 'm4a', 'wav'].map((format) => <label key={format}>
      <input type="checkbox" checked={Array.isArray(value) && value.includes(format)} onChange={(event) => {
        const current = Array.isArray(value) ? value : [];
        onChange(event.target.checked ? [...current, format] : current.filter((item) => item !== format));
      }} />{format.toUpperCase()}
    </label>)}</div>;
  } else if (field.name === 'audio_urls') {
    control = <textarea className="ma-textarea" rows={5} required={required}
      placeholder="每行一个可公开下载的音频 URL"
      value={Array.isArray(value) ? value.join('\n') : String(value ?? '')}
      onChange={(event) => onChange(event.target.value.split(/\r?\n/))} />;
  } else if (field.type === 'number' || field.type === 'integer') {
    control = <input className="ma-input" type="number" required={required} min={field.minimum ?? (/(?:_s|_at)$/.test(field.name) ? 0 : undefined)} max={field.maximum}
      step={field.type === 'integer' ? 1 : 'any'} value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} />;
  } else if (['prompt', 'infill_lyrics', 'gpt_description_prompt', 'sound'].includes(field.name)) {
    control = <textarea className="ma-textarea" rows={4} required={required} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
  } else {
    control = <input className="ma-input" type={field.name === 'audio_url' ? 'url' : 'text'} required={required} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.name === 'formats') return <fieldset className="ma-field"><legend>{field.label}</legend>{control}</fieldset>;
  return <label className={`ma-field ${field.type === 'boolean' ? 'ma-v2-switch' : ''}`}><span>{field.label}{required ? ' *' : ''}</span>{control}
    {field.description && <small>{field.description}</small>}
  </label>;
};
