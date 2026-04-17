import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreationMode, MusicAnalysisRecord } from '../types';
import { formatMusicAnalysisMarkdown } from '../types';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { taskQueueService } from '../../../services/task-queue';
import { quickInsert } from '../../../mcp/tools/canvas-insertion';
import { syncMusicAnalyzerTask } from '../task-sync';
import { TaskType } from '../../../types/task.types';
import { addRecord, updateRecord } from '../storage';
import {
  cacheAudioSource,
  restoreAudioFileFromSnapshot,
} from '../audio-source-cache';
import {
  buildLyricsRewritePrompt,
  collectLyricsDraftModels,
  isSunoLyricsModel,
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../utils';
import {
  DEFAULT_MUSIC_ANALYSIS_PROMPT,
  normalizeMusicAnalysisData,
} from '../../../services/music-analysis-service';
import { getDefaultAudioModel } from '../../../constants/model-config';

const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-pro';
const STORAGE_KEY_MODEL = 'music-analyzer:model';
const STORAGE_KEY_LYRICS_MODEL = 'music-analyzer:lyrics-model';
const STORAGE_KEY_CREATION_PROMPT = 'music-analyzer:creation-prompt';

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function readSessionPrompt(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY_CREATION_PROMPT) || '';
  } catch {
    return '';
  }
}

function writeSessionPrompt(value: string): void {
  try {
    if (value) {
      sessionStorage.setItem(STORAGE_KEY_CREATION_PROMPT, value);
      return;
    }
    sessionStorage.removeItem(STORAGE_KEY_CREATION_PROMPT);
  } catch {
    // noop
  }
}

interface CreatePageProps {
  existingRecord?: MusicAnalysisRecord | null;
  onComplete: (record: MusicAnalysisRecord) => void;
  onRecordsChange: (records: MusicAnalysisRecord[]) => void;
  onCreateNew?: () => void;
  onNext?: () => void;
  onLyricsReady?: () => void;
}

