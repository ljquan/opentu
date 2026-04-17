import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GeneratedClip,
  MusicAnalysisRecord,
  SunoMusicEditAction,
} from '../types';
import { updateRecord } from '../storage';
import { taskQueueService } from '../../../services/task-queue';
import { TaskType } from '../../../types/task.types';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { getCompatibleParams, getDefaultAudioModel } from '../../../constants/model-config';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../utils';

const STORAGE_KEY_AUDIO_MODEL = 'music-analyzer:audio-model';

const ACTION_OPTIONS: Array<{ id: SunoMusicEditAction; label: string; hint: string }> = [
  { id: 'generate', label: '新生成', hint: '从零生成完整音乐' },
  { id: 'continue', label: '续写', hint: '从已有片段继续创作' },
  { id: 'infill', label: 'Infill', hint: '局部重绘指定时间窗口' },
];

interface GeneratePageProps {
  record: MusicAnalysisRecord;
  onRecordUpdate: (record: MusicAnalysisRecord) => void;
  onRecordsChange: (records: MusicAnalysisRecord[]) => void;
  onRestart?: () => void;
}

function toOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumberInputValue(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function toStyleTags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getActionLabel(action: SunoMusicEditAction): string {
  return ACTION_OPTIONS.find((option) => option.id === action)?.label || '新生成';
}

function getDefaultContinueAt(clip: GeneratedClip): string {
  return typeof clip.duration === 'number' && Number.isFinite(clip.duration)
    ? String(Math.max(0, Math.round(clip.duration)))
    : '';
}

function formatClipOptionLabel(clip: GeneratedClip): string {
  const title = clip.title || '未命名片段';
  const duration =
    clip.duration != null ? ` · ${formatDuration(clip.duration)}` : '';
  const shortClipId = clip.clipId ? ` · ${clip.clipId.slice(0, 8)}` : '';
  return `${title}${duration}${shortClipId}`;
}

export const GeneratePage: React.FC<GeneratePageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
  onRestart,
}) => {
  const [title, setTitle] = useState(record.title || '');
  const [tags, setTags] = useState((record.styleTags || []).join(', '));
  const [prompt, setPrompt] = useState(record.lyricsDraft || '');
  const [mv, setMv] = useState('chirp-v5-5');
  const [batchCount, setBatchCount] = useState(1);
  const [selectedModel, setSelectedModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_AUDIO_MODEL, getDefaultAudioModel()).modelId
  );
  const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_AUDIO_MODEL, getDefaultAudioModel()).modelRef
  );
  const [action, setAction] = useState<SunoMusicEditAction>(
    record.musicEditAction || 'generate'
  );
  const [continueClipId, setContinueClipId] = useState(record.continueFromClipId || '');
  const [continueAtInput, setContinueAtInput] = useState(
    toNumberInputValue(record.continueAt)
  );
  const [infillStartInput, setInfillStartInput] = useState(
    toNumberInputValue(record.infillStartS)
  );
  const [infillEndInput, setInfillEndInput] = useState(
    toNumberInputValue(record.infillEndS)
  );
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const generatingRef = useRef(false);

  const setSelectedModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setSelectedModelState(model);
    setSelectedModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_AUDIO_MODEL, model, modelRef);
  }, []);

  useEffect(() => {
    setTitle(record.title || '');
    setTags((record.styleTags || []).join(', '));
    setPrompt(record.lyricsDraft || '');
    setAction(record.musicEditAction || 'generate');
    setContinueClipId(record.continueFromClipId || '');
    setContinueAtInput(toNumberInputValue(record.continueAt));
    setInfillStartInput(toNumberInputValue(record.infillStartS));
    setInfillEndInput(toNumberInputValue(record.infillEndS));
  }, [record]);

  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const styleTags = toStyleTags(tags);
      const continueAt = toOptionalNumber(continueAtInput);
      const infillStartS = toOptionalNumber(infillStartInput);
      const infillEndS = toOptionalNumber(infillEndInput);
      const patch: Partial<MusicAnalysisRecord> = {
        title,
        styleTags,
        lyricsDraft: prompt,
        musicEditAction: action,
        continueFromClipId: continueClipId || null,
        continueAt,
        infillStartS,
        infillEndS,
      };
      const updated = await updateRecord(record.id, patch);
      onRecordsChange(updated);
      onRecordUpdate({
        ...record,
        ...patch,
      });
    }, 400);
    return () => clearTimeout(saveTimerRef.current);
  }, [
    action,
    continueAtInput,
    continueClipId,
    infillEndInput,
    infillStartInput,
    onRecordUpdate,
    onRecordsChange,
    prompt,
    record.id,
    tags,
    title,
  ]);

  const audioModels = useSelectableModels('audio');
  const sunoModels = useMemo(
    () =>
      audioModels.filter((item) => {
        const tagsText = Array.isArray((item as any).tags)
          ? (item as any).tags.join(' ')
          : '';
        return /suno/i.test(item.id) || /suno/i.test(tagsText);
      }),
    [audioModels]
  );
  const mvParam = useMemo(
    () => getCompatibleParams(selectedModel).find((param) => param.id === 'mv'),
    [selectedModel]
  );

  useEffect(() => {
    if (mvParam?.defaultValue) {
      setMv((current) => current || String(mvParam.defaultValue));
    }
  }, [mvParam?.defaultValue]);

  const clips = record.generatedClips || [];
  const selectableClips = useMemo(
    () => clips.filter((clip) => Boolean(String(clip.clipId || '').trim())),
    [clips]
  );
  const selectedClip = useMemo(
    () => selectableClips.find((clip) => clip.clipId === continueClipId) || null,
    [continueClipId, selectableClips]
  );
  const requiresContinuation = action !== 'generate';
  const requiresInfill = action === 'infill';

  const handleUseClip = useCallback(
    (clip: GeneratedClip, nextAction: SunoMusicEditAction) => {
      if (!clip.clipId) {
        setMessage('该片段尚未拿到真实 clip_id，暂时不能继续创作');
        return;
      }

      setAction(nextAction);
      setContinueClipId(clip.clipId);
      setContinueAtInput((current) => current || getDefaultContinueAt(clip));
      if (nextAction === 'continue') {
        setMessage(`已带入片段「${clip.title || clip.clipId.slice(0, 8)}」用于续写`);
      } else {
        setMessage(`已带入片段「${clip.title || clip.clipId.slice(0, 8)}」用于 Infill`);
      }
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    const trimmedTitle = title.trim();
    const trimmedTags = tags.trim();
    const continueAt = toOptionalNumber(continueAtInput);
    const infillStartS = toOptionalNumber(infillStartInput);
    const infillEndS = toOptionalNumber(infillEndInput);

    if (!trimmedPrompt) {
      setMessage('请先准备歌词或生成提示词');
      return;
    }
    if (requiresContinuation && !continueClipId) {
      setMessage('请先选择要续写的片段');
      return;
    }
    if (requiresContinuation && !selectedClip?.taskId) {
      setMessage('当前片段缺少来源 task_id，请先重新同步或重新生成一次片段');
      return;
    }
    if (requiresContinuation && continueAt == null) {
      setMessage('请填写续写起点秒数');
      return;
    }
    if (continueAt != null && continueAt < 0) {
      setMessage('续写起点秒数不能小于 0');
      return;
    }
    if (requiresInfill && infillStartS == null) {
      setMessage('请填写 Infill 开始秒数');
      return;
    }
    if (requiresInfill && infillEndS == null) {
      setMessage('请填写 Infill 结束秒数');
      return;
    }
    if (infillStartS != null && infillStartS < 0) {
      setMessage('Infill 开始秒数不能小于 0');
      return;
    }
    if (infillEndS != null && infillEndS < 0) {
      setMessage('Infill 结束秒数不能小于 0');
      return;
    }
    if (
      requiresInfill &&
      infillStartS != null &&
      infillEndS != null &&
      infillStartS >= infillEndS
    ) {
      setMessage('Infill 开始秒数必须小于结束秒数');
      return;
    }
    if (generatingRef.current) {
      return;
    }
    generatingRef.current = true;

    setSubmitting(true);
    setMessage('');
    try {
      const taskIds: string[] = [];
      const batchAction = action === 'generate' ? 'gen' : action;
      for (let i = 0; i < batchCount; i += 1) {
        const task = taskQueueService.createTask(
          {
            prompt: trimmedPrompt,
            model: selectedModel,
            modelRef: selectedModelRef,
            sunoAction: 'music',
            title: trimmedTitle,
            tags: trimmedTags,
            mv,
            continueClipId: requiresContinuation ? continueClipId : undefined,
            continueTaskId: requiresContinuation ? selectedClip?.taskId : undefined,
            continueAt: requiresContinuation ? continueAt ?? undefined : undefined,
            infillStartS: requiresInfill ? infillStartS ?? undefined : undefined,
            infillEndS: requiresInfill ? infillEndS ?? undefined : undefined,
            batchId: `ma_${record.id}_${batchAction}_${i}`,
            batchIndex: i,
            batchTotal: batchCount,
            autoInsertToCanvas: true,
          },
          TaskType.AUDIO
        );
        taskIds.push(task.id);
      }

      const patch: Partial<MusicAnalysisRecord> = {
        generateTaskIds: [...(record.generateTaskIds || []), ...taskIds],
        title: trimmedTitle,
        styleTags: toStyleTags(trimmedTags),
        lyricsDraft: trimmedPrompt,
        musicEditAction: action,
        continueFromClipId: continueClipId || null,
        continueAt,
        infillStartS,
        infillEndS,
      };
      const updated = await updateRecord(record.id, patch);
      onRecordsChange(updated);
      onRecordUpdate({
        ...record,
        ...patch,
      });
      setMessage(`已提交 ${batchCount} 次${getActionLabel(action)}任务到 Suno 队列`);
    } catch (taskError: any) {
      setMessage(taskError.message || '提交生成任务失败');
    } finally {
      setSubmitting(false);
      generatingRef.current = false;
    }
  }, [
    action,
    batchCount,
    continueAtInput,
    continueClipId,
    infillEndInput,
    infillStartInput,
    mv,
    onRecordUpdate,
    onRecordsChange,
    prompt,
    record,
    requiresContinuation,
    requiresInfill,
    selectedClip?.taskId,
    selectedModel,
    selectedModelRef,
    tags,
    title,
  ]);

  return (
    <div className="va-page">
      <div className="ma-card">
        <div className="ma-card-header">
          <span>创作动作</span>
          <span className="ma-muted">
            {ACTION_OPTIONS.find((option) => option.id === action)?.hint}
          </span>
        </div>
        <div className="ma-action-toggle">
          {ACTION_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`ma-action-btn ${action === option.id ? 'active' : ''}`}
              onClick={() => setAction(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>Suno 模型</span>
        </div>
        <ModelDropdown
          selectedModel={selectedModel}
          selectedSelectionKey={getSelectionKey(selectedModel, selectedModelRef)}
          onSelect={setSelectedModel}
          models={sunoModels.length > 0 ? sunoModels : audioModels}
          variant="form"
          placement="down"
          placeholder="选择音频生成模型"
        />
      </div>

      {mvParam?.options && mvParam.options.length > 0 && (
        <div className="ma-card">
          <div className="ma-card-header">
            <span>Suno 版本</span>
          </div>
          <select
            className="ma-select"
            value={mv}
            onChange={(event) => setMv(event.target.value)}
          >
            {mvParam.options.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {requiresContinuation && (
        <div className="ma-card">
          <div className="ma-card-header">
            <span>目标片段</span>
            <span className="ma-muted">自动使用轮询得到的真实 clip_id</span>
          </div>
          {selectableClips.length > 0 ? (
            <select
              className="ma-select"
              value={continueClipId}
              onChange={(event) => setContinueClipId(event.target.value)}
            >
              <option value="">请选择已生成片段</option>
              {selectableClips.map((clip) => (
                <option key={clip.clipId} value={clip.clipId}>
                  {formatClipOptionLabel(clip)}
                </option>
              ))}
            </select>
          ) : (
            <div className="ma-hint">先生成至少一个片段，才能使用续写或 Infill。</div>
          )}
          {selectedClip && (
            <div className="ma-hint">
              当前片段：{formatClipOptionLabel(selectedClip)}
            </div>
          )}
        </div>
      )}

      {requiresContinuation && (
        <div className="ma-card">
          <div className="ma-card-header">
            <span>编辑参数</span>
          </div>
          <div className={`ma-fields-grid ${requiresInfill ? 'ma-fields-grid--triple' : ''}`}>
            <label className="ma-field">
              <span>续写起点秒数</span>
              <input
                className="ma-input"
                type="number"
                min="0"
                step="0.1"
                value={continueAtInput}
                onChange={(event) => setContinueAtInput(event.target.value)}
                placeholder="例如 30"
              />
            </label>
            {requiresInfill && (
              <label className="ma-field">
                <span>Infill 开始秒数</span>
                <input
                  className="ma-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={infillStartInput}
                  onChange={(event) => setInfillStartInput(event.target.value)}
                  placeholder="例如 8"
                />
              </label>
            )}
            {requiresInfill && (
              <label className="ma-field">
                <span>Infill 结束秒数</span>
                <input
                  className="ma-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={infillEndInput}
                  onChange={(event) => setInfillEndInput(event.target.value)}
                  placeholder="例如 16"
                />
              </label>
            )}
          </div>
        </div>
      )}

      <div className="ma-card">
        <div className="ma-card-header">
          <span>歌曲标题</span>
        </div>
        <input
          className="ma-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="歌曲标题"
        />
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>风格标签</span>
        </div>
        <input
          className="ma-input"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="逗号分隔，例如 edm, intense, female vocal"
        />
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>提交给 Suno 的歌词/提示词</span>
        </div>
        <textarea
          className="ma-textarea"
          rows={10}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="这里的内容会直接作为 prompt 提交给 Suno"
        />
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>调用次数</span>
          <span className="ma-muted">每次返回 2 首</span>
        </div>
        <div className="ma-batch-selector">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              className={`ma-batch-btn ${batchCount === n ? 'active' : ''}`}
              onClick={() => setBatchCount(n)}
            >
              {n} 次
            </button>
          ))}
        </div>
      </div>

      {clips.length > 0 && (
        <div className="ma-card">
          <div className="ma-card-header">
            <span>已生成片段 ({clips.length})</span>
            <span className="ma-muted">可直接带入续写或 Infill</span>
          </div>
          <div className="ma-clips-gallery">
            {clips.map((clip) => (
              <ClipCard
                key={`${clip.taskId}:${clip.clipId || clip.audioUrl}`}
                clip={clip}
                selected={
                  requiresContinuation &&
                  Boolean(clip.clipId) &&
                  continueClipId === clip.clipId
                }
                onContinue={() => handleUseClip(clip, 'continue')}
                onInfill={() => handleUseClip(clip, 'infill')}
              />
            ))}
          </div>
        </div>
      )}

      {message && <div className="ma-progress">{message}</div>}

      <div className="va-page-actions">
        <button onClick={onRestart}>重新开始</button>
        <button
          className="va-btn-primary"
          onClick={handleGenerate}
          disabled={submitting}
        >
          {getActionLabel(action)} {batchCount} 次
        </button>
      </div>
    </div>
  );
};

const ClipCard: React.FC<{
  clip: GeneratedClip;
  selected: boolean;
  onContinue: () => void;
  onInfill: () => void;
}> = ({ clip, selected, onContinue, onInfill }) => {
  const hasClipId = Boolean(String(clip.clipId || '').trim());

  return (
    <div className={`ma-clip-row ${selected ? 'is-selected' : ''}`}>
      {clip.imageUrl ? (
        <img
          className="ma-clip-thumb"
          src={clip.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="ma-clip-thumb ma-clip-thumb--placeholder">♪</div>
      )}
      <div className="ma-clip-meta">
        <span className="ma-clip-title">{clip.title || '未命名'}</span>
        {clip.duration != null && (
          <span className="ma-clip-duration">{formatDuration(clip.duration)}</span>
        )}
      </div>
      <audio controls src={clip.audioUrl} className="ma-clip-player" preload="metadata" />
      <div className="ma-clip-actions">
        <button
          className="ma-clip-action-btn"
          onClick={onContinue}
          disabled={!hasClipId}
        >
          续写
        </button>
        <button
          className="ma-clip-action-btn"
          onClick={onInfill}
          disabled={!hasClipId}
        >
          Infill
        </button>
      </div>
    </div>
  );
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
