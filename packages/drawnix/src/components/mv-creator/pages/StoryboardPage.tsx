/**
 * MV 分镜规划页
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MVRecord, VideoShot } from '../types';
import { updateRecord } from '../storage';
import { taskQueueService } from '../../../services/task-queue';
import { TaskType } from '../../../types/task.types';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import { ShotCard } from '../../video-analyzer/components/ShotCard';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../../video-analyzer/utils';
import { buildStoryboardPrompt } from '../utils';

const STORAGE_KEY_VIDEO_MODEL = 'mv-creator:video-model';
const STORAGE_KEY_STORYBOARD_MODEL = 'mv-creator:storyboard-model';
const DEFAULT_STORYBOARD_MODEL = 'gemini-2.5-pro';

interface StoryboardPageProps {
  record: MVRecord;
  onRecordUpdate: (record: MVRecord) => void;
  onRecordsChange: (records: MVRecord[]) => void;
  onNext: () => void;
}

export const StoryboardPage: React.FC<StoryboardPageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
  onNext,
}) => {
  const selectedClip = record.generatedClips?.find(c => c.clipId === record.selectedClipId);
  const clipDuration = record.selectedClipDuration || selectedClip?.duration || 30;

  // 视频模型
  const videoModels = useSelectableModels('video');
  const [videoModel, setVideoModelState] = useState(
    () => record.videoModel || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () => record.videoModelRef || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelRef
  );

  const cfg = useMemo(() => getVideoModelConfig(videoModel), [videoModel]);
  const [segmentDuration, setSegmentDuration] = useState<number>(
    () => record.segmentDuration || parseInt(cfg.defaultDuration, 10) || 8
  );

  // 分镜模型
  const textModels = useSelectableModels('text');
  const storyboardModels = useMemo(
    () => textModels.filter(m => /^gemini/i.test(m.id)),
    [textModels]
  );
  const [storyboardModel, setStoryboardModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_STORYBOARD_MODEL, DEFAULT_STORYBOARD_MODEL).modelId
  );
  const [storyboardModelRef, setStoryboardModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_STORYBOARD_MODEL, DEFAULT_STORYBOARD_MODEL).modelRef
  );

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const generatingRef = useRef(false);

  // 监听 pending 任务状态，更新提示信息
  useEffect(() => {
    const taskId = record.pendingStoryboardTaskId;
    if (!taskId) {
      // pendingStoryboardTaskId 被清除说明任务已同步完成
      setMessage('');
      return;
    }
    // 检查任务当前状态
    const task = taskQueueService.getTask(taskId);
    if (task?.status === 'failed') {
      setMessage(`分镜生成失败: ${task.error?.message || '未知错误'}`);
      return;
    }
    if (task?.status === 'completed') {
      setMessage('');
      return;
    }
    // 任务仍在进行中，订阅更新
    const sub = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (event.task.id !== taskId) return;
      if (event.task.status === 'failed') {
        setMessage(`分镜生成失败: ${event.task.error?.message || '未知错误'}`);
      } else if (event.task.status === 'completed') {
        setMessage('');
      }
    });
    return () => sub.unsubscribe();
  }, [record.pendingStoryboardTaskId]);

  const shots = record.editedShots || [];

  const setVideoModel = useCallback((model: string, ref?: ModelRef | null) => {
    setVideoModelState(model);
    setVideoModelRef(ref || null);
    writeStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, model, ref);
    const newCfg = getVideoModelConfig(model);
    setSegmentDuration(parseInt(newCfg.defaultDuration, 10) || 8);
  }, []);

  const setStoryboardModel = useCallback((model: string, ref?: ModelRef | null) => {
    setStoryboardModelState(model);
    setStoryboardModelRef(ref || null);
    writeStoredModelSelection(STORAGE_KEY_STORYBOARD_MODEL, model, ref);
  }, []);

  const durationOptions = useMemo(() => {
    return (cfg.durationOptions || []).map(opt => ({
      value: parseInt(opt.value, 10),
      label: opt.label,
    }));
  }, [cfg]);

  const handleGenerateStoryboard = useCallback(async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setSubmitting(true);
    setMessage('');

    try {
      const prompt = buildStoryboardPrompt({
        creationPrompt: record.creationPrompt,
        musicTitle: record.musicTitle,
        musicStyleTags: record.musicStyleTags,
        musicLyrics: record.musicLyrics,
        clipDuration,
        videoModel,
        segmentDuration,
        hasAudio: !!selectedClip?.audioUrl,
      });

      const task = taskQueueService.createTask(
        {
          prompt,
          model: storyboardModel,
          modelRef: storyboardModelRef,
          mvCreatorAction: 'storyboard',
          mvCreatorRecordId: record.id,
          audioCacheUrl: selectedClip?.audioUrl,
        },
        TaskType.CHAT
      );

      const patch: Partial<MVRecord> = {
        pendingStoryboardTaskId: task.id,
        videoModel,
        videoModelRef,
        segmentDuration,
      };
      const updated = await updateRecord(record.id, patch);
      onRecordsChange(updated);
      onRecordUpdate({ ...record, ...patch });
      setMessage('分镜规划任务已提交，等待 AI 生成...');
    } catch (err: any) {
      setMessage(err.message || '提交失败');
    } finally {
      setSubmitting(false);
      generatingRef.current = false;
    }
  }, [
    record, clipDuration, videoModel, videoModelRef, segmentDuration,
    storyboardModel, storyboardModelRef,
    onRecordUpdate, onRecordsChange,
  ]);

  const handleShotEdit = useCallback(async (shotId: string, field: string, value: string) => {
    const updatedShots = shots.map(s =>
      s.id === shotId ? { ...s, [field]: value } : s
    );
    const patch: Partial<MVRecord> = { editedShots: updatedShots };
    const updated = await updateRecord(record.id, patch);
    onRecordsChange(updated);
    onRecordUpdate({ ...record, ...patch });
  }, [shots, record, onRecordUpdate, onRecordsChange]);

  return (
    <div className="va-page">
      {/* 选定音乐信息 */}
      {selectedClip && (
        <div className="ma-card">
          <div className="ma-card-header"><span>选定配乐</span></div>
          <div className="ma-clip-row is-selected">
            {selectedClip.imageUrl ? (
              <img src={selectedClip.imageUrl} alt="" className="ma-clip-thumb" referrerPolicy="no-referrer" />
            ) : (
              <div className="ma-clip-thumb ma-clip-thumb--placeholder">♪</div>
            )}
            <div className="ma-clip-meta">
              <span className="ma-clip-title">{selectedClip.title || selectedClip.clipId}</span>
              <span className="ma-clip-duration">{Math.round(clipDuration)}s</span>
            </div>
            <audio controls src={selectedClip.audioUrl} preload="metadata" className="ma-clip-player" />
          </div>
        </div>
      )}

      {/* 视频模型 + 单段时长 */}
      <div className="ma-card">
        <div className="ma-card-header"><span>视频参数</span></div>
        <div className="va-model-select">
          <label className="va-model-label">视频模型</label>
          <ModelDropdown
            models={videoModels}
            selectedModel={videoModel}
            selectedSelectionKey={getSelectionKey(videoModel, videoModelRef)}
            onSelect={(id: string, ref?: ModelRef | null) => setVideoModel(id, ref)}
            variant="form"
            placement="down"
          />
          <div className="va-segment-duration-select">
            <label className="va-model-label">单段</label>
            <select
              className="va-form-select"
              value={String(segmentDuration)}
              onChange={e => setSegmentDuration(parseInt(e.target.value, 10))}
              disabled={durationOptions.length <= 1}
            >
              {durationOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 分镜模型 + 生成按钮 */}
      <div className="ma-card">
        <div className="ma-card-header"><span>AI 分镜模型</span></div>
        <ModelDropdown
          models={storyboardModels}
          selectedModel={storyboardModel}
          selectedSelectionKey={getSelectionKey(storyboardModel, storyboardModelRef)}
          onSelect={(id: string, ref?: ModelRef | null) => setStoryboardModel(id, ref)}
          variant="form"
          placement="down"
        />
      </div>

      {message && <div className="ma-progress">{message}</div>}

      <div className="va-page-actions">
        <button
          className="va-btn-primary"
          onClick={handleGenerateStoryboard}
          disabled={submitting}
        >
          {submitting ? '提交中...' : shots.length > 0 ? '重新生成分镜' : 'AI 生成分镜'}
        </button>
      </div>

      {/* 分镜列表 */}
      {shots.length > 0 && (
        <div className="ma-card">
          <div className="ma-card-header"><span>分镜脚本（{shots.length} 个镜头）</span></div>
          <div className="va-shots">
            {shots.map((shot, index) => (
              <ShotCard key={shot.id} shot={shot} index={index} compact>
                <div className="va-shot-edit-fields">
                  <EditField
                    label="画面描述"
                    value={shot.description}
                    onChange={v => handleShotEdit(shot.id, 'description', v)}
                  />
                  <EditField
                    label="运镜"
                    value={shot.camera_movement || ''}
                    onChange={v => handleShotEdit(shot.id, 'camera_movement', v)}
                  />
                  <EditField
                    label="首帧 Prompt"
                    value={shot.first_frame_prompt || ''}
                    onChange={v => handleShotEdit(shot.id, 'first_frame_prompt', v)}
                  />
                  <EditField
                    label="尾帧 Prompt"
                    value={shot.last_frame_prompt || ''}
                    onChange={v => handleShotEdit(shot.id, 'last_frame_prompt', v)}
                  />
                </div>
              </ShotCard>
            ))}
          </div>
        </div>
      )}

      {/* 下一步 */}
      {shots.length > 0 && (
        <div className="va-page-actions">
          <button className="va-btn-primary" onClick={onNext}>
            下一步：批量生成 →
          </button>
        </div>
      )}
    </div>
  );
};

const EditField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="va-edit-field">
    <label className="va-edit-field-label">{label}</label>
    <textarea
      className="va-edit-field-input"
      rows={2}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  </div>
);
