/**
 * 分析页 - 视频输入 + AI 分析 + 结果摘要
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { AnalysisRecord, VideoAnalysisData, VideoShot } from '../types';
import { formatShotsMarkdown } from '../types';
import { videoAnalyzeTool } from '../../../mcp/tools/video-analyze';
import { quickInsert } from '../../../mcp/tools/canvas-insertion';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { useProviderProfiles } from '../../../hooks/use-provider-profiles';
import { useDrawnix } from '../../../hooks/use-drawnix';
import { ShotTimeline } from '../components/ShotTimeline';
import { ShotCard } from '../components/ShotCard';
import { updateRecord } from '../storage';
import { getSelectionKey } from '../../../utils/model-selection';
import {
  TUZI_MIX_PROVIDER_PROFILE_ID,
  type ModelRef,
} from '../../../utils/settings-manager';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../utils';
import { extractFramesFromVideo, cacheFrameBlob } from '../../../utils/video-frame-cache';
import { cacheVideoSource, restoreVideoFileFromSnapshot } from '../video-source-cache';
import { taskQueueService } from '../../../services/task-queue';
import { syncVideoAnalyzerTask } from '../task-sync';

type InputMode = 'upload' | 'youtube';

const DEFAULT_ANALYSIS_MODEL = 'gemini-3.1-pro-preview';
const STORAGE_KEY_MODEL = 'video-analyzer:model';
const SETTINGS_PROVIDER_NAV_EVENT = 'aitu:settings:provider-nav';

function formatSize(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

interface AnalyzePageProps {
  existingRecord?: AnalysisRecord | null;
  onComplete: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
  onCreateNew?: () => void;
  onNext?: () => void;
}

export const AnalyzePage: React.FC<AnalyzePageProps> = ({
  existingRecord,
  onComplete,
  onRecordsChange,
  onCreateNew,
  onNext,
}) => {
  const { setAppState } = useDrawnix();
  const [inputMode, setInputMode] = useState<InputMode>('upload');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModelState] = useState(
    () => existingRecord?.model || readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL).modelId
  );
  const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
    () => existingRecord?.modelRef || readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL).modelRef
  );
  const setSelectedModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setSelectedModelState(model);
    setSelectedModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_MODEL, model, modelRef);
  }, []);
  const [analyzing, setAnalyzing] = useState(false);
  const [pendingAnalyzeTaskId, setPendingAnalyzeTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<VideoAnalysisData | null>(
    existingRecord?.analysis || null
  );
  const providerProfiles = useProviderProfiles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  // 视频预览 URL
  const videoPreviewUrl = useMemo(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (!videoFile) { previewUrlRef.current = null; return null; }
    const url = URL.createObjectURL(videoFile);
    previewUrlRef.current = url;
    return url;
  }, [videoFile]);

  // 组件卸载时清理 URL
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    let disposed = false;

    const hydrateFromRecord = async () => {
      if (!existingRecord) {
        if (pendingAnalyzeTaskId) {
          return;
        }
        setAnalysis(null);
        setInputMode('upload');
        setYoutubeUrl('');
        setVideoFile(null);
        setError('');
        return;
      }

      setAnalysis(existingRecord.analysis || null);
      setSelectedModelState(existingRecord.model || DEFAULT_ANALYSIS_MODEL);
      setSelectedModelRef(existingRecord.modelRef || null);
      setError('');

      const snapshot = existingRecord.sourceSnapshot;
      if (snapshot?.type === 'upload') {
        setInputMode('upload');
        setYoutubeUrl('');
        const restoredFile = await restoreVideoFileFromSnapshot(snapshot);
        if (disposed) return;
        setVideoFile(restoredFile);
        if (!restoredFile) {
          setError('原上传视频缓存已失效，无法自动回填视频');
        }
        return;
      }

      if (existingRecord.source === 'upload') {
        setInputMode('upload');
        setYoutubeUrl('');
        setVideoFile(null);
        setError('这条旧历史未保存原视频，无法自动回填视频');
        return;
      }

      setInputMode('youtube');
      setVideoFile(null);
      if (snapshot?.type === 'youtube') {
        setYoutubeUrl(snapshot.youtubeUrl);
      } else if (existingRecord.source === 'youtube') {
        setYoutubeUrl(existingRecord.sourceLabel || '');
      } else {
        setYoutubeUrl('');
      }
    };

    void hydrateFromRecord();

    return () => {
      disposed = true;
    };
  }, [existingRecord]);
  const allTextModels = useSelectableModels('text');
  const videoAnalysisModels = useMemo(
    () => allTextModels.filter(m => /^gemini/i.test(m.id)),
    [allTextModels]
  );
  const isGeminiMixConfigured = useMemo(() => {
    const mixProfile = providerProfiles.find(
      profile => profile.id === TUZI_MIX_PROVIDER_PROFILE_ID
    );
    return Boolean(mixProfile?.apiKey.trim());
  }, [providerProfiles]);
  const isUsingGeminiMixModel =
    selectedModelRef?.profileId === TUZI_MIX_PROVIDER_PROFILE_ID;

  const handleOpenGeminiMixSettings = useCallback(() => {
    const intent = {
      action: 'select' as const,
      profileId: TUZI_MIX_PROVIDER_PROFILE_ID,
    };

    (
      window as typeof window & {
        __aituPendingProviderNavigationIntent?: typeof intent;
      }
    ).__aituPendingProviderNavigationIntent = intent;

    window.dispatchEvent(
      new CustomEvent(SETTINGS_PROVIDER_NAV_EVENT, { detail: intent })
    );
    setAppState(prev => ({ ...prev, openSettings: true }));
  }, [setAppState]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setVideoFile(file); setError(''); setAnalysis(null); }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) { setVideoFile(file); setError(''); setAnalysis(null); }
  }, []);

  const handleClearFile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoFile(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const [extractingFrames, setExtractingFrames] = useState(false);
  const [frameProgress, setFrameProgress] = useState('');

  /** 从本地视频提取帧图片并缓存 */
  const extractAndCacheFrames = useCallback(async (
    file: File,
    shots: VideoShot[],
  ): Promise<VideoShot[]> => {
    setExtractingFrames(true);
    setFrameProgress('提取帧图片...');
    try {
      const timestamps = shots.map(s => s.startTime);
      const blobs = await extractFramesFromVideo(
        file,
        timestamps,
        (cur, total) => setFrameProgress(`提取帧图片 ${cur}/${total}`)
      );

      // 缓存每个帧并更新 shot
      return await Promise.all(
        shots.map(async (shot, i) => {
          const blob = blobs[i];
          if (!blob) return shot;
          try {
            const url = await cacheFrameBlob(blob, shot.id, 'first');
            return { ...shot, generated_first_frame_url: url };
          } catch {
            return shot;
          }
        })
      );
    } catch (err) {
      console.debug('Frame extraction failed:', err);
      return shots;
    } finally {
      setExtractingFrames(false);
      setFrameProgress('');
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setError('');
    setProgress('准备中...');
    try {
      let params: Record<string, unknown> = {};
      if (inputMode === 'upload' && videoFile) {
        setProgress('缓存视频文件...');
        const sourceSnapshot = await cacheVideoSource(videoFile);
        params = {
          videoCacheUrl: sourceSnapshot.type === 'upload' ? sourceSnapshot.cacheUrl : undefined,
          ...(sourceSnapshot.type === 'upload' ? { mimeType: sourceSnapshot.mimeType } : {}),
          model: selectedModel,
          modelRef: selectedModelRef,
          taskLabel: `分析视频：${videoFile.name || '本地视频'}`,
          videoAnalyzerSource: 'upload',
          videoAnalyzerSourceLabel: videoFile.name || '本地视频',
          videoAnalyzerSourceSnapshot: sourceSnapshot,
        };
      } else if (inputMode === 'youtube' && youtubeUrl) {
        params = {
          youtubeUrl,
          model: selectedModel,
          modelRef: selectedModelRef,
          taskLabel: `分析视频：${youtubeUrl}`,
          videoAnalyzerSource: 'youtube',
          videoAnalyzerSourceLabel: youtubeUrl,
          videoAnalyzerSourceSnapshot: {
            type: 'youtube',
            youtubeUrl,
          },
        };
      } else {
        setError('请先选择视频文件或输入 YouTube URL');
        setAnalyzing(false);
        return;
      }

      setProgress('加入任务队列...');
      const result = await videoAnalyzeTool.execute(params, { mode: 'queue' });

      if (result.success && (result as { taskId?: string }).taskId) {
        setPendingAnalyzeTaskId((result as { taskId?: string }).taskId || null);
        setProgress('已加入任务队列，等待分析...');
      } else {
        setError(result.error || '创建分析任务失败');
      }
    } catch (err: any) {
      setError(err.message || '分析失败');
    } finally {
      setAnalyzing(false);
    }
  }, [inputMode, videoFile, youtubeUrl, selectedModel, selectedModelRef]);

  useEffect(() => {
    if (!pendingAnalyzeTaskId) {
      return;
    }

    const subscription = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (event.task.id !== pendingAnalyzeTaskId) {
        return;
      }

      if (event.task.status === 'failed') {
        setPendingAnalyzeTaskId(null);
        setProgress('');
        setError(event.task.error?.message || '分析失败');
        return;
      }

      if (event.task.status === 'completed') {
        void syncVideoAnalyzerTask(event.task).then(async synced => {
          if (!synced) {
            return;
          }

          onRecordsChange(synced.records);
          onComplete(synced.record);
          setAnalysis(synced.record.analysis);

          if (
            synced.record.source === 'upload' &&
            videoFile &&
            synced.record.analysis.shots.length > 0
          ) {
            const updatedShots = await extractAndCacheFrames(
              videoFile,
              synced.record.analysis.shots
            );
            setAnalysis(prev => (prev ? { ...prev, shots: updatedShots } : prev));
            const refreshed = await updateRecord(synced.record.id, {
              editedShots: updatedShots,
            });
            onRecordsChange(refreshed);
            onComplete({ ...synced.record, editedShots: updatedShots });
          }
        }).catch((err: any) => {
          setError(err.message || '分析结果同步失败');
        }).finally(() => {
          setPendingAnalyzeTaskId(null);
          setProgress('');
        });
        return;
      }

      if (typeof event.task.progress === 'number') {
        setProgress(`分析中 ${Math.round(event.task.progress)}%`);
      } else {
        setProgress('分析中，请耐心等待...');
      }
    });

    return () => subscription.unsubscribe();
  }, [pendingAnalyzeTaskId, onComplete, onRecordsChange, videoFile, extractAndCacheFrames]);

  const handleInsertAnalysis = useCallback(async () => {
    if (!analysis) return;
    await quickInsert('text', formatShotsMarkdown(analysis.shots, analysis));
  }, [analysis]);

  return (
    <div className="va-page">
      {/* 输入区（仅无分析结果时显示完整输入） */}
      {!analysis && (
        <>
          <div className="va-tabs">
            <button className={`va-tab ${inputMode === 'upload' ? 'active' : ''}`} onClick={() => setInputMode('upload')}>上传视频</button>
            <button className={`va-tab ${inputMode === 'youtube' ? 'active' : ''}`} onClick={() => setInputMode('youtube')}>YouTube URL</button>
          </div>
          {inputMode === 'upload' ? (
            videoFile ? (
              <div className="va-video-preview">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={videoPreviewUrl!} controls muted playsInline />
                <button className="va-video-preview-close" onClick={handleClearFile}>✕</button>
                <div className="va-video-preview-info">
                  <span className="va-video-preview-name">{videoFile.name}</span>
                  <span className="va-video-preview-size">{formatSize(videoFile.size)}</span>
                </div>
                <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} style={{ display: 'none' }} />
              </div>
            ) : (
              <div className="va-dropzone" onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} style={{ display: 'none' }} />
                <span className="va-placeholder">
                  拖拽视频到此处 或 点击上传
                  <br />
                  <span className="va-placeholder-hint">建议视频在6M以内，可用推特或Youtube下载器下载最低分辨率视频</span>
                </span>
              </div>
            )
          ) : (
            <input className="va-url-input" type="text" placeholder="https://www.youtube.com/watch?v=..." value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} />
          )}
          <div className="va-model-select">
            <label className="va-model-label">分析模型</label>
            <ModelDropdown
              variant="form"
              selectedModel={selectedModel}
              selectedSelectionKey={getSelectionKey(selectedModel, selectedModelRef)}
              onSelect={setSelectedModel}
              models={videoAnalysisModels}
              placement="down"
              disabled={analyzing}
              placeholder="选择多模态模型"
            />
          </div>
          {!isUsingGeminiMixModel && (
            <div className="va-model-tip">
              <span>建议使用 gemini-mix 分组的gemini-3.1-pro-preview</span>
              {!isGeminiMixConfigured && (
                <button
                  type="button"
                  className="va-model-tip-link"
                  onClick={handleOpenGeminiMixSettings}
                >
                  去设置
                </button>
              )}
            </div>
          )}
          <button
            className="va-analyze-btn"
            onClick={handleAnalyze}
            disabled={analyzing || !!pendingAnalyzeTaskId || (inputMode === 'upload' ? !videoFile : !youtubeUrl)}
          >
            {analyzing || pendingAnalyzeTaskId ? progress || '分析中...' : '开始分析'}
          </button>
          {error && <div className="va-error">{error}</div>}
        </>
      )}

      {/* 结果摘要 */}
      {analysis && (
        <div className="va-results">
          <div className="va-stats">
            <div className="va-stat"><span className="va-stat-value">{analysis.totalDuration}s</span><span className="va-stat-label">总时长</span></div>
            <div className="va-stat"><span className="va-stat-value">{analysis.shotCount}</span><span className="va-stat-label">镜头数</span></div>
            <div className="va-stat"><span className="va-stat-value">{analysis.productExposureRatio}%</span><span className="va-stat-label">产品占比</span></div>
            <div className="va-stat"><span className="va-stat-value">{analysis.aspect_ratio || '-'}</span><span className="va-stat-label">画面比例</span></div>
          </div>
          {(analysis.video_style || analysis.bgm_mood) && (
            <div className="va-style-info">
              {analysis.video_style && <span>风格: {analysis.video_style}</span>}
              {analysis.bgm_mood && <span>BGM: {analysis.bgm_mood}</span>}
            </div>
          )}
          <div className="va-suggestion">{analysis.suggestion}</div>
          <ShotTimeline shots={analysis.shots} totalDuration={analysis.totalDuration} />

          {/* 镜头列表（只读） */}
          <div className="va-shots">
            {analysis.shots.map((shot, i) => (
              <ShotCard key={shot.id} shot={shot} index={i} />
            ))}
          </div>

          <div className="va-page-actions">
            {extractingFrames && <span className="va-frame-progress">{frameProgress}</span>}
            <button onClick={handleInsertAnalysis}>插入画布</button>
            <button onClick={() => { setAnalysis(null); }}>重新分析</button>
            {onCreateNew && <button onClick={onCreateNew}>新建分析</button>}
            {onNext && <button className="va-btn-primary" onClick={onNext}>下一步: 编辑脚本 →</button>}
          </div>
        </div>
      )}
    </div>
  );
};
