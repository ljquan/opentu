/**
 * MV 脚本编辑页 — AI 改编 + 手动编辑 + 版本管理
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { MVRecord, VideoShot } from '../types';
import { updateRecord } from '../storage';
import { ShotCard } from '../../video-analyzer/components/ShotCard';
import { ComboInput } from '../../video-analyzer/components/ComboInput';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import { computeSegmentPlan } from '../../../utils/segment-plan';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../../video-analyzer/utils';
import {
  buildMVScriptRewritePrompt,
  switchToVersion,
  updateActiveShotsInRecord,
  ORIGINAL_VERSION_ID,
} from '../utils';
import { taskQueueService } from '../../../services/task-queue';
import { TaskType } from '../../../types/task.types';
import { syncMVRewriteTask } from '../task-sync';

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
function autoResizeRef(el: HTMLTextAreaElement | null) {
  if (el) autoResize(el);
}
function estimateRows(text: string | undefined, charsPerLine = 30): number {
  if (!text) return 1;
  const lines = text.split('\n');
  let total = 0;
  for (const line of lines) {
    total += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  return Math.max(1, total);
}

const CAMERA_MOVEMENT_OPTIONS = [
  '固定镜头 (Static)', '缓慢推近 (Dolly In)', '缓慢拉远 (Dolly Out)',
  '水平平移 (Pan)', '垂直摇移 (Tilt)', '跟随拍摄 (Follow)',
  '手持感 (Handheld)', '环绕拍摄 (Orbit)', '升降镜头 (Crane)',
  '快速推移 (Zoom In)', '快速拉远 (Zoom Out)', '航拍俯冲 (Drone Dive)',
];
const TRANSITION_OPTIONS = [
  { label: '硬切 (cut)', value: 'cut' },
  { label: '交叉溶解 (dissolve)', value: 'dissolve' },
  { label: '匹配切 (match_cut)', value: 'match_cut' },
  { label: '淡出到黑 (fade_to_black)', value: 'fade_to_black' },
];

const STORAGE_KEY_SCRIPT_MODEL = 'mv-creator:script-model';
const DEFAULT_SCRIPT_MODEL = 'gemini-2.5-pro';

interface ScriptPageProps {
  record: MVRecord;
  onRecordUpdate: (record: MVRecord) => void;
  onRecordsChange: (records: MVRecord[]) => void;
  onNext: () => void;
}


export const ScriptPage: React.FC<ScriptPageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
  onNext,
}) => {
  const [shots, setShots] = useState<VideoShot[]>(record.editedShots || []);
  const [rewritePrompt, setRewritePrompt] = useState(record.rewritePrompt || '');
  const [rewriting, setRewriting] = useState(false);
  const [rewriteProgress, setRewriteProgress] = useState('');
  const [error, setError] = useState('');
  const [pendingRewriteTaskId, setPendingRewriteTaskId] = useState<string | null>(
    record.pendingRewriteTaskId || null
  );
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const versionMenuRef = useRef<HTMLDivElement>(null);
  const rewritingRef = useRef(false);

  // 视频模型
  const videoModels = useSelectableModels('video');
  const STORAGE_KEY_VIDEO_MODEL = 'mv-creator:video-model';
  const [videoModel, setVideoModelState] = useState(
    () => record.videoModel || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () => record.videoModelRef || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelRef
  );
  const videoModelConfig = useMemo(() => getVideoModelConfig(videoModel), [videoModel]);
  const [selectedSegmentDuration, setSelectedSegmentDuration] = useState<number>(
    () => record.segmentDuration || parseInt(videoModelConfig.defaultDuration, 10) || 8
  );
  const durationOptions = useMemo(() =>
    (videoModelConfig.durationOptions || []).map(opt => ({ value: parseInt(opt.value, 10), label: opt.label })),
    [videoModelConfig]
  );
  const clipDuration = record.selectedClipDuration || 30;
  const segmentPlan = useMemo(() => {
    const singleOption = [{ label: `${selectedSegmentDuration}秒`, value: String(selectedSegmentDuration) }];
    return computeSegmentPlan(clipDuration, singleOption);
  }, [clipDuration, selectedSegmentDuration]);

  // 画面风格
  const [videoStyle, setVideoStyle] = useState(record.videoStyle || '');

  const setVideoModel = useCallback((model: string, ref?: ModelRef | null) => {
    setVideoModelState(model);
    setVideoModelRef(ref || null);
    writeStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, model, ref);
    const newCfg = getVideoModelConfig(model);
    const dur = parseInt(newCfg.defaultDuration, 10) || 8;
    setSelectedSegmentDuration(dur);
  }, []);

  const saveRecordField = useCallback(async (patch: Partial<MVRecord>) => {
    const updated = await updateRecord(record.id, patch);
    onRecordsChange(updated);
    onRecordUpdate({ ...record, ...patch });
  }, [record, onRecordUpdate, onRecordsChange]);

  // 角色描述编辑
  const handleCharacterDescChange = useCallback((charId: string, desc: string) => {
    const base = record.characters || [];
    const updated = base.map(c => c.id === charId ? { ...c, description: desc } : c);
    void saveRecordField({ characters: updated });
  }, [record, saveRecordField]);

  const textModels = useSelectableModels('text');
  const [scriptModel, setScriptModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_SCRIPT_MODEL, DEFAULT_SCRIPT_MODEL).modelId
  );
  const [scriptModelRef, setScriptModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_SCRIPT_MODEL, DEFAULT_SCRIPT_MODEL).modelRef
  );

  const setScriptModel = useCallback((model: string, ref?: ModelRef | null) => {
    setScriptModelState(model);
    setScriptModelRef(ref || null);
    writeStoredModelSelection(STORAGE_KEY_SCRIPT_MODEL, model, ref);
  }, []);

  // 表单变化时自动保存到 IndexedDB（防抖 500ms）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const updated = await updateRecord(record.id, {
        rewritePrompt,
        videoModel,
        videoModelRef,
        segmentDuration: selectedSegmentDuration,
        videoStyle,
      });
      onRecordsChange(updated);
      onRecordUpdate({
        ...record,
        rewritePrompt,
        videoModel,
        videoModelRef,
        segmentDuration: selectedSegmentDuration,
        videoStyle,
      });
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [rewritePrompt, videoModel, videoModelRef, selectedSegmentDuration, videoStyle]);

  // 同步 record 变化
  useEffect(() => {
    setShots(record.editedShots || []);
  }, [record.editedShots]);

  const saveShots = useCallback(async (updatedShots: VideoShot[]) => {
    setShots(updatedShots);
    const patch = updateActiveShotsInRecord(record, updatedShots);
    const updated = await updateRecord(record.id, patch);
    onRecordsChange(updated);
    onRecordUpdate({ ...record, ...patch });
  }, [record, onRecordUpdate, onRecordsChange]);

  const handleShotEdit = useCallback((shotId: string, field: string, value: string) => {
    const updatedShots = shots.map(s =>
      s.id === shotId ? { ...s, [field]: value } : s
    );
    void saveShots(updatedShots);
  }, [shots, saveShots]);

  // AI 改编
  const handleRewrite = useCallback(async () => {
    if (rewritingRef.current) return;
    rewritingRef.current = true;
    setRewriting(true);
    setError('');
    try {
      const prompt = buildMVScriptRewritePrompt({
        record,
        currentShots: shots,
        rewritePrompt,
        videoModel,
        segmentDuration: selectedSegmentDuration,
        videoStyle,
      });
      const task = taskQueueService.createTask(
        {
          prompt,
          model: scriptModel,
          modelRef: scriptModelRef,
          mvCreatorAction: 'rewrite',
          mvCreatorRecordId: record.id,
        },
        TaskType.CHAT
      );
      setPendingRewriteTaskId(task.id);
      const updated = await updateRecord(record.id, { pendingRewriteTaskId: task.id });
      onRecordsChange(updated);
      onRecordUpdate({ ...record, pendingRewriteTaskId: task.id });
      setRewriteProgress('AI 改编中...');
    } catch (err: any) {
      setError(err.message || '提交失败');
    } finally {
      setRewriting(false);
      rewritingRef.current = false;
    }
  }, [record, shots, rewritePrompt, scriptModel, scriptModelRef, onRecordUpdate, onRecordsChange]);

  // 监听改编任务
  useEffect(() => {
    if (!pendingRewriteTaskId) return;
    const currentTask = taskQueueService.getTask(pendingRewriteTaskId);
    if (currentTask?.status === 'failed') {
      setPendingRewriteTaskId(null);
      setRewriteProgress('');
      setError(currentTask.error?.message || '改编失败');
      return;
    }
    if (currentTask?.status === 'completed') {
      void syncMVRewriteTask(currentTask).then(synced => {
        if (synced) {
          onRecordsChange(synced.records);
          onRecordUpdate(synced.record);
          setShots(synced.record.editedShots || []);
        }
      }).finally(() => { setPendingRewriteTaskId(null); setRewriteProgress(''); });
      return;
    }
    if (typeof currentTask?.progress === 'number') {
      setRewriteProgress(`AI 改编中 ${Math.round(currentTask.progress)}%`);
    }
    const sub = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (event.task.id !== pendingRewriteTaskId) return;
      if (event.task.status === 'failed') {
        setPendingRewriteTaskId(null);
        setRewriteProgress('');
        setError(event.task.error?.message || '改编失败');
        void updateRecord(record.id, { pendingRewriteTaskId: null }).then(updated => {
          onRecordsChange(updated);
          onRecordUpdate({ ...record, pendingRewriteTaskId: null });
        });
        return;
      }
      if (event.task.status === 'completed') {
        void syncMVRewriteTask(event.task).then(synced => {
          if (synced) {
            onRecordsChange(synced.records);
            onRecordUpdate(synced.record);
            setShots(synced.record.editedShots || []);
          }
        }).catch((err: any) => {
          setError(err.message || '改编结果同步失败');
        }).finally(() => { setPendingRewriteTaskId(null); setRewriteProgress(''); });
        return;
      }
      if (typeof event.task.progress === 'number') {
        setRewriteProgress(`AI 改编中 ${Math.round(event.task.progress)}%`);
      }
    });
    return () => sub.unsubscribe();
  }, [pendingRewriteTaskId, record, onRecordUpdate, onRecordsChange]);

  // 版本切换
  const handleSwitchVersion = useCallback(async (versionId: string) => {
    const patch = switchToVersion(record, versionId);
    if (!patch) return;
    setVersionMenuOpen(false);
    setShots(patch.editedShots!);
    const updated = await updateRecord(record.id, patch);
    onRecordsChange(updated);
    onRecordUpdate({ ...record, ...patch });
  }, [record, onRecordUpdate, onRecordsChange]);

  useEffect(() => {
    if (!versionMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (versionMenuRef.current && !versionMenuRef.current.contains(e.target as Node)) {
        setVersionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [versionMenuOpen]);


  return (
    <div className="va-page">
      {/* 改编提示词 + 参数 */}
      <div className="va-product-form">
        <textarea
          ref={autoResizeRef}
          className="va-form-textarea va-auto-resize"
          placeholder="输入改编提示词，描述你想要的调整方向..."
          rows={Math.max(3, estimateRows(rewritePrompt))}
          value={rewritePrompt}
          onChange={e => setRewritePrompt(e.target.value)}
          onInput={e => autoResize(e.currentTarget)}
        />
        <div className="va-model-select">
          <label className="va-model-label">改编模型</label>
          <ModelDropdown
            variant="form"
            selectedModel={scriptModel}
            selectedSelectionKey={getSelectionKey(scriptModel, scriptModelRef)}
            onSelect={setScriptModel}
            models={textModels}
            placement="down"
            disabled={!!pendingRewriteTaskId}
            placeholder="选择文本模型"
          />
        </div>
        <div className="va-model-select">
          <label className="va-model-label">视频模型</label>
          <ModelDropdown
            variant="form"
            selectedModel={videoModel}
            selectedSelectionKey={getSelectionKey(videoModel, videoModelRef)}
            onSelect={setVideoModel}
            models={videoModels}
            placement="down"
            disabled={!!pendingRewriteTaskId}
            placeholder="选择视频模型"
          />
          <div className="va-segment-duration-select">
            <label className="va-model-label">单段</label>
            <select
              className="va-form-select"
              value={String(selectedSegmentDuration)}
              onChange={e => setSelectedSegmentDuration(parseInt(e.target.value, 10))}
              disabled={durationOptions.length <= 1}
            >
              {durationOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {segmentPlan.overflow > 0 && (
            <span className="va-duration-overflow">
              实际 {segmentPlan.actualTotal}s（+{parseFloat(segmentPlan.overflow.toFixed(2))}s）
            </span>
          )}
        </div>
        {/* 画面风格 */}
        <div className="va-form-row">
          <div style={{ flex: 1 }}>
            <label className="va-edit-label">画面风格</label>
            <textarea
              ref={autoResizeRef}
              className="va-edit-textarea va-auto-resize"
              rows={estimateRows(videoStyle)}
              value={videoStyle}
              onChange={e => setVideoStyle(e.target.value)}
              onInput={e => autoResize(e.currentTarget)}
              placeholder="如：赛博朋克、暖色调、电影质感"
            />
          </div>
        </div>
        <div className="va-version-row">
          <button
            className="va-analyze-btn"
            style={{ flex: 1 }}
            onClick={handleRewrite}
            disabled={rewriting || !!pendingRewriteTaskId}
          >
            {rewriting || pendingRewriteTaskId ? rewriteProgress || 'AI 改编中...' : 'AI 改编脚本'}
          </button>
          {record.storyboardVersions && record.storyboardVersions.length > 0 && (
            <div className="va-version-select" ref={versionMenuRef}>
              <button
                className="va-version-btn"
                onClick={() => setVersionMenuOpen(v => !v)}
              >
                {record.activeVersionId === ORIGINAL_VERSION_ID
                  ? '原始版本'
                  : record.storyboardVersions.find(v => v.id === record.activeVersionId)?.label || `v${record.storyboardVersions.length}`} ▾
              </button>
              {versionMenuOpen && (
                <div className="va-version-menu">
                  {record.storyboardVersions.map(v => (
                    <div
                      key={v.id}
                      className={`va-version-item ${v.id === record.activeVersionId ? 'active' : ''}`}
                      onClick={() => handleSwitchVersion(v.id)}
                    >
                      <span>{v.label}</span>
                      {v.prompt && <span className="va-version-prompt">{v.prompt.length > 30 ? v.prompt.slice(0, 30) + '...' : v.prompt}</span>}
                      <span className="va-version-time">{v.shots.length} 镜头 · {new Date(v.createdAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                  <div
                    className={`va-version-item ${record.activeVersionId === ORIGINAL_VERSION_ID || !record.activeVersionId ? 'active' : ''}`}
                    onClick={() => handleSwitchVersion(ORIGINAL_VERSION_ID)}
                  >
                    <span>原始版本</span>
                    <span className="va-version-time">{(record.storyboardVersions[record.storyboardVersions.length - 1]?.shots || []).length} 镜头</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {error && <div className="va-error">{error}</div>}
      </div>

      {rewriteProgress && !rewriting && <div className="ma-progress">{rewriteProgress}</div>}

      {/* 角色列表（可编辑描述） */}
      {record.characters && record.characters.length > 0 && (
        <div className="va-characters">
          {record.characters.map(char => (
            <div key={char.id} className="va-character-item">
              <div className="va-character-info" style={{ flex: 1 }}>
                <span className="va-character-name">{char.name}</span>
                <textarea
                  ref={autoResizeRef}
                  className="va-edit-textarea va-auto-resize"
                  rows={estimateRows(char.description)}
                  value={char.description}
                  onChange={e => handleCharacterDescChange(char.id, e.target.value)}
                  onInput={e => autoResize(e.currentTarget)}
                  placeholder="角色外貌描述（英文，用于文生图）"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分镜列表（可编辑） */}
      <div className="va-shots">
        {shots.map((shot, index) => (
          <ShotCard key={shot.id} shot={shot} index={index} compact>
            <div className="va-edit-fields">
              <label className="va-edit-label">画面描述</label>
              <textarea ref={autoResizeRef} className="va-edit-textarea va-auto-resize" rows={estimateRows(shot.description)} value={shot.description || ''} onChange={e => handleShotEdit(shot.id, 'description', e.target.value)} onInput={e => autoResize(e.currentTarget)} />
              <label className="va-edit-label">旁白</label>
              <textarea ref={autoResizeRef} className="va-edit-textarea va-auto-resize" rows={estimateRows(shot.narration)} value={shot.narration || ''} onChange={e => handleShotEdit(shot.id, 'narration', e.target.value)} onInput={e => autoResize(e.currentTarget)} />
              <label className="va-edit-label">运镜方式</label>
              <ComboInput value={shot.camera_movement || ''} onChange={v => handleShotEdit(shot.id, 'camera_movement', v)} options={CAMERA_MOVEMENT_OPTIONS} placeholder="选择或输入运镜方式" />
              <label className="va-edit-label">首帧 Prompt</label>
              <textarea ref={autoResizeRef} className="va-edit-textarea va-auto-resize" rows={estimateRows(shot.first_frame_prompt)} value={shot.first_frame_prompt || ''} onChange={e => handleShotEdit(shot.id, 'first_frame_prompt', e.target.value)} onInput={e => autoResize(e.currentTarget)} />
              <label className="va-edit-label">尾帧 Prompt</label>
              <textarea ref={autoResizeRef} className="va-edit-textarea va-auto-resize" rows={estimateRows(shot.last_frame_prompt)} value={shot.last_frame_prompt || ''} onChange={e => handleShotEdit(shot.id, 'last_frame_prompt', e.target.value)} onInput={e => autoResize(e.currentTarget)} />
              <label className="va-edit-label">转场方式</label>
              <ComboInput value={shot.transition_hint || ''} onChange={v => handleShotEdit(shot.id, 'transition_hint', v)} options={TRANSITION_OPTIONS} placeholder="选择转场方式" />
            </div>
          </ShotCard>
        ))}
      </div>

      <div className="va-page-actions">
        <button className="va-btn-primary" onClick={onNext}>
          下一步：批量生成 →
        </button>
      </div>
    </div>
  );
};
