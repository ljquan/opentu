/**
 * MV 分析页 — 合并音乐选择 + 创意描述 + AI 分镜生成
 * 分镜生成后输入区折叠，结果同页展示
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MVRecord, GeneratedClip } from '../types';
import { TaskType, TaskStatus } from '../../../types/task.types';
import { addRecord, updateRecord } from '../storage';
import { extractClipsFromTask } from '../../music-analyzer/task-sync';
import { toolWindowService } from '../../../services/tool-window-service';
import { musicAnalyzerTool } from '../../../tools/tools/music-analyzer';
import { taskStorageReader } from '../../../services/task-storage-reader';
import { taskQueueService } from '../../../services/task-queue';
import { buildStoryboardPrompt } from '../utils';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import { readStoredModelSelection, writeStoredModelSelection } from '../../video-analyzer/utils';
import { ShotCard } from '../../video-analyzer/components/ShotCard';

const STORAGE_KEY_PROMPT = 'mv-creator:creation-prompt';
const STORAGE_KEY_VIDEO_MODEL = 'mv-creator:video-model';
const STORAGE_KEY_STORYBOARD_MODEL = 'mv-creator:storyboard-model';
const DEFAULT_STORYBOARD_MODEL = 'gemini-2.5-pro';

function readSessionPrompt(): string {
  try { return sessionStorage.getItem(STORAGE_KEY_PROMPT) || ''; } catch { return ''; }
}
function writeSessionPrompt(value: string): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY_PROMPT, value);
    else sessionStorage.removeItem(STORAGE_KEY_PROMPT);
  } catch { /* noop */ }
}

interface AnalyzePageProps {
  existingRecord?: MVRecord | null;
  onComplete: (record: MVRecord) => void;
  onRecordsChange: (records: MVRecord[]) => void;
  onCreateNew?: () => void;
  onNext?: () => void;
}

// PLACEHOLDER_ANALYZE_PAGE_BODY

export const AnalyzePage: React.FC<AnalyzePageProps> = ({
  existingRecord,
  onComplete,
  onRecordsChange,
  onNext,
}) => {
  const [creationPrompt, setCreationPrompt] = useState(
    () => existingRecord?.creationPrompt || readSessionPrompt()
  );
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    existingRecord?.selectedClipId || null
  );
  const [inputCollapsed, setInputCollapsed] = useState(false);

  // 视频模型
  const videoModels = useSelectableModels('video');
  const [videoModel, setVideoModelState] = useState(
    () => existingRecord?.videoModel || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () => existingRecord?.videoModelRef || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelRef
  );
  const cfg = useMemo(() => getVideoModelConfig(videoModel), [videoModel]);
  const [segmentDuration, setSegmentDuration] = useState<number>(
    () => existingRecord?.segmentDuration || parseInt(cfg.defaultDuration, 10) || 8
  );
  const durationOptions = useMemo(() =>
    (cfg.durationOptions || []).map(opt => ({ value: parseInt(opt.value, 10), label: opt.label })),
    [cfg]
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

  // 回填已有 record
  useEffect(() => {
    if (!existingRecord) return;
    setCreationPrompt(existingRecord.creationPrompt || '');
    setSelectedClipId(existingRecord.selectedClipId || null);
  }, [existingRecord]);

  // 有分镜结果时自动折叠输入区
  const shots = existingRecord?.editedShots || [];
  useEffect(() => {
    if (shots.length > 0) setInputCollapsed(true);
  }, [shots.length]);

  useEffect(() => {
    if (!existingRecord) writeSessionPrompt(creationPrompt);
  }, [creationPrompt, existingRecord]);

  // 监听 pending 任务状态
  useEffect(() => {
    const taskId = existingRecord?.pendingStoryboardTaskId;
    if (!taskId) { setMessage(''); return; }
    const task = taskQueueService.getTask(taskId);
    if (task?.status === 'failed') { setMessage(`分镜生成失败: ${task.error?.message || '未知错误'}`); return; }
    if (task?.status === 'completed') { setMessage(''); return; }
    const sub = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (event.task.id !== taskId) return;
      if (event.task.status === 'failed') setMessage(`分镜生成失败: ${event.task.error?.message || '未知错误'}`);
      else if (event.task.status === 'completed') setMessage('');
    });
    return () => sub.unsubscribe();
  }, [existingRecord?.pendingStoryboardTaskId]);

