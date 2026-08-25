/**
 * MV 分析页 — 合并音乐选择 + AI 分镜生成
 * 分镜生成后输入区折叠，结果同页展示
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateUUID } from '../../../utils/runtime-helpers';
import type { MVRecord, GeneratedClip } from '../types';
import { TaskType, TaskStatus, type KnowledgeContextRef } from '../../../types/task.types';
import { addRecord, updateRecord } from '../storage';
import { extractClipsFromTask } from '../../music-analyzer/task-sync';
import { toolWindowService } from '../../../services/tool-window-service';
import { musicAnalyzerTool } from '../../../tools/tools/music-analyzer';
import { taskStorageReader } from '../../../services/task-storage-reader';
import { taskQueueService } from '../../../services/task-queue';
import { buildStoryboardPrompt } from '../utils';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import {
  CreativeBriefEditor,
  VideoParametersRow,
  normalizeCreativeBrief,
  readStoredModelSelection,
  writeStoredModelSelection,
  ShotCard,
  type CreativeBrief,
} from '../../shared/workflow';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { KnowledgeNoteContextSelector } from '../../shared';
import { analytics } from '../../../utils/umami-analytics';

const STORAGE_KEY_VIDEO_MODEL = 'mv-creator:video-model';
const STORAGE_KEY_STORYBOARD_MODEL = 'mv-creator:storyboard-model';
const DEFAULT_STORYBOARD_MODEL = 'gemini-2.5-pro';
const DRAFT_STORYBOARD_SOURCE_LABEL = 'AI 分镜草稿';

function getDraftStoryboardSourceLabel(
  brief: CreativeBrief,
  style: string
): string {
  const label =
    brief.purpose ||
    brief.directorStyle ||
    brief.narrativeStyle ||
    style ||
    DRAFT_STORYBOARD_SOURCE_LABEL;
  return label.trim().slice(0, 24) || DRAFT_STORYBOARD_SOURCE_LABEL;
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
  const [videoStyle, setVideoStyle] = useState(existingRecord?.videoStyle || '');
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>(
    () => normalizeCreativeBrief(existingRecord?.creativeBrief)
  );
  const [knowledgeContextRefs, setKnowledgeContextRefs] = useState<
    KnowledgeContextRef[]
  >([]);
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const latestRecordRef = useRef<MVRecord | null>(existingRecord || null);

  // 回填已有 record
  useEffect(() => {
    if (!existingRecord) return;
    setVideoStyle(existingRecord.videoStyle || '');
    setCreativeBrief(normalizeCreativeBrief(existingRecord.creativeBrief));
    setSelectedClipId(existingRecord.selectedClipId || null);
  }, [existingRecord]);

  useEffect(() => {
    latestRecordRef.current = existingRecord || null;
  }, [existingRecord]);

  useEffect(() => {
    setKnowledgeContextRefs([]);
  }, [existingRecord?.id]);

  // 有分镜结果时自动折叠输入区
  const shots = existingRecord?.editedShots || [];
  useEffect(() => {
    if (shots.length > 0) setInputCollapsed(true);
  }, [shots.length]);

  const existingRecordId = existingRecord?.id;
  useEffect(() => {
    if (!existingRecordId) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const currentRecord = latestRecordRef.current;
      if (!currentRecord || currentRecord.id !== existingRecordId) return;
      const patch: Partial<MVRecord> = {
        videoStyle,
        creativeBrief,
        videoModel,
        videoModelRef,
        segmentDuration,
      };
      const updated = await updateRecord(existingRecordId, patch);
      onRecordsChange(updated);
      onComplete({ ...currentRecord, ...patch });
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [
    existingRecordId,
    videoStyle,
    creativeBrief,
    videoModel,
    videoModelRef,
    segmentDuration,
    onComplete,
    onRecordsChange,
  ]);

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
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    return existingRecord?.generatedClips?.find(c => c.clipId === selectedClipId)
      || existingAudioClips.find(c => c.clipId === selectedClipId)
      || null;
  }, [selectedClipId, existingRecord?.generatedClips, existingAudioClips]);

  const selectedAudioUrl = selectedClip?.audioUrl || (selectedClipId ? existingRecord?.selectedClipAudioUrl : null);
  const clipDuration = existingRecord?.selectedClipDuration || selectedClip?.duration || 30;

  const handleOpenMusicTool = useCallback(() => {
    analytics.trackUIInteraction({
      area: 'popular_mv_tool',
      action: 'music_tool_opened',
      control: 'open_music_tool',
      source: 'mv_creator_analyze_page',
      metadata: { existingAudioClipsCount: existingAudioClips.length },
    });
    const mvState = toolWindowService.getPrimaryToolState('mv-creator');
    const mvPos = mvState?.position;
    const offsetPos = mvPos
      ? { x: mvPos.x + (mvState?.tool.defaultWidth || 520) + 16, y: mvPos.y }
      : undefined;
    toolWindowService.openTool(musicAnalyzerTool.manifest, {
      launchMode: 'reuse',
      position: offsetPos,
    });
  }, [existingAudioClips.length]);

  const handleSelectExistingClip = useCallback(async (clip: GeneratedClip & { prompt?: string }) => {
    analytics.trackUIInteraction({
      area: 'popular_mv_tool',
      action: 'music_clip_selected',
      control: 'select_music_clip',
      source: 'mv_creator_analyze_page',
      metadata: {
        hasClipId: !!clip.clipId,
        hasAudioUrl: !!clip.audioUrl,
        duration: clip.duration,
      },
    });
    let record = existingRecord || null;
    if (!record) {
      const sourceLabel = clip.title || clip.prompt?.slice(0, 20) || '已有音频';
      record = {
        id: generateUUID(),
        createdAt: Date.now(),
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
    setMessage('');
  }, [existingRecord, onComplete, onRecordsChange]);

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
    if (generatingRef.current) return;
    if (!selectedAudioUrl) {
      setMessage('请先选择配乐');
      return;
    }
    generatingRef.current = true;
    const targetRecord: MVRecord = existingRecord || {
      id: generateUUID(),
      createdAt: Date.now(),
      sourceLabel: getDraftStoryboardSourceLabel(creativeBrief, videoStyle),
      starred: false,
      musicTitle: '',
      generatedClips: [],
      selectedClipId: null,
      selectedClipDuration: null,
      selectedClipAudioUrl: null,
    };
    analytics.trackUIInteraction({
      area: 'popular_mv_tool',
      action: 'storyboard_generation_started',
      control: 'generate_storyboard',
      source: 'mv_creator_analyze_page',
      metadata: {
        hasSelectedClip: !!selectedAudioUrl,
        clipDuration,
        segmentDuration,
        hasStoryboardModelRef: !!storyboardModelRef,
        hasVideoModelRef: !!videoModelRef,
      },
    });
    setSubmitting(true);
    setMessage('');
    try {
      const prompt = buildStoryboardPrompt({
        musicTitle: targetRecord.musicTitle,
        musicStyleTags: targetRecord.musicStyleTags,
        musicLyrics: targetRecord.musicLyrics,
        clipDuration,
        videoModel,
        segmentDuration,
        aspectRatio: targetRecord.aspectRatio || '16x9',
        videoStyle,
        creativeBrief,
        hasAudio: !!selectedAudioUrl,
      });
      const task = taskQueueService.createTask(
        {
          prompt,
          model: storyboardModel,
          modelRef: storyboardModelRef,
          mvCreatorAction: 'storyboard',
          mvCreatorRecordId: targetRecord.id,
          knowledgeContextRefs,
          audioCacheUrl: selectedAudioUrl,
        },
        TaskType.CHAT
      );
      const patch: Partial<MVRecord> = {
        pendingStoryboardTaskId: task.id,
        videoModel,
        videoModelRef,
        segmentDuration,
        videoStyle,
        creativeBrief,
        aspectRatio: targetRecord.aspectRatio || '16x9',
      };
      const nextRecord = { ...targetRecord, ...patch };
      const updated = existingRecord
        ? await updateRecord(targetRecord.id, patch)
        : await addRecord(nextRecord);
      onRecordsChange(updated);
      onComplete(nextRecord);
      setMessage('分镜规划任务已提交，等待 AI 生成...');
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
      generatingRef.current = false;
    }
  }, [existingRecord, clipDuration, videoModel, videoModelRef, segmentDuration, videoStyle, creativeBrief, storyboardModel, storyboardModelRef, knowledgeContextRefs, selectedAudioUrl, onComplete, onRecordsChange]);

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

          <CreativeBriefEditor
            value={creativeBrief}
            onChange={setCreativeBrief}
            workflow="mv"
            videoStyle={videoStyle}
            onVideoStyleChange={setVideoStyle}
          />

          {/* 视频模型 + 单段时长 */}
          {selectedClipId && (
            <VideoParametersRow
              selectedModel={videoModel}
              selectedSelectionKey={getSelectionKey(videoModel, videoModelRef)}
              onSelectModel={setVideoModel}
              models={videoModels}
              segmentDuration={segmentDuration}
              durationOptions={durationOptions}
              onSegmentDurationChange={setSegmentDuration}
            />
          )}

          <div className="ma-card mv-storyboard-control-card">
            {message && <div className="ma-progress mv-storyboard-message">{message}</div>}
            <div className="mv-storyboard-control-row">
              <div className="mv-storyboard-field mv-storyboard-field--knowledge">
                <label className="mv-storyboard-field-label">知识库上下文</label>
                <KnowledgeNoteContextSelector
                  value={knowledgeContextRefs}
                  onChange={setKnowledgeContextRefs}
                  disabled={submitting}
                  className="mv-knowledge-context-selector mv-knowledge-context-selector--inline"
                />
              </div>
              <div className="mv-storyboard-field mv-storyboard-field--model">
                <label className="mv-storyboard-field-label">AI 分镜模型</label>
                <ModelDropdown
                  models={storyboardModels}
                  selectedModel={storyboardModel}
                  selectedSelectionKey={getSelectionKey(storyboardModel, storyboardModelRef)}
                  onSelect={(id: string, ref?: ModelRef | null) => setStoryboardModel(id, ref)}
                  variant="form"
                  placement="auto"
                  disabled={submitting}
                />
              </div>
              <button
                className="va-analyze-btn va-analyze-btn--inline mv-storyboard-generate-btn"
                onClick={handleGenerateStoryboard}
                disabled={submitting}
              >
                {submitting ? '提交中...' : shots.length > 0 ? '重新生成分镜' : 'AI 生成分镜'}
              </button>
            </div>
          </div>
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