export const CreatePage: React.FC<CreatePageProps> = ({
  existingRecord,
  onComplete,
  onRecordsChange,
  onCreateNew,
  onNext,
  onLyricsReady,
}) => {
  const [mode, setMode] = useState<CreationMode>(
    existingRecord?.source === 'upload' ? 'reference' : 'scratch'
  );

  // ── scratch 模式状态 ──
  const [creationPrompt, setCreationPrompt] = useState(
    () => existingRecord?.creationPrompt || readSessionPrompt()
  );
  const [pendingLyricsGenTaskId, setPendingLyricsGenTaskId] = useState<string | null>(
    () => existingRecord?.pendingLyricsGenTaskId || null
  );
  const [lyricsGenProgress, setLyricsGenProgress] = useState('');

  // ── reference 模式状态 ──
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [pendingAnalyzeTaskId, setPendingAnalyzeTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [analysisSummaryOpen, setAnalysisSummaryOpen] = useState(true);
  const [analysisTitle, setAnalysisTitle] = useState('');
  const [analysisStyleTags, setAnalysisStyleTags] = useState('');
  const [analysisLyricsDraft, setAnalysisLyricsDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // ── 共享状态 ──
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModelState] = useState(
    () =>
      existingRecord?.analysisModel ||
      readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL).modelId
  );
  const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
    () =>
      existingRecord?.analysisModelRef ||
      readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL).modelRef
  );
  const [selectedLyricsModel, setSelectedLyricsModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_LYRICS_MODEL, getDefaultAudioModel()).modelId
  );
  const [selectedLyricsModelRef, setSelectedLyricsModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_LYRICS_MODEL, getDefaultAudioModel()).modelRef
  );

  const setSelectedModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setSelectedModelState(model);
    setSelectedModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_MODEL, model, modelRef);
  }, []);

  const setSelectedLyricsModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setSelectedLyricsModelState(model);
    setSelectedLyricsModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_LYRICS_MODEL, model, modelRef);
  }, []);

  const audioPreviewUrl = useMemo(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    if (!audioFile) {
      previewUrlRef.current = null;
      return null;
    }
    const url = URL.createObjectURL(audioFile);
    previewUrlRef.current = url;
    return url;
  }, [audioFile]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    []
  );

  // 回填已有 record
  useEffect(() => {
    let disposed = false;
    const hydrate = async () => {
      if (!existingRecord) {
        if (!pendingAnalyzeTaskId && !pendingLyricsGenTaskId) {
          setAudioFile(null);
          setError('');
        }
        return;
      }
      setSelectedModelState(existingRecord.analysisModel || DEFAULT_ANALYSIS_MODEL);
      setSelectedModelRef(existingRecord.analysisModelRef || null);
      setCreationPrompt(existingRecord.creationPrompt || '');
      const analysis = existingRecord.analysis
        ? normalizeMusicAnalysisData(existingRecord.analysis)
        : null;
      setAnalysisTitle(existingRecord.title || analysis?.sunoTitle || '');
      setAnalysisStyleTags(
        (existingRecord.styleTags || analysis?.sunoStyleTags || analysis?.genreTags || []).join(
          ', '
        )
      );
      setAnalysisLyricsDraft(
        existingRecord.lyricsDraft || analysis?.sunoLyricsDraft || ''
      );
      setError('');

      if (existingRecord.source === 'upload') {
        const restoredFile = await restoreAudioFileFromSnapshot(existingRecord.sourceSnapshot);
        if (disposed) return;
        setAudioFile(restoredFile);
        if (!restoredFile) {
          setError('原上传音频缓存已失效，无法自动回填音频');
        }
      }
    };
    void hydrate();
    return () => { disposed = true; };
  }, [existingRecord, pendingAnalyzeTaskId, pendingLyricsGenTaskId]);

  useEffect(() => {
    if (existingRecord?.source === 'scratch') {
      writeSessionPrompt(existingRecord.creationPrompt || '');
      return;
    }
    if (!existingRecord) {
      writeSessionPrompt(creationPrompt);
    }
  }, [creationPrompt, existingRecord]);

  useEffect(() => {
    if (!existingRecord || mode !== 'reference') {
      return;
    }

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const styleTags = analysisStyleTags
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const updated = await updateRecord(existingRecord.id, {
        title: analysisTitle.trim(),
        styleTags,
        lyricsDraft: analysisLyricsDraft,
      });
      onRecordsChange(updated);
      const nextRecord = updated.find((item) => item.id === existingRecord.id);
      if (nextRecord) {
        onComplete(nextRecord);
      }
    }, 400);

    return () => clearTimeout(saveTimerRef.current);
  }, [
    analysisLyricsDraft,
    analysisStyleTags,
    analysisTitle,
    existingRecord,
    mode,
    onComplete,
    onRecordsChange,
  ]);

  const allTextModels = useSelectableModels('text');
  const analysisModels = useMemo(
    () => allTextModels.filter((item) => /^gemini/i.test(item.id)),
    [allTextModels]
  );
  const audioModels = useSelectableModels('audio');
  const lyricsDraftModels = useMemo(
    () => collectLyricsDraftModels(allTextModels, audioModels),
    [allTextModels, audioModels]
  );
  const normalizedAnalysis = useMemo(
    () =>
      existingRecord?.analysis ? normalizeMusicAnalysisData(existingRecord.analysis) : null,
    [existingRecord?.analysis]
  );

  // ── reference 模式：文件选择 ──
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file?.type.startsWith('audio/')) {
      setAudioFile(file);
      setError('');
    } else {
      setError('请选择音频文件');
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file?.type.startsWith('audio/')) {
      setAudioFile(file);
      setError('');
    } else {
      setError('请选择音频文件');
    }
  }, []);

  // ── reference 模式：分析 ──
  const handleAnalyze = useCallback(async () => {
    if (!audioFile) {
      setError('请先上传音频');
      return;
    }
    setError('');
    setProgress('缓存音频...');
    try {
      const sourceSnapshot = await cacheAudioSource(audioFile);
      const task = taskQueueService.createTask(
        {
          prompt: `分析音频：${audioFile.name || '本地音频'}`,
          model: selectedModel,
          modelRef: selectedModelRef,
          mimeType: sourceSnapshot.mimeType,
          audioCacheUrl: sourceSnapshot.cacheUrl,
          musicAnalyzerAction: 'analyze',
          musicAnalyzerPrompt: DEFAULT_MUSIC_ANALYSIS_PROMPT,
          musicAnalyzerSource: 'upload',
          musicAnalyzerSourceLabel: sourceSnapshot.fileName,
          musicAnalyzerSourceSnapshot: sourceSnapshot,
          autoInsertToCanvas: false,
        },
        TaskType.CHAT
      );
      setPendingAnalyzeTaskId(task.id);
      setProgress('音频分析中 0%');
    } catch (taskError: any) {
      setError(taskError.message || '音频分析失败');
    }
  }, [audioFile, selectedModel, selectedModelRef]);

  // ── scratch 模式：Suno 歌词生成 ──
  const handleGenerateLyrics = useCallback(async () => {
    if (!creationPrompt.trim()) {
      setError('请先描述你想创作的歌曲');
      return;
    }
    const useSunoLyricsModel = isSunoLyricsModel(selectedLyricsModel);
    setError('');
    setLyricsGenProgress(useSunoLyricsModel ? '歌词生成中...' : '歌词草稿生成中 0%');
    try {
      // 先创建 record
      const record: MusicAnalysisRecord = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        source: 'scratch',
        sourceLabel: creationPrompt.slice(0, 30) || '从零创作',
        creationPrompt,
        starred: false,
      };

      const task = useSunoLyricsModel
        ? taskQueueService.createTask(
            {
              prompt: creationPrompt,
              model: selectedLyricsModel,
              modelRef: selectedLyricsModelRef,
              sunoAction: 'lyrics',
              musicAnalyzerAction: 'lyrics-gen',
              musicAnalyzerRecordId: record.id,
              autoInsertToCanvas: false,
            },
            TaskType.AUDIO
          )
        : taskQueueService.createTask(
            {
              prompt: `从零创作歌词：${record.sourceLabel}`,
              model: selectedLyricsModel,
              modelRef: selectedLyricsModelRef,
              musicAnalyzerAction: 'lyrics-gen',
              musicAnalyzerPrompt: buildLyricsRewritePrompt({
                userPrompt: creationPrompt,
                mode: 'create',
              }),
              musicAnalyzerRecordId: record.id,
              autoInsertToCanvas: false,
            },
            TaskType.CHAT
          );

      record.pendingLyricsGenTaskId = task.id;
      const nextRecords = await addRecord(record);
      onRecordsChange(nextRecords);
      onComplete(record);
      setPendingLyricsGenTaskId(task.id);
    } catch (taskError: any) {
      setError(taskError.message || '歌词生成失败');
      setLyricsGenProgress('');
    }
  }, [
    creationPrompt,
    onComplete,
    onRecordsChange,
    selectedLyricsModel,
    selectedLyricsModelRef,
  ]);

  // ── 监听分析任务 ──
  useEffect(() => {
    if (!pendingAnalyzeTaskId) return;
    const currentTask = taskQueueService.getTask(pendingAnalyzeTaskId);
    if (typeof currentTask?.progress === 'number') {
      setProgress(`音频分析中 ${Math.round(currentTask.progress)}%`);
    }
    const subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      if (event.task.id !== pendingAnalyzeTaskId) return;
      if (event.task.status === 'failed') {
        setPendingAnalyzeTaskId(null);
        setProgress('');
        setError(event.task.error?.message || '音频分析失败');
        return;
      }
      if (event.task.status === 'completed') {
        void syncMusicAnalyzerTask(event.task)
          .then((synced) => {
            if (!synced) return;
            onRecordsChange(synced.records);
            onComplete(synced.record);
          })
          .catch((e: any) => setError(e.message || '分析结果同步失败'))
          .finally(() => { setPendingAnalyzeTaskId(null); setProgress(''); });
        return;
      }
      if (typeof event.task.progress === 'number') {
        setProgress(`音频分析中 ${Math.round(event.task.progress)}%`);
      }
    });
    return () => subscription.unsubscribe();
  }, [pendingAnalyzeTaskId, onComplete, onRecordsChange]);

  // ── 监听歌词生成任务 ──
  useEffect(() => {
    if (!pendingLyricsGenTaskId) return;
    const currentTask = taskQueueService.getTask(pendingLyricsGenTaskId);
    if (typeof currentTask?.progress === 'number') {
      const label = currentTask.type === TaskType.CHAT ? '歌词草稿生成中' : '歌词生成中';
      setLyricsGenProgress(`${label} ${Math.round(currentTask.progress)}%`);
    }
    const subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      if (event.task.id !== pendingLyricsGenTaskId) return;
      if (event.task.status === 'failed') {
        const recordId = String(
          (event.task.params as { musicAnalyzerRecordId?: unknown }).musicAnalyzerRecordId || ''
        ).trim();
        setPendingLyricsGenTaskId(null);
        setLyricsGenProgress('');
        setError(event.task.error?.message || '歌词生成失败');
        if (recordId) {
          void updateRecord(recordId, { pendingLyricsGenTaskId: null }).then(onRecordsChange);
        }
        return;
      }
      if (event.task.status === 'completed') {
        setPendingLyricsGenTaskId(null);
        setLyricsGenProgress('');
        // task-sync 会处理回填，完成后跳转歌词页
        onLyricsReady?.();
        return;
      }
      if (typeof event.task.progress === 'number') {
        const label = event.task.type === TaskType.CHAT ? '歌词草稿生成中' : '歌词生成中';
        setLyricsGenProgress(`${label} ${Math.round(event.task.progress)}%`);
      }
    });
    return () => subscription.unsubscribe();
  }, [onLyricsReady, onRecordsChange, pendingLyricsGenTaskId]);

  const handleInsertAnalysis = useCallback(async () => {
    if (!normalizedAnalysis) return;
    await quickInsert('text', formatMusicAnalysisMarkdown(normalizedAnalysis));
  }, [normalizedAnalysis]);

  return (
    <div className="ma-create-page">
      {/* 模式切换 - 固定在顶部 */}
      <div className="ma-mode-toggle">
        <button
          className={`ma-mode-btn ${mode === 'scratch' ? 'active' : ''}`}
          onClick={() => setMode('scratch')}
        >
          从零创作
        </button>
        <button
          className={`ma-mode-btn ${mode === 'reference' ? 'active' : ''}`}
          onClick={() => setMode('reference')}
        >
          参考音频
        </button>
      </div>

      <div className="va-page">

      {mode === 'scratch' ? (
        <>
          <div className="ma-card">
            <div className="ma-card-header">
              <span>歌词草稿模型</span>
              <span className="ma-muted">文本模型会补齐 Suno 所需标题/标签/歌词</span>
            </div>
            <ModelDropdown
              selectedModel={selectedLyricsModel}
              selectedSelectionKey={getSelectionKey(selectedLyricsModel, selectedLyricsModelRef)}
              onSelect={setSelectedLyricsModel}
              models={lyricsDraftModels}
              variant="form"
              placement="down"
              placeholder="选择歌词草稿模型"
            />
          </div>

          <div className="ma-card">
            <div className="ma-card-header">
              <span>描述你想创作的歌曲</span>
            </div>
            <textarea
              className="ma-textarea"
              value={creationPrompt}
              onChange={(e) => setCreationPrompt(e.target.value)}
              rows={6}
              placeholder="例如：一首关于夏天海边的轻快流行歌，女声，带有吉他和电子节拍"
            />
          </div>
        </>
      ) : (
        <>
          <div className="ma-card">
            <div className="ma-card-header">
              <span>上传音频</span>
              {audioFile && <span className="ma-muted">{formatSize(audioFile.size)}</span>}
            </div>
            <div
              className="va-dropzone ma-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              {audioFile ? (
                <div className="ma-audio-preview">
                  <div className="ma-audio-preview__meta">
                    <strong>{audioFile.name}</strong>
                    <button
                      className="va-nav-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAudioFile(null);
                        setError('');
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      清空
                    </button>
                  </div>
                  {audioPreviewUrl && <audio controls src={audioPreviewUrl} />}
                </div>
              ) : (
                <div className="ma-dropzone__placeholder">
                  <span>点击或拖拽上传本地音频</span>
                  <small>支持 mp3、wav、m4a 等常见格式</small>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={handleFileSelect}
            />
          </div>

          <div className="ma-card">
            <div className="ma-card-header">
              <span>分析模型</span>
            </div>
            <ModelDropdown
              selectedModel={selectedModel}
              selectedSelectionKey={getSelectionKey(selectedModel, selectedModelRef)}
              onSelect={setSelectedModel}
              models={analysisModels}
              variant="form"
              placement="down"
              placeholder="选择 Gemini 分析模型"
            />
          </div>
        </>
      )}

      {/* 分析摘要（reference 模式已有 record 时） */}
      {normalizedAnalysis && mode === 'reference' && (
        <div className="ma-card">
          <button
            className="ma-section-toggle"
            onClick={() => setAnalysisSummaryOpen((v) => !v)}
          >
            <span>分析摘要</span>
            <span>{analysisSummaryOpen ? '收起' : '展开'}</span>
          </button>
          {analysisSummaryOpen && (
            <div className="ma-analysis-summary">
              <p>{normalizedAnalysis.summary}</p>
              <div className="ma-chip-row">
                <span className="ma-chip">{normalizedAnalysis.language || '未知语言'}</span>
                <span className="ma-chip">{normalizedAnalysis.mood || '未知情绪'}</span>
                {normalizedAnalysis.genreTags.map((tag) => (
                  <span key={tag} className="ma-chip ma-chip--accent">{tag}</span>
                ))}
              </div>
              <div className="ma-tag-row">
                {normalizedAnalysis.structure.map((tag) => (
                  <code key={tag}>{tag}</code>
                ))}
              </div>
              {normalizedAnalysis.titleSuggestions.length > 0 && (
                <div className="ma-suggestions">
                  推荐标题：{normalizedAnalysis.titleSuggestions.join(' / ')}
                </div>
              )}
              {(normalizedAnalysis.sunoTitle ||
                normalizedAnalysis.sunoStyleTags.length > 0 ||
                normalizedAnalysis.sunoLyricsDraft) && (
                <div className="ma-suno-summary">
                  <div className="ma-suno-summary__title">Suno 生成草稿</div>
                  <div className="ma-suno-summary__form">
                    <label className="ma-suno-summary__field">
                      <span>歌曲标题</span>
                      <input
                        className="ma-input"
                        value={analysisTitle}
                        onChange={(event) => setAnalysisTitle(event.target.value)}
                        placeholder="可直接用于 Suno 的标题"
                      />
                    </label>
                    <label className="ma-suno-summary__field">
                      <span>Suno 风格标签</span>
                      <input
                        className="ma-input"
                        value={analysisStyleTags}
                        onChange={(event) => setAnalysisStyleTags(event.target.value)}
                        placeholder="逗号分隔的风格标签"
                      />
                    </label>
                    <label className="ma-suno-summary__field">
                      <span>带 Suno 标签的歌词草稿</span>
                      <textarea
                        className="ma-textarea"
                        rows={12}
                        value={analysisLyricsDraft}
                        onChange={(event) => setAnalysisLyricsDraft(event.target.value)}
                        placeholder="分析阶段整理出的可用歌词草稿"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(error || progress || lyricsGenProgress) && (
        <div className="ma-status-stack">
          {error && <div className="ma-error">{error}</div>}
          {progress && <div className="ma-progress">{progress}</div>}
          {lyricsGenProgress && <div className="ma-progress">{lyricsGenProgress}</div>}
        </div>
      )}

      <div className="va-page-actions">
        {mode === 'scratch' ? (
          <button
            className="va-btn-primary"
            onClick={handleGenerateLyrics}
            disabled={!creationPrompt.trim() || !!pendingLyricsGenTaskId}
          >
            生成歌词
          </button>
        ) : (
          <>
            <button onClick={onCreateNew}>新建</button>
            <button onClick={handleInsertAnalysis} disabled={!existingRecord?.analysis}>
              插入分析
            </button>
            <button
              className="va-btn-primary"
              onClick={handleAnalyze}
              disabled={!audioFile || !!pendingAnalyzeTaskId}
            >
              开始分析
            </button>
            <button onClick={onNext} disabled={!existingRecord}>
              下一步
            </button>
          </>
        )}
      </div>
      </div>
    </div>
  );
};
