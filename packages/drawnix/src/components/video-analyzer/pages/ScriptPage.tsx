/**
 * 脚本编辑页 - 商品信息 + AI 改编 + 镜头脚本编辑
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { AnalysisRecord, ProductInfo, VideoShot } from '../types';
import { formatShotsMarkdown, migrateProductInfo } from '../types';
import { quickInsert } from '../../../mcp/tools/canvas-insertion';
import { updateRecord } from '../storage';
import { ShotCard } from '../components/ShotCard';
import { ComboInput } from '../components/ComboInput';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { computeSegmentPlan, type SegmentPlan } from '../../../utils/segment-plan';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
  buildScriptRewritePrompt,
} from '../utils';
import { taskQueueService } from '../../../services/task-queue';
import { TaskType } from '../../../types/task.types';
import { syncVideoAnalyzerTask } from '../task-sync';

const STORAGE_KEY_SCRIPT_MODEL = 'video-analyzer:script-model';
const STORAGE_KEY_VIDEO_MODEL = 'video-analyzer:video-model';
const DEFAULT_SCRIPT_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_VIDEO_MODEL = 'veo3';

const CAMERA_MOVEMENT_OPTIONS = [
  '固定镜头 (Static)',
  '缓慢推近 (Dolly In)',
  '缓慢拉远 (Dolly Out)',
  '水平平移 (Pan)',
  '垂直摇移 (Tilt)',
  '跟随拍摄 (Follow)',
  '手持感 (Handheld)',
  '环绕拍摄 (Orbit)',
  '升降镜头 (Crane)',
  '快速推移 (Zoom In)',
  '快速拉远 (Zoom Out)',
  '滑轨移动 (Slider)',
  '航拍俯冲 (Drone Dive)',
  '第一人称 (POV)',
];

const SPEECH_RELATION_OPTIONS = [
  { label: '无 (none)', value: 'none' },
  { label: '仅旁白 (narration_only)', value: 'narration_only' },
  { label: '仅对白 (dialogue_only)', value: 'dialogue_only' },
  { label: '旁白+对白 (both)', value: 'both' },
];

const TRANSITION_OPTIONS = [
  { label: '硬切 (cut)', value: 'cut' },
  { label: '溶解 (dissolve)', value: 'dissolve' },
  { label: '匹配切 (match_cut)', value: 'match_cut' },
  { label: '淡出到黑 (fade_to_black)', value: 'fade_to_black' },
];

interface ScriptPageProps {
  record: AnalysisRecord;
  onRecordUpdate: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
  onNext?: () => void;
}

export const ScriptPage: React.FC<ScriptPageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
  onNext,
}) => {
  const [productInfo, setProductInfo] = useState<ProductInfo>(() =>
    migrateProductInfo(
      record.productInfo || { prompt: '' },
      record.analysis.totalDuration
    )
  );
  const [shots, setShots] = useState<VideoShot[]>(
    record.editedShots || [...record.analysis.shots]
  );
  const [rewriting, setRewriting] = useState(false);
  const [pendingRewriteTaskId, setPendingRewriteTaskId] = useState<string | null>(
    () => record.pendingRewriteTaskId || null
  );
  const [error, setError] = useState('');
  const [scriptModel, setScriptModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_SCRIPT_MODEL, DEFAULT_SCRIPT_MODEL).modelId
  );
  const [scriptModelRef, setScriptModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_SCRIPT_MODEL, DEFAULT_SCRIPT_MODEL).modelRef
  );
  const setScriptModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setScriptModelState(model);
    setScriptModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_SCRIPT_MODEL, model, modelRef);
  }, []);
  const textModels = useSelectableModels('text');
  const videoModels = useSelectableModels('video');
  const [videoModel, setVideoModelState] = useState(
    () =>
      record.productInfo?.videoModel ||
      readStoredModelSelection(
        STORAGE_KEY_VIDEO_MODEL,
        DEFAULT_VIDEO_MODEL
      ).modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () =>
      record.productInfo?.videoModelRef ||
      readStoredModelSelection(
        STORAGE_KEY_VIDEO_MODEL,
        record.productInfo?.videoModel || DEFAULT_VIDEO_MODEL
      ).modelRef
  );
  const setVideoModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setVideoModelState(model);
    setVideoModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, model, modelRef);
    const cfg = getVideoModelConfig(model);
    const defaultDur = parseInt(cfg.defaultDuration, 10) || 8;
    setProductInfo(p => ({
      ...p,
      videoModel: model,
      videoModelRef: modelRef || null,
      segmentDuration: defaultDur,
    }));
  }, []);

  // 当前视频模型的可用时长选项
  const durationOptions = useMemo(() => {
    const cfg = getVideoModelConfig(videoModel);
    return cfg.durationOptions;
  }, [videoModel]);

  // 用户选择的单段时长（默认取模型的 defaultDuration）
  const selectedSegmentDuration = useMemo(() => {
    if (productInfo.segmentDuration) {
      const valid = durationOptions.some(o => parseInt(o.value, 10) === productInfo.segmentDuration);
      if (valid) return productInfo.segmentDuration;
    }
    const cfg = getVideoModelConfig(videoModel);
    return parseInt(cfg.defaultDuration, 10) || 8;
  }, [productInfo.segmentDuration, durationOptions, videoModel]);

  // 分段计划（基于用户选择的单段时长）
  const segmentPlan = useMemo((): SegmentPlan => {
    const targetDur = productInfo.targetDuration || record.analysis.totalDuration;
    const singleOption = [{ label: `${selectedSegmentDuration}秒`, value: String(selectedSegmentDuration) }];
    return computeSegmentPlan(targetDur, singleOption);
  }, [selectedSegmentDuration, productInfo.targetDuration, record.analysis.totalDuration]);

  useEffect(() => {
    setProductInfo(
      migrateProductInfo(
        record.productInfo || { prompt: '' },
        record.analysis.totalDuration
      )
    );
    setShots(record.editedShots || [...record.analysis.shots]);
    setPendingRewriteTaskId(record.pendingRewriteTaskId || null);
  }, [record]);

  // 表单变化时自动保存到 IndexedDB（防抖 500ms）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const updated = await updateRecord(record.id, { productInfo });
      onRecordsChange(updated);
      onRecordUpdate({ ...record, productInfo });
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [productInfo]); // 只依赖 productInfo，避免循环

  const saveShots = useCallback(async (newShots: VideoShot[]) => {
    setShots(newShots);
    const updated = await updateRecord(record.id, { editedShots: newShots, productInfo });
    onRecordsChange(updated);
    onRecordUpdate({ ...record, editedShots: newShots, productInfo });
  }, [record, productInfo, onRecordUpdate, onRecordsChange]);

  const handleShotFieldChange = useCallback((shotId: string, field: keyof VideoShot, value: string) => {
    const newShots = shots.map(s => s.id === shotId ? { ...s, [field]: value } : s);
    saveShots(newShots);
  }, [shots, saveShots]);

  const handleRewrite = useCallback(async () => {
    if (!productInfo.prompt?.trim()) {
      setError('请填写提示词');
      return;
    }
    setRewriting(true);
    setError('');
    try {
      const actualPrompt = buildScriptRewritePrompt({
        recordAnalysis: record.analysis,
        productInfo,
        videoModel,
      });
      const task = taskQueueService.createTask(
        {
          prompt: `改编脚本：${productInfo.prompt.slice(0, 40)}`,
          model: scriptModel,
          modelRef: scriptModelRef || null,
          videoAnalyzerAction: 'rewrite',
          videoAnalyzerPrompt: actualPrompt,
          videoAnalyzerRecordId: record.id,
          autoInsertToCanvas: false,
        },
        TaskType.CHAT
      );
      setPendingRewriteTaskId(task.id);
      const updated = await updateRecord(record.id, {
        pendingRewriteTaskId: task.id,
      });
      onRecordsChange(updated);
      onRecordUpdate({ ...record, pendingRewriteTaskId: task.id });
    } catch (err: any) {
      setError(err.message || '改编失败');
    } finally {
      setRewriting(false);
    }
  }, [record, productInfo, shots, videoModel, scriptModel, scriptModelRef, onRecordUpdate, onRecordsChange]);

  useEffect(() => {
    if (!pendingRewriteTaskId) {
      return;
    }

    const subscription = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (event.task.id !== pendingRewriteTaskId) {
        return;
      }

      if (event.task.status === 'failed') {
        setPendingRewriteTaskId(null);
        setError(event.task.error?.message || '改编失败');
        void updateRecord(record.id, { pendingRewriteTaskId: null }).then(updated => {
          onRecordsChange(updated);
          onRecordUpdate({ ...record, pendingRewriteTaskId: null });
        });
        return;
      }

      if (event.task.status === 'completed') {
        void syncVideoAnalyzerTask(event.task).then(synced => {
          if (!synced) {
            return;
          }
          onRecordsChange(synced.records);
          onRecordUpdate(synced.record);
          setShots(synced.record.editedShots || synced.record.analysis.shots);
        }).catch((err: any) => {
          setError(err.message || '改编结果同步失败');
        }).finally(() => {
          setPendingRewriteTaskId(null);
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [pendingRewriteTaskId, record.id, onRecordUpdate, onRecordsChange]);

  const handleInsertScripts = useCallback(async () => {
    await quickInsert('text', formatShotsMarkdown(shots, record.analysis, productInfo));
  }, [shots, productInfo, record]);

  return (
    <div className="va-page">
      {/* 提示词 + 参数 */}
      <div className="va-product-form">
        <textarea
          className="va-form-textarea"
          placeholder="描述你想要的视频内容，如：拖鞋，生活用品，主打防滑..."
          rows={3}
          value={productInfo.prompt}
          onChange={e => setProductInfo(p => ({ ...p, prompt: e.target.value }))}
        />
        <div className="va-form-row">
          <div className="va-duration-input" style={{ width: 'auto', flex: 1 }}>
            <label className="va-edit-label">视频时长(秒)</label>
            <input className="va-form-input" type="number" min={5} max={300} value={productInfo.targetDuration ?? record.analysis.totalDuration} onChange={e => setProductInfo(p => ({ ...p, targetDuration: Number(e.target.value) || undefined }))} />
          </div>
        </div>
        <div className="va-model-select">
          <label className="va-model-label">改编模型</label>
          <ModelDropdown
            variant="form"
            selectedModel={scriptModel}
            selectedSelectionKey={getSelectionKey(scriptModel, scriptModelRef)}
            onSelect={setScriptModel}
            models={textModels}
            placement="down"
            disabled={rewriting}
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
            disabled={rewriting}
            placeholder="选择视频模型"
          />
          <div className="va-segment-duration-select">
            <label className="va-model-label">单段</label>
            <select
              className="va-form-select"
              value={String(selectedSegmentDuration)}
              onChange={e => setProductInfo(p => ({ ...p, segmentDuration: parseInt(e.target.value, 10) }))}
              disabled={durationOptions.length <= 1}
            >
              {durationOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {segmentPlan.overflow > 0 && (
            <span className="va-duration-overflow">
              实际 {segmentPlan.actualTotal}s（+{segmentPlan.overflow}s）
            </span>
          )}
        </div>
        <button className="va-analyze-btn" onClick={handleRewrite} disabled={rewriting || !!pendingRewriteTaskId}>
          {rewriting || pendingRewriteTaskId ? 'AI 改编中...' : 'AI 改编脚本'}
        </button>
        {error && <div className="va-error">{error}</div>}
      </div>

      {/* 镜头脚本列表 */}
      <div className="va-shots">
        {shots.map((shot, i) => (
          <ShotCard key={shot.id} shot={shot} index={i} compact>
            <div className="va-edit-fields">
              <label className="va-edit-label">画面描述</label>
              <textarea className="va-edit-textarea" rows={2} value={shot.description || ''} onChange={e => handleShotFieldChange(shot.id, 'description', e.target.value)} />
              <label className="va-edit-label">旁白</label>
              <textarea className="va-edit-textarea" rows={2} value={shot.narration || ''} onChange={e => handleShotFieldChange(shot.id, 'narration', e.target.value)} />
              <label className="va-edit-label">角色说话</label>
              <textarea className="va-edit-textarea" rows={2} value={shot.dialogue || ''} onChange={e => handleShotFieldChange(shot.id, 'dialogue', e.target.value)} placeholder={'多角色时按"角色名: 台词"分行'} />
              <label className="va-edit-label">对白角色</label>
              <input className="va-form-input" type="text" value={shot.dialogue_speakers || ''} onChange={e => handleShotFieldChange(shot.id, 'dialogue_speakers', e.target.value)} placeholder="如：主讲人 或 主讲人|顾客" />
              <label className="va-edit-label">旁白/对白关系</label>
              <ComboInput value={shot.speech_relation || ''} onChange={v => handleShotFieldChange(shot.id, 'speech_relation', v)} options={SPEECH_RELATION_OPTIONS} placeholder="选择关系" />
              <label className="va-edit-label">运镜方式</label>
              <ComboInput value={shot.camera_movement || ''} onChange={v => handleShotFieldChange(shot.id, 'camera_movement', v)} options={CAMERA_MOVEMENT_OPTIONS} placeholder="选择或输入运镜方式" />
              <label className="va-edit-label">首帧 Prompt</label>
              <textarea className="va-edit-textarea" rows={2} value={shot.first_frame_prompt || ''} onChange={e => handleShotFieldChange(shot.id, 'first_frame_prompt', e.target.value)} />
              <label className="va-edit-label">尾帧 Prompt</label>
              <textarea className="va-edit-textarea" rows={2} value={shot.last_frame_prompt || ''} onChange={e => handleShotFieldChange(shot.id, 'last_frame_prompt', e.target.value)} />
              <label className="va-edit-label">转场方式</label>
              <ComboInput value={shot.transition_hint || ''} onChange={v => handleShotFieldChange(shot.id, 'transition_hint', v)} options={TRANSITION_OPTIONS} placeholder="选择转场方式" />
            </div>
          </ShotCard>
        ))}
      </div>

      <div className="va-page-actions">
        <button onClick={handleInsertScripts}>脚本→画布</button>
        {onNext && <button className="va-btn-primary" onClick={onNext}>下一步: 生成素材 →</button>}
      </div>
    </div>
  );
};