// PLACEHOLDER_ANALYZE_PAGE_HANDLERS

  // 获取已有音频
  const [existingAudioClips, setExistingAudioClips] = useState<(GeneratedClip & { prompt?: string })[]>([]);
  useEffect(() => {
    let cancelled = false;
    taskStorageReader.getAllTasks({
      type: TaskType.AUDIO,
      status: TaskStatus.COMPLETED,
      includeArchived: true,
    }).then((audioTasks) => {
      if (cancelled) return;
      const result: (GeneratedClip & { prompt?: string })[] = [];
      for (const task of audioTasks) {
        const extracted = extractClipsFromTask(task);
        for (const clip of extracted) {
          result.push({ ...clip, prompt: String(task.params.prompt || '') });
        }
      }
      setExistingAudioClips(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    return existingRecord?.generatedClips?.find(c => c.clipId === selectedClipId)
      || existingAudioClips.find(c => c.clipId === selectedClipId)
      || null;
  }, [selectedClipId, existingRecord?.generatedClips, existingAudioClips]);

  const clipDuration = existingRecord?.selectedClipDuration || selectedClip?.duration || 30;

  const handleOpenMusicTool = useCallback(() => {
    const mvState = toolWindowService.getPrimaryToolState('mv-creator');
    const mvPos = mvState?.position;
    const offsetPos = mvPos
      ? { x: mvPos.x + (mvState?.tool.defaultWidth || 520) + 16, y: mvPos.y }
      : undefined;
    toolWindowService.openTool(musicAnalyzerTool.manifest, {
      launchMode: 'reuse',
      position: offsetPos,
    });
  }, []);

  const handleSelectExistingClip = useCallback(async (clip: GeneratedClip & { prompt?: string }) => {
    if (clip.prompt && !creationPrompt.trim()) {
      setCreationPrompt(clip.prompt);
    }
    let record = existingRecord || null;
    if (!record) {
      const sourceLabel = clip.title || clip.prompt?.slice(0, 20) || '已有音频';
      record = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        creationPrompt: creationPrompt.trim() || clip.prompt || '',
        sourceLabel,
        starred: false,
        musicTitle: clip.title || '',
        generatedClips: [clip],
        selectedClipId: clip.clipId,
        selectedClipDuration: clip.duration ?? null,
        selectedClipAudioUrl: clip.audioUrl,
      };
      const records = await addRecord(record);
      onRecordsChange(records);
      onComplete(record);
    } else {
      const existingClips = record.generatedClips || [];
      const alreadyExists = existingClips.some(c => c.clipId === clip.clipId);
      const nextClips = alreadyExists ? existingClips : [...existingClips, clip];
      const patch: Partial<MVRecord> = {
        generatedClips: nextClips,
        selectedClipId: clip.clipId,
        selectedClipDuration: clip.duration ?? null,
        selectedClipAudioUrl: clip.audioUrl,
        musicTitle: record.musicTitle || clip.title || '',
      };
      const updated = await updateRecord(record.id, patch);
      onRecordsChange(updated);
      onComplete({ ...record, ...patch });
    }
    setSelectedClipId(clip.clipId);
  }, [existingRecord, creationPrompt, onComplete, onRecordsChange]);

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

  const handleGenerateStoryboard = useCallback(async () => {
    if (generatingRef.current || !existingRecord) return;
    generatingRef.current = true;
    setSubmitting(true);
    setMessage('');
    try {
      const prompt = buildStoryboardPrompt({
        creationPrompt: creationPrompt || existingRecord.creationPrompt,
        musicTitle: existingRecord.musicTitle,
        musicStyleTags: existingRecord.musicStyleTags,
        musicLyrics: existingRecord.musicLyrics,
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
          mvCreatorRecordId: existingRecord.id,
          audioCacheUrl: selectedClip?.audioUrl,
        },
        TaskType.CHAT
      );
      const patch: Partial<MVRecord> = {
        pendingStoryboardTaskId: task.id,
        creationPrompt: creationPrompt || existingRecord.creationPrompt,
        videoModel,
        videoModelRef,
        segmentDuration,
      };
      const updated = await updateRecord(existingRecord.id, patch);
      onRecordsChange(updated);
      onComplete({ ...existingRecord, ...patch });
      setMessage('分镜规划任务已提交，等待 AI 生成...');
    } catch (err: any) {
      setMessage(err.message || '提交失败');
    } finally {
      setSubmitting(false);
      generatingRef.current = false;
    }
  }, [existingRecord, creationPrompt, clipDuration, videoModel, videoModelRef, segmentDuration, storyboardModel, storyboardModelRef, selectedClip, onComplete, onRecordsChange]);

// PLACEHOLDER_ANALYZE_PAGE_RENDER

  return (
    <div className="va-page">
      {/* 输入区（可折叠） */}
      {shots.length > 0 && (
        <button
          className="va-collapse-toggle"
          onClick={() => setInputCollapsed(prev => !prev)}
        >
          {inputCollapsed ? '▶ 展开配置' : '▼ 收起配置'}
        </button>
      )}

      {!inputCollapsed && (
        <>
          {/* 音乐选择 */}
          <div className="ma-card ma-card--grow">
            <div className="ma-card-header">
              <span>选择配乐 ({existingAudioClips.length})</span>
              <button
                className="ma-chip ma-chip--accent"
                style={{ cursor: 'pointer', fontSize: '11px', padding: '2px 8px' }}
                onClick={handleOpenMusicTool}
              >
                + 生成新音乐
              </button>
            </div>
            {existingAudioClips.length === 0 ? (
              <div className="ma-hint">
                暂无已完成的音频，
                <button
                  onClick={handleOpenMusicTool}
                  style={{
                    background: 'none', border: 'none', color: '#E67E22',
                    cursor: 'pointer', textDecoration: 'underline',
                    padding: 0, font: 'inherit',
                  }}
                >
                  去生成音乐
                </button>
              </div>
            ) : (
              <div className="ma-clips-gallery">
                {existingAudioClips.map((clip, i) => (
                  <div
                    key={`${clip.clipId || i}`}
                    className={`ma-clip-row ${selectedClipId === clip.clipId ? 'is-selected' : ''}`}
                    onClick={() => handleSelectExistingClip(clip)}
                    style={{ cursor: 'pointer' }}
                  >
                    {clip.imageUrl ? (
                      <img src={clip.imageUrl} alt="" className="ma-clip-thumb" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="ma-clip-thumb ma-clip-thumb--placeholder">♪</div>
                    )}
                    <div className="ma-clip-meta">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="ma-clip-title">{clip.title || clip.prompt?.slice(0, 30) || clip.clipId}</span>
                        {selectedClipId === clip.clipId && (
                          <span className="ma-chip ma-chip--accent" style={{ flexShrink: 0, padding: '0 4px', fontSize: '10px', height: '16px', lineHeight: '14px' }}>已选</span>
                        )}
                      </div>
                      {clip.duration != null && (
                        <span className="ma-clip-duration">{Math.round(clip.duration)}s</span>
                      )}
                    </div>
                    <audio controls src={clip.audioUrl} preload="metadata" className="ma-clip-player" onClick={e => e.stopPropagation()} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 创意描述 */}
          <div className="ma-card">
            <div className="ma-card-header"><span>MV 创意描述</span></div>
            <textarea
              className="ma-textarea"
              rows={2}
              placeholder="描述你想要的 MV 主题、风格、情绪、画面..."
              value={creationPrompt}
              onChange={e => setCreationPrompt(e.target.value)}
            />
          </div>

          {/* 视频模型 + 单段时长 */}
          {selectedClipId && (
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
          )}

          {/* 分镜模型 */}
          {selectedClipId && (
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
          )}

          {message && <div className="ma-progress">{message}</div>}

          {/* 生成分镜按钮 */}
          {selectedClipId && (
            <div className="va-page-actions">
              <button
                className="va-btn-primary"
                onClick={handleGenerateStoryboard}
                disabled={submitting || !existingRecord}
              >
                {submitting ? '提交中...' : shots.length > 0 ? '重新生成分镜' : 'AI 生成分镜'}
              </button>
            </div>
          )}
        </>
      )}


      {/* 结果区 */}
      {shots.length > 0 && (
        <>
          {/* 选定配乐摘要 */}
          {selectedClip && inputCollapsed && (
            <div className="ma-card">
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

          {/* 角色列表 */}
          {existingRecord?.characters && existingRecord.characters.length > 0 && (
            <div className="ma-card">
              <div className="ma-card-header"><span>角色（{existingRecord.characters.length} 个）</span></div>
              <div className="va-characters">
                {existingRecord.characters.map(char => (
                  <div key={char.id} className="va-character-item">
                    <div className="va-character-info">
                      <span className="va-character-name">{char.name}</span>
                      <span className="va-character-desc">{char.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 分镜列表 */}
          <div className="ma-card">
            <div className="ma-card-header"><span>分镜脚本（{shots.length} 个镜头）</span></div>
            <div className="va-shots">
              {shots.map((shot, index) => (
                <ShotCard key={shot.id} shot={shot} index={index} compact />
              ))}
            </div>
          </div>

          {/* 下一步 */}
          {onNext && (
            <div className="va-page-actions">
              <button className="va-btn-primary" onClick={onNext}>
                下一步：编辑脚本 →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
