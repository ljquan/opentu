/**
 * 分析页 - 视频输入 + AI 分析 + 结果摘要
 */

import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from 'react';
import type { AnalysisRecord, VideoAnalysisData, VideoShot } from '../types';
import type { KnowledgeContextRef } from '../../../types/task.types';
import { formatShotsMarkdown } from '../types';
import { videoAnalyzeTool } from '../../../mcp/tools/video-analyze';
import { quickInsert } from '../../../mcp/tools/canvas-insertion';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { KnowledgeNoteContextSelector } from '../../shared';
import {
  CreativeBriefEditor,
  VideoParametersRow,
  normalizeCreativeBrief,
  type CreativeBrief,
} from '../../shared/workflow';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { useProviderProfiles } from '../../../hooks/use-provider-profiles';
import { useDrawnix } from '../../../hooks/use-drawnix';
import { ShotTimeline } from '../components/ShotTimeline';
import { ShotCard } from '../components/ShotCard';
import { updateRecord } from '../storage';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
} from '../../../utils/model-selection';
import { ModelVendor, type ModelConfig } from '../../../constants/model-config';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import {
  TUZI_MIX_PROVIDER_PROFILE_ID,
  type ModelRef,
} from '../../../utils/settings-manager';
import {
  buildVideoPromptGenerationPrompt,
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../utils';
import { generateUUID } from '../../../utils/runtime-helpers';
import { unifiedCacheService } from '../../../services/unified-cache-service';
import {
  extractFramesFromVideo,
  cacheFrameBlob,
} from '../../../utils/video-frame-cache';
import {
  cacheVideoSource,
  restoreVideoFileFromSnapshot,
} from '../video-source-cache';
import { taskQueueService } from '../../../services/task-queue';
import { syncVideoAnalyzerTask } from '../task-sync';
import { analytics } from '../../../utils/posthog-analytics';
import { MessagePlugin } from '../../../utils/message-plugin';

type InputMode = 'prompt' | 'upload' | 'youtube';

interface PromptPdfAttachment {
  cacheUrl: string;
  name: string;
  size: number;
  mimeType: string;
}

const DEFAULT_ANALYSIS_MODEL = 'gemini-3.1-pro-preview';
const STORAGE_KEY_MODEL = 'video-analyzer:model';
const STORAGE_KEY_VIDEO_MODEL = 'video-analyzer:video-model';
const DEFAULT_VIDEO_MODEL = 'veo3';
const DEFAULT_PROMPT_TARGET_DURATION = 30;
const SETTINGS_PROVIDER_NAV_EVENT = 'aitu:settings:provider-nav';
const MAX_PROMPT_PDF_SIZE = 20 * 1024 * 1024;

function formatSize(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function isGeminiTextModel(model: ModelConfig): boolean {
  const value = `${model.id} ${model.label} ${model.shortLabel || ''} ${
    model.sourceProfileName || ''
  }`.toLowerCase();
  return (
    model.vendor === ModelVendor.GEMINI ||
    model.vendor === ModelVendor.GOOGLE ||
    value.includes('gemini')
  );
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
  const [inputMode, setInputMode] = useState<InputMode>('prompt');
  const [promptText, setPromptText] = useState('');
  const [videoStyle, setVideoStyle] = useState(
    () =>
      existingRecord?.productInfo?.videoStyle ||
      existingRecord?.analysis.video_style ||
      ''
  );
  const [targetDuration, setTargetDuration] = useState<number>(
    () =>
      existingRecord?.productInfo?.targetDuration ||
      existingRecord?.analysis.totalDuration ||
      DEFAULT_PROMPT_TARGET_DURATION
  );
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>({});
  const [knowledgeContextRefs, setKnowledgeContextRefs] = useState<
    KnowledgeContextRef[]
  >([]);
  const [pdfAttachment, setPdfAttachment] =
    useState<PromptPdfAttachment | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModelState] = useState(
    () =>
      existingRecord?.model ||
      readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL)
        .modelId
  );
  const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
    () =>
      existingRecord?.modelRef ||
      readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL)
        .modelRef
  );
  const setSelectedModel = useCallback(
    (model: string, modelRef?: ModelRef | null) => {
      setSelectedModelState(model);
      setSelectedModelRef(modelRef || null);
      writeStoredModelSelection(STORAGE_KEY_MODEL, model, modelRef);
    },
    []
  );
  const videoModels = useSelectableModels('video');
  const [videoModel, setVideoModelState] = useState(
    () =>
      existingRecord?.productInfo?.videoModel ||
      readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, DEFAULT_VIDEO_MODEL)
        .modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () =>
      existingRecord?.productInfo?.videoModelRef ||
      readStoredModelSelection(
        STORAGE_KEY_VIDEO_MODEL,
        existingRecord?.productInfo?.videoModel || DEFAULT_VIDEO_MODEL
      ).modelRef
  );
  const videoConfig = useMemo(
    () => getVideoModelConfig(videoModel),
    [videoModel]
  );
  const [segmentDuration, setSegmentDuration] = useState<number>(() => {
    const initialModel =
      existingRecord?.productInfo?.videoModel ||
      readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, DEFAULT_VIDEO_MODEL)
        .modelId;
    const cfg = getVideoModelConfig(initialModel);
    return (
      existingRecord?.productInfo?.segmentDuration ||
      parseInt(cfg.defaultDuration, 10) ||
      8
    );
  });
  const durationOptions = useMemo(
    () =>
      (videoConfig.durationOptions || []).map((option) => ({
        value: parseInt(option.value, 10),
        label: option.label,
      })),
    [videoConfig]
  );
  const setVideoModel = useCallback(
    (model: string, modelRef?: ModelRef | null) => {
      setVideoModelState(model);
      setVideoModelRef(modelRef || null);
      writeStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, model, modelRef);
      const cfg = getVideoModelConfig(model);
      setSegmentDuration(parseInt(cfg.defaultDuration, 10) || 8);
    },
    []
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [pendingAnalyzeTaskId, setPendingAnalyzeTaskId] = useState<
    string | null
  >(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<VideoAnalysisData | null>(
    existingRecord?.analysis || null
  );
  const providerProfiles = useProviderProfiles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const analyzingRef = useRef(false);

  // 视频预览 URL
  const videoPreviewUrl = useMemo(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (!videoFile) {
      previewUrlRef.current = null;
      return null;
    }
    const url = URL.createObjectURL(videoFile);
    previewUrlRef.current = url;
    return url;
  }, [videoFile]);

  // 组件卸载时清理 URL
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  useEffect(() => {
    let disposed = false;

    const hydrateFromRecord = async () => {
      if (!existingRecord) {
        if (pendingAnalyzeTaskId) {
          return;
        }
        setAnalysis(null);
        setInputMode('prompt');
        setPromptText('');
        setVideoStyle('');
        setTargetDuration(DEFAULT_PROMPT_TARGET_DURATION);
        setCreativeBrief({});
        setPdfAttachment(null);
        setYoutubeUrl('');
        setVideoFile(null);
        setError('');
        return;
      }

      setAnalysis(existingRecord.analysis || null);
      setSelectedModelState(existingRecord.model || DEFAULT_ANALYSIS_MODEL);
      setSelectedModelRef(existingRecord.modelRef || null);
      setError('');
      setVideoStyle(
        existingRecord.productInfo?.videoStyle ||
          existingRecord.analysis.video_style ||
          ''
      );
      setTargetDuration(
        existingRecord.productInfo?.targetDuration ||
          existingRecord.analysis.totalDuration ||
          DEFAULT_PROMPT_TARGET_DURATION
      );
      if (existingRecord.productInfo?.videoModel) {
        setVideoModelState(existingRecord.productInfo.videoModel);
        setVideoModelRef(existingRecord.productInfo.videoModelRef || null);
        const cfg = getVideoModelConfig(existingRecord.productInfo.videoModel);
        setSegmentDuration(
          existingRecord.productInfo.segmentDuration ||
            parseInt(cfg.defaultDuration, 10) ||
            8
        );
      }

      const snapshot = existingRecord.sourceSnapshot;
      if (snapshot?.type === 'prompt') {
        setInputMode('prompt');
        setPromptText(snapshot.prompt || existingRecord.sourceLabel || '');
        setCreativeBrief(
          normalizeCreativeBrief(existingRecord.productInfo?.creativeBrief)
        );
        setYoutubeUrl('');
        setVideoFile(null);
        setPdfAttachment(
          snapshot.pdfCacheUrl
            ? {
                cacheUrl: snapshot.pdfCacheUrl,
                name: snapshot.pdfName || '参考资料.pdf',
                size: snapshot.pdfSize || 0,
                mimeType: snapshot.pdfMimeType || 'application/pdf',
              }
            : null
        );
        return;
      }

      if (snapshot?.type === 'upload') {
        setInputMode('upload');
        setPromptText('');
        setCreativeBrief({});
        setPdfAttachment(null);
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
        setPromptText('');
        setCreativeBrief({});
        setPdfAttachment(null);
        setYoutubeUrl('');
        setVideoFile(null);
        setError('这条旧历史未保存原视频，无法自动回填视频');
        return;
      }

      setInputMode('youtube');
      setPromptText('');
      setCreativeBrief({});
      setPdfAttachment(null);
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
  const geminiTextModels = useMemo(
    () => allTextModels.filter(isGeminiTextModel),
    [allTextModels]
  );
  const isGeminiRequiredForAnalysis =
    inputMode !== 'prompt' || Boolean(pdfAttachment);
  const selectableAnalysisModels = useMemo(
    () => (isGeminiRequiredForAnalysis ? geminiTextModels : allTextModels),
    [allTextModels, geminiTextModels, isGeminiRequiredForAnalysis]
  );
  const isGeminiMixConfigured = useMemo(() => {
    const mixProfile = providerProfiles.find(
      (profile) => profile.id === TUZI_MIX_PROVIDER_PROFILE_ID
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
    setAppState((prev) => ({ ...prev, openSettings: true }));
  }, [setAppState]);

  useEffect(() => {
    if (selectableAnalysisModels.length === 0) return;
    const currentModel = findMatchingSelectableModel(
      selectableAnalysisModels,
      selectedModel,
      selectedModelRef
    );
    if (currentModel) return;

    const nextModel = selectableAnalysisModels[0];
    setSelectedModel(nextModel.id, getModelRefFromConfig(nextModel));
  }, [
    selectableAnalysisModels,
    selectedModel,
    selectedModelRef,
    setSelectedModel,
  ]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setVideoFile(file);
        setError('');
        setAnalysis(null);
      }
    },
    []
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) {
      setVideoFile(file);
      setError('');
      setAnalysis(null);
    }
  }, []);

  const handleClearFile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoFile(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const clearPdfAttachment = useCallback(() => {
    const shouldDeleteCache = !pendingAnalyzeTaskId;
    setPdfAttachment((prev) => {
      if (shouldDeleteCache && prev?.cacheUrl) {
        void unifiedCacheService
          .deleteCache(prev.cacheUrl)
          .catch(() => undefined);
      }
      return null;
    });
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  }, [pendingAnalyzeTaskId]);

  const handlePdfFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const isPdf =
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        MessagePlugin.warning('请上传 PDF 文件');
        return;
      }
      if (file.size > MAX_PROMPT_PDF_SIZE) {
        MessagePlugin.warning('PDF 不能超过 20MB');
        return;
      }
      if (geminiTextModels.length === 0) {
        MessagePlugin.warning('PDF 入参需要 Gemini 文本模型，请先配置 Gemini 模型');
        return;
      }

      try {
        const cacheUrl = `video-prompt-pdf-${generateUUID()}.pdf`;
        await unifiedCacheService.cacheToCacheStorageOnly(cacheUrl, file);
        setPdfAttachment((prev) => {
          if (!pendingAnalyzeTaskId && prev?.cacheUrl) {
            void unifiedCacheService
              .deleteCache(prev.cacheUrl)
              .catch(() => undefined);
          }
          return {
            cacheUrl,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/pdf',
          };
        });
        MessagePlugin.success('PDF 已添加，将作为提示词上下文提交给 Gemini');
      } catch (error) {
        MessagePlugin.error(
          error instanceof Error ? error.message : 'PDF 上传失败'
        );
      }
    },
    [geminiTextModels.length, pendingAnalyzeTaskId]
  );

  const [extractingFrames, setExtractingFrames] = useState(false);
  const [frameProgress, setFrameProgress] = useState('');

  /** 从本地视频提取帧图片并缓存 */
  const extractAndCacheFrames = useCallback(
    async (file: File, shots: VideoShot[]): Promise<VideoShot[]> => {
      setExtractingFrames(true);
      setFrameProgress('提取帧图片...');
      try {
        const timestamps = shots.map((s) => s.startTime);
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
        return shots;
      } finally {
        setExtractingFrames(false);
        setFrameProgress('');
      }
    },
    []
  );

  const handleAnalyze = useCallback(async () => {
    if (analyzingRef.current || pendingAnalyzeTaskId) {
      return;
    }
    analyzingRef.current = true;
    setAnalyzing(true);
    setError('');
    setProgress('准备中...');
    try {
      let params: Record<string, unknown> = {};
      if (inputMode === 'prompt') {
        const sourcePrompt = promptText.trim();
        if (!sourcePrompt) {
          setError('请输入提示词');
          analyzingRef.current = false;
          setAnalyzing(false);
          return;
        }
        if (
          pdfAttachment &&
          !findMatchingSelectableModel(
            geminiTextModels,
            selectedModel,
            selectedModelRef
          )
        ) {
          const nextModel = geminiTextModels[0];
          if (nextModel) {
            setSelectedModel(nextModel.id, getModelRefFromConfig(nextModel));
          }
          MessagePlugin.warning('PDF 入参仅支持 Gemini 文本模型');
          analyzingRef.current = false;
          setAnalyzing(false);
          setProgress('');
          return;
        }
        const normalizedCreativeBrief = normalizeCreativeBrief(creativeBrief);
        const prompt = buildVideoPromptGenerationPrompt({
          userPrompt: sourcePrompt,
          pdfAttachmentName: pdfAttachment?.name,
          creativeBrief: normalizedCreativeBrief,
          videoStyle,
          videoModel,
          segmentDuration,
          targetDuration,
        });
        params = {
          prompt,
          model: selectedModel,
          modelRef: selectedModelRef,
          taskLabel: `提示词生成：${sourcePrompt.slice(0, 32)}`,
          videoAnalyzerAction: 'prompt-generate',
          videoAnalyzerSource: 'prompt',
          videoAnalyzerSourceLabel: sourcePrompt.slice(0, 80),
          videoAnalyzerUserPrompt: sourcePrompt,
          videoAnalyzerSourceSnapshot: {
            type: 'prompt',
            prompt: sourcePrompt,
            ...(pdfAttachment
              ? {
                  pdfCacheUrl: pdfAttachment.cacheUrl,
                  pdfName: pdfAttachment.name,
                  pdfMimeType: pdfAttachment.mimeType,
                  pdfSize: pdfAttachment.size,
                }
              : {}),
          },
          videoAnalyzerProductInfo: {
            prompt: sourcePrompt,
            videoModel,
            videoModelRef,
            targetDuration,
            segmentDuration,
            videoStyle,
            creativeBrief: normalizedCreativeBrief,
          },
          knowledgeContextRefs,
          ...(pdfAttachment
            ? {
                pdfCacheUrl: pdfAttachment.cacheUrl,
                pdfMimeType: pdfAttachment.mimeType,
                pdfName: pdfAttachment.name,
              }
            : {}),
        };
      } else if (inputMode === 'upload' && videoFile) {
        setProgress('缓存视频文件...');
        const sourceSnapshot = await cacheVideoSource(videoFile);
        params = {
          videoCacheUrl:
            sourceSnapshot.type === 'upload'
              ? sourceSnapshot.cacheUrl
              : undefined,
          ...(sourceSnapshot.type === 'upload'
            ? { mimeType: sourceSnapshot.mimeType }
            : {}),
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
        setError('请先输入提示词、选择视频文件或输入 YouTube URL');
        analyzingRef.current = false;
        setAnalyzing(false);
        return;
      }

      analytics.trackUIInteraction({
        area: 'popular_video_tool',
        action: 'video_analysis_started',
        control: 'analyze_video',
        source: 'video_analyzer_analyze_page',
        metadata: {
          inputMode,
          hasPrompt: !!promptText.trim(),
          hasPdfAttachment: !!pdfAttachment,
          hasUpload: !!videoFile,
          hasYoutubeUrl: !!youtubeUrl,
          fileSizeBytes: videoFile?.size,
          hasModelRef: !!selectedModelRef,
        },
      });

      setProgress('加入任务队列...');
      const result = await videoAnalyzeTool.execute(params, { mode: 'queue' });

      if (result.success && (result as { taskId?: string }).taskId) {
        setPendingAnalyzeTaskId((result as { taskId?: string }).taskId || null);
        setProgress('已加入任务队列，等待分析...');
      } else {
        analyzingRef.current = false;
        setError(result.error || '创建分析任务失败');
      }
    } catch (err: any) {
      analyzingRef.current = false;
      setError(err.message || '分析失败');
    } finally {
      setAnalyzing(false);
    }
  }, [
    inputMode,
    videoFile,
    youtubeUrl,
    promptText,
    videoStyle,
    videoModel,
    videoModelRef,
    targetDuration,
    segmentDuration,
    creativeBrief,
    knowledgeContextRefs,
    pdfAttachment,
    pendingAnalyzeTaskId,
    selectedModel,
    selectedModelRef,
    geminiTextModels,
    setSelectedModel,
  ]);

  useEffect(() => {
    if (!pendingAnalyzeTaskId) {
      return;
    }

    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.task.id !== pendingAnalyzeTaskId) {
          return;
        }

        if (event.task.status === 'failed') {
          analyzingRef.current = false;
          setPendingAnalyzeTaskId(null);
          setProgress('');
          setError(event.task.error?.message || '分析失败');
          return;
        }

        if (event.task.status === 'completed') {
          void syncVideoAnalyzerTask(event.task)
            .then(async (synced) => {
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
                setAnalysis((prev) =>
                  prev ? { ...prev, shots: updatedShots } : prev
                );
                const refreshed = await updateRecord(synced.record.id, {
                  editedShots: updatedShots,
                });
                onRecordsChange(refreshed);
                onComplete({ ...synced.record, editedShots: updatedShots });
              }
            })
            .catch((err: any) => {
              setError(err.message || '分析结果同步失败');
            })
            .finally(() => {
              analyzingRef.current = false;
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
  }, [
    pendingAnalyzeTaskId,
    onComplete,
    onRecordsChange,
    videoFile,
    extractAndCacheFrames,
  ]);

  const handleInsertAnalysis = useCallback(async () => {
    if (!analysis) return;
    const sourcePrompt =
      promptText.trim() ||
      (existingRecord?.sourceSnapshot?.type === 'prompt'
        ? existingRecord.sourceSnapshot.prompt
        : existingRecord?.sourceLabel || '');
    await quickInsert(
      'text',
      formatShotsMarkdown(analysis.shots, analysis),
      undefined,
      undefined,
      sourcePrompt.trim() ? { prompt: sourcePrompt.trim() } : undefined
    );
    analytics.trackUIInteraction({
      area: 'popular_video_tool',
      action: 'analysis_inserted_to_canvas',
      control: 'insert_analysis',
      source: 'video_analyzer_analyze_page',
      metadata: {
        shotCount: analysis.shots.length,
        productExposureRatio: analysis.productExposureRatio,
        characterCount: analysis.characters?.length || 0,
      },
    });
  }, [analysis, existingRecord, promptText]);

  return (
    <div className="va-page">
      {/* 输入区（仅无分析结果时显示完整输入） */}
      {!analysis && (
        <>
          <div className="va-tabs">
            <button
              className={`va-tab ${inputMode === 'prompt' ? 'active' : ''}`}
              onClick={() => setInputMode('prompt')}
            >
              提示词生成
            </button>
            <button
              className={`va-tab ${inputMode === 'upload' ? 'active' : ''}`}
              onClick={() => setInputMode('upload')}
            >
              上传视频
            </button>
            <button
              className={`va-tab ${inputMode === 'youtube' ? 'active' : ''}`}
              onClick={() => setInputMode('youtube')}
            >
              YouTube URL
            </button>
          </div>
          {inputMode === 'prompt' ? (
            <div className="va-prompt-start">
              <div className="va-context-panel">
                <div className="va-pdf-row">
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handlePdfFileChange}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="va-secondary-btn"
                    onClick={() => pdfInputRef.current?.click()}
                    disabled={analyzing || !!pendingAnalyzeTaskId}
                  >
                    {pdfAttachment ? '更换 PDF' : '上传 PDF'}
                  </button>
                  {pdfAttachment ? (
                    <div className="va-pdf-chip">
                      <span title={pdfAttachment.name}>
                        {pdfAttachment.name} · {formatSize(pdfAttachment.size)}
                      </span>
                      <button
                        type="button"
                        aria-label="移除 PDF"
                        onClick={clearPdfAttachment}
                        disabled={analyzing || !!pendingAnalyzeTaskId}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <span className="va-pdf-hint">
                      可选，上传后仅支持 Gemini 模型，PDF 不超过 20MB
                    </span>
                  )}
                </div>
                <KnowledgeNoteContextSelector
                  value={knowledgeContextRefs}
                  onChange={setKnowledgeContextRefs}
                  disabled={analyzing || !!pendingAnalyzeTaskId}
                  className="va-knowledge-context-selector"
                />
              </div>
              <CreativeBriefEditor
                value={creativeBrief}
                onChange={setCreativeBrief}
                workflow="popular_video"
                videoStyle={videoStyle}
                onVideoStyleChange={setVideoStyle}
              />
              <VideoParametersRow
                selectedModel={videoModel}
                selectedSelectionKey={getSelectionKey(videoModel, videoModelRef)}
                onSelectModel={setVideoModel}
                models={videoModels}
                segmentDuration={segmentDuration}
                durationOptions={durationOptions}
                onSegmentDurationChange={setSegmentDuration}
                targetDuration={targetDuration}
                onTargetDurationChange={(value) =>
                  setTargetDuration(
                    Number.isFinite(value) && value > 0
                      ? value
                      : DEFAULT_PROMPT_TARGET_DURATION
                  )
                }
                disabled={analyzing || !!pendingAnalyzeTaskId}
              />
              <textarea
                className="va-prompt-textarea"
                value={promptText}
                onChange={(e) => {
                  setPromptText(e.target.value);
                  setError('');
                  setAnalysis(null);
                }}
                placeholder="输入产品、主题、受众、风格或爆款方向，可附带 PDF 作为上下文"
                rows={5}
              />
            </div>
          ) : inputMode === 'upload' ? (
            videoFile ? (
              <div className="va-video-preview">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={videoPreviewUrl!} controls muted playsInline />
                <button
                  className="va-video-preview-close"
                  onClick={handleClearFile}
                >
                  ✕
                </button>
                <div className="va-video-preview-info">
                  <span className="va-video-preview-name">
                    {videoFile.name}
                  </span>
                  <span className="va-video-preview-size">
                    {formatSize(videoFile.size)}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </div>
            ) : (
              <div
                className="va-dropzone"
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <span className="va-placeholder">
                  拖拽视频到此处 或 点击上传
                  <br />
                  <span className="va-placeholder-hint">
                    建议视频在6M以内，可用推特或Youtube下载器下载最低分辨率视频
                  </span>
                </span>
              </div>
            )
          ) : (
            <input
              className="va-url-input"
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />
          )}
          <div className="va-analyze-control-row">
            <div className="va-model-select va-model-select--analysis">
              <label className="va-model-label">分析模型</label>
              <ModelDropdown
                variant="form"
                selectedModel={selectedModel}
                selectedSelectionKey={getSelectionKey(
                  selectedModel,
                  selectedModelRef
                )}
                onSelect={setSelectedModel}
                models={selectableAnalysisModels}
                placement="auto"
                disabled={analyzing}
                placeholder={
                  isGeminiRequiredForAnalysis ? '选择 Gemini 模型' : '选择文本模型'
                }
              />
            </div>
            <button
              className="va-analyze-btn va-analyze-btn--inline"
              onClick={handleAnalyze}
              disabled={
                analyzing ||
                !!pendingAnalyzeTaskId ||
                (inputMode === 'prompt'
                  ? !promptText.trim()
                  : inputMode === 'upload'
                  ? !videoFile
                  : !youtubeUrl)
              }
            >
              {analyzing || pendingAnalyzeTaskId
                ? progress || '分析中...'
                : inputMode === 'prompt'
                ? '生成提示词'
                : '开始分析'}
            </button>
          </div>
          {isGeminiRequiredForAnalysis && !isUsingGeminiMixModel && (
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
          {error && <div className="va-error">{error}</div>}
        </>
      )}

      {/* 结果摘要 */}
      {analysis && (
        <div className="va-results">
          <div className="va-stats">
            <div className="va-stat">
              <span className="va-stat-value">{analysis.totalDuration}s</span>
              <span className="va-stat-label">总时长</span>
            </div>
            <div className="va-stat">
              <span className="va-stat-value">{analysis.shotCount}</span>
              <span className="va-stat-label">镜头数</span>
            </div>
            <div className="va-stat">
              <span className="va-stat-value">
                {analysis.productExposureRatio}%
              </span>
              <span className="va-stat-label">产品占比</span>
            </div>
            <div className="va-stat">
              <span className="va-stat-value">
                {analysis.aspect_ratio || '-'}
              </span>
              <span className="va-stat-label">画面比例</span>
            </div>
          </div>
          {(analysis.video_style || analysis.bgm_mood) && (
            <div className="va-style-info">
              {analysis.video_style && (
                <span>风格: {analysis.video_style}</span>
              )}
              {analysis.bgm_mood && <span>BGM: {analysis.bgm_mood}</span>}
            </div>
          )}
          <div className="va-suggestion">{analysis.suggestion}</div>
          <ShotTimeline
            shots={analysis.shots}
            totalDuration={analysis.totalDuration}
          />

          {/* 镜头列表（只读） */}
          <div className="va-shots">
            {analysis.shots.map((shot, i) => (
              <ShotCard key={shot.id} shot={shot} index={i} />
            ))}
          </div>

          <div className="va-page-actions">
            {extractingFrames && (
              <span className="va-frame-progress">{frameProgress}</span>
            )}
            <button onClick={handleInsertAnalysis}>插入画布</button>
            <button
              onClick={() => {
                setAnalysis(null);
              }}
            >
              重新分析
            </button>
            {onCreateNew && <button onClick={onCreateNew}>新建分析</button>}
            {onNext && (
              <button className="va-btn-primary" onClick={onNext}>
                下一步: 编辑脚本 →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
