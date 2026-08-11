/**
 * 素材生成页 - 单镜头弹窗生成 + 底部批量配置
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { MessagePlugin } from '../../../utils/message-plugin';
import type { AnalysisRecord, VideoShot, VideoCharacter } from '../types';
import { formatShotsMarkdown, migrateProductInfo } from '../types';
import { getValidVideoSize } from '../../../constants/video-model-config';
import { getCompatibleParams, type ParamConfig } from '../../../constants/model-config';
import {
  getEffectiveVideoCompatibleParams,
  getEffectiveVideoModelConfigForSelection,
} from '../../../services/video-binding-utils';
import {
  loadScopedAIImageToolPreferences,
  loadScopedAIVideoToolPreferences,
  saveAIImageToolPreferences,
  saveAIVideoToolPreferences,
} from '../../../services/ai-generation-preferences-service';
import { mcpRegistry } from '../../../mcp/registry';
import { quickInsert, setCanvasBoard } from '../../../mcp/tools/canvas-insertion';
import { updateRecord } from '../storage';
import { MediaLibraryModal } from '../../media-library';
import {
  AssetCategory,
  SelectionMode,
  AssetType,
} from '../../../types/asset.types';
import type { Asset } from '../../../types/asset.types';
import { ShotCard } from '../components/ShotCard';
import {
  buildCharacterReferencePrompt,
  buildVideoReferenceImageDescriptions,
  buildVideoPrompt,
  buildFramePrompt,
} from '../utils';
import { ReferenceImageUpload } from '../../ttd-dialog/shared';
import type { ReferenceImage } from '../../ttd-dialog/shared';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { ParametersDropdown } from '../../ai-input-bar/ParametersDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import type { VideoModel } from '../../../types/video.types';
import { useDrawnix, DialogType } from '../../../hooks/use-drawnix';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import { TaskStatus } from '../../../types/task.types';
import { taskQueueService } from '../../../services/task-queue';
import { extractFrameFromUrl } from '../../../utils/video-frame-cache';
import {
  buildBatchVideoReferenceImages,
  getNonRetryableBatchVideoFailureReason,
  waitForBatchVideoTask,
} from '../../../utils/batch-video-generation';
import { VideoPosterPreview } from '../../shared/VideoPosterPreview';
import { HoverTip, RetryImage } from '../../shared';
import { useWorkflowAssetActions } from '../../shared/workflow';
import {
  buildVideoAnalyzerResetPayload,
  buildVideoAnalyzerWorkflowExportOptions,
} from '../generate-page-helpers';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
  updateActiveShotsInRecord,
} from '../utils';
import {
  collectWorkflowExportAssets,
  exportWorkflowAssetsZip,
} from '../../../utils/workflow-generation-utils';
import { analytics } from '../../../utils/posthog-analytics';
import { markAssetAsCharacter } from '../../../services/character-asset-metadata-service';

const STORAGE_KEY_IMAGE_MODEL = 'video-analyzer:image-model';
const STORAGE_KEY_VIDEO_MODEL = 'video-analyzer:video-model';

function areStringMapsEqual(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function normalizeParamsForConfigs(
  params: Record<string, string>,
  compatibleParams: ParamConfig[]
): Record<string, string> {
  return compatibleParams.reduce<Record<string, string>>((acc, param) => {
    const value = params[param.id];
    const isValidValue =
      param.valueType === 'enum'
        ? param.options?.some((option) => option.value === value)
        : typeof value === 'string' && value.trim() !== '';

    if (isValidValue && value) {
      acc[param.id] = value;
      return acc;
    }

    if (param.defaultValue) {
      acc[param.id] = param.defaultValue;
    }
    return acc;
  }, {});
}

function mergeVideoWorkflowParams(
  extraParams: Record<string, string>,
  duration?: string | number | null,
  size?: string | null
): Record<string, string> {
  return {
    ...extraParams,
    ...(duration !== undefined && duration !== null
      ? { duration: String(duration) }
      : {}),
    ...(size ? { size } : {}),
  };
}

function splitVideoWorkflowParams(
  params: Record<string, string>,
  fallbackDuration: string,
  fallbackSize: string
): {
  extraParams: Record<string, string>;
  duration: string;
  size: string;
} {
  const { duration, size, ...extraParams } = params;
  return {
    extraParams,
    duration: duration || fallbackDuration,
    size: size || fallbackSize,
  };
}

function getAspectRatioFromImageSizeParam(size?: string): string | undefined {
  if (!size || size === 'auto') {
    return undefined;
  }

  const normalized = size.trim().replace(/[xX]/g, ':');
  return /^\d+:\d+$/.test(normalized) ? normalized : undefined;
}

const MediaLibraryGridIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    aria-hidden="true"
  >
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <circle cx="17" cy="7" r="4" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

interface GeneratePageProps {
  record: AnalysisRecord;
  onRecordUpdate: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
  onRestart?: () => void;
}

export const GeneratePage: React.FC<GeneratePageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
  onRestart,
}) => {
  const shots = useMemo(
    () => record.editedShots || record.analysis.shots,
    [record.editedShots, record.analysis.shots]
  );
  const aspectRatio = record.analysis.aspect_ratio || '16x9';
  const batchId = record.batchId || `va_${record.id}`;
  const { openDialog, board } = useDrawnix();
  const latestRecordRef = useRef(record);
  const latestShotsRef = useRef(shots);
  const batchStopRef = useRef(false);
  const batchVideoRunningRef = useRef(false);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const activeBatchTaskIdRef = useRef<string | null>(null);
  const activeBatchTaskIdsRef = useRef(new Set<string>());
  const batchCreatedVideoTaskIdsRef = useRef(new Set<string>());

  const [refImages, setRefImages] = useState<ReferenceImage[]>([]);
  const [charLibraryTarget, setCharLibraryTarget] = useState<string | null>(null); // charId
  const imageModels = useSelectableModels('image');
  const videoModels = useSelectableModels('video');
  const [imageModel, setImageModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, '').modelId
  );
  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, '').modelRef
  );
  const [imageSelectedParams, setImageSelectedParams] = useState<
    Record<string, string>
  >(() => {
    const stored = readStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, '');
    if (!stored.modelId) {
      return {};
    }
    return loadScopedAIImageToolPreferences(
      stored.modelId,
      getSelectionKey(stored.modelId, stored.modelRef)
    ).extraParams;
  });
  const [videoModel, setVideoModelState] = useState(
    () =>
      record.productInfo?.videoModel ||
      readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () =>
      record.productInfo?.videoModelRef ||
      readStoredModelSelection(
        STORAGE_KEY_VIDEO_MODEL,
        record.productInfo?.videoModel || 'veo3'
      ).modelRef
  );
  const [videoSelectedParams, setVideoSelectedParams] = useState<
    Record<string, string>
  >(() => {
    const stored = readStoredModelSelection(
      STORAGE_KEY_VIDEO_MODEL,
      record.productInfo?.videoModel || 'veo3'
    );
    const initialModel = record.productInfo?.videoModel || stored.modelId;
    const initialModelRef = record.productInfo?.videoModelRef || stored.modelRef;
    const scopedPreferences = loadScopedAIVideoToolPreferences(
      initialModel as VideoModel,
      getSelectionKey(initialModel, initialModelRef)
    );
    return mergeVideoWorkflowParams(
      scopedPreferences.extraParams,
      record.productInfo?.segmentDuration || scopedPreferences.duration,
      getValidVideoSize(
        initialModel,
        record.productInfo?.videoSize || scopedPreferences.size,
        aspectRatio
      )
    );
  });
  const [batchVideoState, setBatchVideoState] = useState({
    running: false,
    stopping: false,
    currentIndex: -1,
    retryCount: 0,
    completedCount: 0,
    activeCount: 0,
  });
  const [insertGeneratedVideosToCanvas, setInsertGeneratedVideosToCanvas] = useState(false);

  const compatibleImageParams = useMemo(
    () => getCompatibleParams(imageModel),
    [imageModel]
  );
  const compatibleVideoParams = useMemo(
    () =>
      getEffectiveVideoCompatibleParams(
        videoModel,
        videoModelRef || videoModel,
        videoSelectedParams
      ),
    [videoModel, videoModelRef, videoSelectedParams]
  );
  const videoModelConfig = useMemo(
    () =>
      getEffectiveVideoModelConfigForSelection(
        videoModel,
        videoModelRef || videoModel,
        videoSelectedParams
      ),
    [videoModel, videoModelRef, videoSelectedParams]
  );
  const sizeOptions = useMemo(() => videoModelConfig.sizeOptions, [videoModelConfig]);
  const splitVideoParams = useMemo(
    () =>
      splitVideoWorkflowParams(
        videoSelectedParams,
        videoModelConfig.defaultDuration,
        videoModelConfig.defaultSize
      ),
    [
      videoModelConfig.defaultDuration,
      videoModelConfig.defaultSize,
      videoSelectedParams,
    ]
  );
  const videoSize = splitVideoParams.size;
  const segmentDuration = Number.parseFloat(splitVideoParams.duration) || 8;
  const imageGenerationExtraParams = useMemo(
    () =>
      Object.keys(imageSelectedParams).length > 0
        ? imageSelectedParams
        : undefined,
    [imageSelectedParams]
  );

  /** 当前角色列表：record.characters 优先（含用户设置的 referenceImageUrl），回退到分析结果 */
  const characters = useMemo<VideoCharacter[]>(
    () => record.characters || record.analysis.characters || [],
    [record.characters, record.analysis.characters]
  );
  const generationProductInfo = useMemo(() => {
    const snapshot = record.sourceSnapshot;
    const sourcePrompt = snapshot?.type === 'prompt' ? snapshot.prompt : '';
    const generationTopic =
      sourcePrompt || (record.source === 'prompt' ? record.sourceLabel : '');
    const generationContext = [
      record.source !== 'prompt' && record.sourceLabel
        ? `素材来源：${record.sourceLabel}`
        : '',
      snapshot?.type === 'prompt' && snapshot.pdfName
        ? `参考 PDF：${snapshot.pdfName}`
        : '',
    ].filter(Boolean).join('\n');

    return {
      ...(record.productInfo || {}),
      generationTopic,
      generationContext,
      generationAdvice: record.analysis.suggestion || '',
    };
  }, [
    record.analysis.suggestion,
    record.productInfo,
    record.source,
    record.sourceLabel,
    record.sourceSnapshot,
  ]);
  const exportableAssets = useMemo(() => collectWorkflowExportAssets(shots), [shots]);

  useEffect(() => {
    latestRecordRef.current = record;
  }, [record]);

  useEffect(() => {
    latestShotsRef.current = shots;
  }, [shots]);

  const applyRecordPatch = useCallback(async (patch: Partial<AnalysisRecord>) => {
    const current = latestRecordRef.current;
    const nextRecord = { ...current, ...patch };
    latestRecordRef.current = nextRecord;
    if (nextRecord.editedShots) {
      latestShotsRef.current = nextRecord.editedShots;
    }
    const updated = await updateRecord(current.id, patch);
    onRecordsChange(updated);
    onRecordUpdate(nextRecord);
    return nextRecord;
  }, [onRecordUpdate, onRecordsChange]);

  const applyUpdatedShots = useCallback(async (updatedShots: VideoShot[]) => {
    const current = latestRecordRef.current;
    const patch = updateActiveShotsInRecord(current, updatedShots);
    latestShotsRef.current = updatedShots;
    await applyRecordPatch(patch);
    return updatedShots;
  }, [applyRecordPatch]);

  const applyProductInfoPatch = useCallback(async (patch: Partial<NonNullable<AnalysisRecord['productInfo']>>) => {
    const current = latestRecordRef.current;
    const nextProductInfo = {
      ...migrateProductInfo(current.productInfo || { prompt: '' }, current.analysis.totalDuration),
      ...patch,
    };
    await applyRecordPatch({ productInfo: nextProductInfo });
    return nextProductInfo;
  }, [applyRecordPatch]);

  /** 更新某个角色的参考图 URL */
  const handleCharacterRefImageChange = useCallback(async (charId: string, url: string | undefined) => {
    const current = latestRecordRef.current;
    const base = current.characters || current.analysis.characters || [];
    const updated = base.map(c => c.id === charId ? { ...c, referenceImageUrl: url } : c);
    await applyRecordPatch({ characters: updated });
  }, [applyRecordPatch]);

  /** 打开图片生成弹窗为角色生成参考图 */
  const handleGenerateCharacterRef = useCallback((char: VideoCharacter) => {
    const charBatchId = `va_${record.id}_char${char.id}_ref`;
    const prompt = buildCharacterReferencePrompt(
      char,
      record.analysis,
      generationProductInfo
    );
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: prompt,
      batchId: charBatchId,
      initialAspectRatio: '1:1',
      initialModel: imageModel || undefined,
      initialModelRef: imageModelRef,
      assetMetadata: {
        category: AssetCategory.CHARACTER,
        characterName: char.name,
        characterPrompt: prompt,
      },
    });
  }, [generationProductInfo, record.analysis, record.id, openDialog, imageModel, imageModelRef]);

  const setImageModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    const nextModelRef = modelRef || null;
    setImageModelState(model);
    setImageModelRef(nextModelRef);
    setImageSelectedParams(
      loadScopedAIImageToolPreferences(
        model,
        getSelectionKey(model, nextModelRef)
      ).extraParams
    );
    writeStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, model, modelRef);
  }, []);

  const setVideoModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    const nextModelRef = modelRef || null;
    setVideoModelState(model);
    setVideoModelRef(nextModelRef);
    writeStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, model, modelRef);
    const scopedPreferences = loadScopedAIVideoToolPreferences(
      model as VideoModel,
      getSelectionKey(model, nextModelRef)
    );
    setVideoSelectedParams(
      mergeVideoWorkflowParams(
        scopedPreferences.extraParams,
        scopedPreferences.duration,
        getValidVideoSize(model, scopedPreferences.size, aspectRatio)
      )
    );
  }, [aspectRatio]);

  const handleImageParamChange = useCallback((paramId: string, value: string) => {
    setImageSelectedParams((prev) => {
      const next = { ...prev };
      if (!value || value === 'default') {
        delete next[paramId];
      } else {
        next[paramId] = value;
      }
      return next;
    });
  }, []);

  const handleVideoParamChange = useCallback((paramId: string, value: string) => {
    setVideoSelectedParams((prev) => {
      const next = { ...prev };
      if (!value || value === 'default') {
        delete next[paramId];
      } else {
        next[paramId] = value;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const normalizedParams = normalizeParamsForConfigs(
      imageSelectedParams,
      compatibleImageParams
    );
    if (!areStringMapsEqual(imageSelectedParams, normalizedParams)) {
      setImageSelectedParams(normalizedParams);
    }
  }, [compatibleImageParams, imageSelectedParams]);

  useEffect(() => {
    const normalizedParams = normalizeParamsForConfigs(
      videoSelectedParams,
      compatibleVideoParams
    );
    if (!areStringMapsEqual(videoSelectedParams, normalizedParams)) {
      setVideoSelectedParams(normalizedParams);
    }
  }, [compatibleVideoParams, videoSelectedParams]);

  useEffect(() => {
    const splitParams = splitVideoWorkflowParams(
      videoSelectedParams,
      videoModelConfig.defaultDuration,
      videoModelConfig.defaultSize
    );
    saveAIVideoToolPreferences({
      currentModel: videoModel as VideoModel,
      currentSelectionKey: getSelectionKey(videoModel, videoModelRef),
      extraParams: splitParams.extraParams,
      duration: splitParams.duration,
      size: splitParams.size,
    });
    void applyProductInfoPatch({
      videoModel,
      videoModelRef: videoModelRef || null,
      segmentDuration: Number.parseFloat(splitParams.duration) || 8,
      videoSize: splitParams.size,
    });
  }, [
    applyProductInfoPatch,
    videoModel,
    videoModelConfig.defaultDuration,
    videoModelConfig.defaultSize,
    videoModelRef,
    videoSelectedParams,
  ]);

  const handleInsertScriptToCanvas = useCallback(async () => {
    try {
      const currentRecord = latestRecordRef.current;
      const currentShots = latestShotsRef.current;
      if (!board) {
        throw new Error('画布未就绪');
      }
      setCanvasBoard(board);
      const sourcePrompt =
        currentRecord.productInfo?.prompt ||
        (currentRecord.sourceSnapshot?.type === 'prompt'
          ? currentRecord.sourceSnapshot.prompt
          : currentRecord.sourceLabel || '');
      const result = await quickInsert(
        'text',
        formatShotsMarkdown(currentShots, currentRecord.analysis, currentRecord.productInfo),
        undefined,
        undefined,
        sourcePrompt.trim() ? { prompt: sourcePrompt.trim() } : undefined
      );
      if (!result.success) {
        throw new Error(result.error || '插入失败，请确认画布已打开');
      }
      analytics.trackUIInteraction({
        area: 'popular_video_tool',
        action: 'script_inserted_to_canvas',
        control: 'insert_script',
        source: 'video_analyzer_generate_page',
        metadata: { shotCount: currentShots.length },
      });
      MessagePlugin.success('脚本已插入画布');
    } catch (error) {
      console.error('[VideoAnalyzer] Failed to insert script to canvas:', error);
      const message = error instanceof Error ? error.message : '脚本插入画布失败';
      MessagePlugin.error(message);
    }
  }, [board]);

  const insertGeneratedVideoToCanvas = useCallback(async (
    videoUrl: string,
    prompt?: string
  ) => {
    if (!board) {
      return false;
    }
    try {
      setCanvasBoard(board);
      const result = await quickInsert(
        'video',
        videoUrl,
        undefined,
        undefined,
        prompt?.trim() ? { prompt: prompt.trim() } : undefined
      );
      if (!result.success) {
        throw new Error(result.error || '插入失败，请确认画布已打开');
      }
      return true;
    } catch (error) {
      console.error('[VideoAnalyzer] Failed to insert generated video to canvas:', error);
      return false;
    }
  }, [board]);

  const { isExportingAssets, exportProgress, handleExportAssets: handleDownloadAssetsZip } =
    useWorkflowAssetActions({
      onExport: async (onProgress) => {
        const currentRecord = latestRecordRef.current;
        const currentShots = latestShotsRef.current;
        const result = await exportWorkflowAssetsZip({
          ...buildVideoAnalyzerWorkflowExportOptions(
            currentRecord,
            currentShots,
            exportableAssets
          ),
          onProgress,
        });
        return result;
      },
      onExportSuccess: (result) => {
        MessagePlugin.success(`素材导出完成，共 ${result.assetCount} 个文件`);
      },
      onExportError: (error) => {
        console.error('[VideoAnalyzer] Failed to export assets:', error);
        MessagePlugin.error('素材导出失败');
      },
    });

  // 参考图 URL 列表（用于传给批量生成接口）
  const refImageUrls = useMemo(() => refImages.map(img => img.url).filter(Boolean), [refImages]);

  // 确保 batchId 已保存
  const ensureBatchId = useCallback(async () => {
    if (!record.batchId) {
      await applyRecordPatch({ batchId });
    }
  }, [record.batchId, batchId, applyRecordPatch]);

  // --- 通过 jotai 任务状态驱动帧图片回填 ---
  const { tasks: allTasks } = useSharedTaskState();
  const processedTaskIdsRef = useRef(new Set<string>());
  const extractingRef = useRef(new Set<string>());

  const autoFillAdjacentFrames = useCallback(async (
    recordId: string,
    currentShots: VideoShot[],
    newVideos: Array<{ shotId: string; videoUrl: string }>
  ) => {
    let updatedShots = [...currentShots];
    let changed = false;

    for (const { shotId, videoUrl } of newVideos) {
      const key = `auto_${shotId}`;
      if (extractingRef.current.has(key)) continue;
      extractingRef.current.add(key);

      try {
        const idx = updatedShots.findIndex(s => s.id === shotId);
        if (idx === -1) continue;

        const nextShot = updatedShots[idx + 1];
        if (!nextShot) continue;

        const url = await extractFrameFromUrl(videoUrl, nextShot.id, 'first', 'last');
        if (!url || nextShot.generated_first_frame_url === url) continue;

        updatedShots = updatedShots.map((shot, shotIndex) =>
          shotIndex === idx + 1 ? { ...shot, generated_first_frame_url: url } : shot
        );
        changed = true;
      } finally {
        extractingRef.current.delete(key);
      }
    }

    if (changed) {
      const latestRecord = record;
      void updateRecord(recordId, updateActiveShotsInRecord(latestRecord, updatedShots)).then(updated => {
        onRecordsChange(updated);
        onRecordUpdate({ ...latestRecord, editedShots: updatedShots });
      });
    }
  }, [record, onRecordUpdate, onRecordsChange]);

  useEffect(() => {
    const prefix = `va_${record.id}_shot`;
    const charPrefix = `va_${record.id}_char`;
    let hasUpdate = false;
    const currentRecord = record;
    const generatedAssetsResetAt =
      latestRecordRef.current.generatedAssetsResetAt ||
      currentRecord.generatedAssetsResetAt;
    let currentShots = currentRecord.editedShots || currentRecord.analysis.shots;
    const newVideoShots: Array<{ shotId: string; videoUrl: string }> = [];

    for (const task of allTasks) {
      if (task.status !== TaskStatus.COMPLETED) continue;
      if (processedTaskIdsRef.current.has(task.id)) continue;
      const taskBatchId = task.params?.batchId as string | undefined;
      if (!taskBatchId) continue;

      // 处理角色参考图生成结果：batchId 格式 va_${recordId}_char${charId}_ref
      if (taskBatchId.startsWith(charPrefix)) {
        if (
          generatedAssetsResetAt &&
          task.createdAt <= generatedAssetsResetAt
        ) {
          processedTaskIdsRef.current.add(task.id);
          continue;
        }
        const resultUrl = task.result?.url;
        processedTaskIdsRef.current.add(task.id);
        if (resultUrl) {
          const suffix = taskBatchId.slice(charPrefix.length);
          const refIdx = suffix.lastIndexOf('_ref');
          if (refIdx !== -1) {
            const charId = suffix.slice(0, refIdx);
            const base = latestRecordRef.current.characters || latestRecordRef.current.analysis.characters || [];
            const updatedChars = base.map(c => c.id === charId ? { ...c, referenceImageUrl: resultUrl } : c);
            void applyRecordPatch({ characters: updatedChars });
          }
        }
        continue;
      }

      if (!taskBatchId.startsWith(prefix)) continue;
      if (
        generatedAssetsResetAt &&
        task.createdAt <= generatedAssetsResetAt
      ) {
        processedTaskIdsRef.current.add(task.id);
        continue;
      }
      // 跳过在当前脚本生成之前创建的任务，防止旧任务结果污染新脚本
      if (record.storyboardGeneratedAt && task.createdAt < record.storyboardGeneratedAt) {
        processedTaskIdsRef.current.add(task.id);
        continue;
      }
      const resultUrl = task.result?.url;
      if (!resultUrl) continue;

      const suffix = taskBatchId.slice(prefix.length);
      const lastUnderscore = suffix.lastIndexOf('_');
      if (lastUnderscore === -1) continue;
      const shotId = suffix.slice(0, lastUnderscore);
      const frameType = suffix.slice(lastUnderscore + 1);
      if (frameType !== 'first' && frameType !== 'last' && frameType !== 'video') continue;

      const field = frameType === 'first' ? 'generated_first_frame_url'
        : frameType === 'last' ? 'generated_last_frame_url'
        : 'generated_video_url';
      const shot = currentShots.find(s => s.id === shotId);
      const isBatchCreatedVideoTask =
        frameType === 'video' && batchCreatedVideoTaskIdsRef.current.has(task.id);
      const suppressedUrl = shot?.suppressed_generated_urls?.[frameType];
      if (suppressedUrl && suppressedUrl === resultUrl) {
        if (isBatchCreatedVideoTask) {
          batchCreatedVideoTaskIdsRef.current.delete(task.id);
        }
        processedTaskIdsRef.current.add(task.id);
        continue;
      }
      if (!shot || shot[field] === resultUrl) {
        if (isBatchCreatedVideoTask) {
          batchCreatedVideoTaskIdsRef.current.delete(task.id);
        }
        processedTaskIdsRef.current.add(task.id);
        continue;
      }

      currentShots = currentShots.map(s =>
        s.id === shotId
          ? {
              ...s,
              [field]: resultUrl,
              suppressed_generated_urls: s.suppressed_generated_urls
                ? {
                    ...s.suppressed_generated_urls,
                    [frameType]: undefined,
                  }
                : undefined,
            }
          : s
      );
      processedTaskIdsRef.current.add(task.id);
      hasUpdate = true;

      if (frameType === 'video') {
        if (isBatchCreatedVideoTask) {
          batchCreatedVideoTaskIdsRef.current.delete(task.id);
        } else {
          newVideoShots.push({ shotId, videoUrl: resultUrl });
        }
      }
    }

    if (hasUpdate) {
      void updateRecord(currentRecord.id, updateActiveShotsInRecord(currentRecord, currentShots)).then(updated => {
        onRecordsChange(updated);
        onRecordUpdate({ ...currentRecord, editedShots: currentShots });
      });
    }

    if (newVideoShots.length > 0 && !batchVideoRunningRef.current) {
      void autoFillAdjacentFrames(currentRecord.id, currentShots, newVideoShots);
    }
  }, [allTasks, autoFillAdjacentFrames, record, onRecordUpdate, onRecordsChange, applyRecordPatch]);

  // --- 从素材库选择帧图片 ---
  const [libraryTarget, setLibraryTarget] = useState<{ shotId: string; assetType: 'first' | 'last' | 'video' } | null>(null);

  const handlePickFromLibrary = useCallback((shotId: string, assetType: 'first' | 'last' | 'video') => {
    setLibraryTarget({ shotId, assetType });
  }, []);

  const handleLibrarySelect = useCallback(async (asset: Asset) => {
    if (!libraryTarget) return;
    setLibraryTarget(null);
    const { shotId, assetType } = libraryTarget;
    const field = assetType === 'first'
      ? 'generated_first_frame_url'
      : assetType === 'last'
        ? 'generated_last_frame_url'
        : 'generated_video_url';
    const currentShots = record.editedShots || record.analysis.shots;
    const updatedShots = currentShots.map(s =>
      s.id === shotId ? { ...s, [field]: asset.url } : s
    );
    const updated = await updateRecord(record.id, updateActiveShotsInRecord(record, updatedShots));
    onRecordsChange(updated);
    onRecordUpdate({ ...record, editedShots: updatedShots });
  }, [libraryTarget, record, onRecordsChange, onRecordUpdate]);

  // hover 大图/大视频预览
  const [hoverPreview, setHoverPreview] = useState<{ url: string; type: 'image' | 'video'; x: number; y: number } | null>(null);
  const hoverPreviewHideTimerRef = useRef<number | null>(null);
  const clearHoverPreviewHideTimer = useCallback(() => {
    if (hoverPreviewHideTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewHideTimerRef.current);
      hoverPreviewHideTimerRef.current = null;
    }
  }, []);
  const hideHoverPreview = useCallback(() => {
    clearHoverPreviewHideTimer();
    setHoverPreview(null);
  }, [clearHoverPreviewHideTimer]);
  const scheduleHideHoverPreview = useCallback(() => {
    clearHoverPreviewHideTimer();
    hoverPreviewHideTimerRef.current = window.setTimeout(() => {
      hoverPreviewHideTimerRef.current = null;
      setHoverPreview(null);
    }, 120);
  }, [clearHoverPreviewHideTimer]);
  const handleThumbEnter = useCallback((url: string, type: 'image' | 'video', e: React.MouseEvent) => {
    clearHoverPreviewHideTimer();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoverPreview({ url, type, x: rect.left + rect.width / 2, y: rect.top - 8 });
  }, [clearHoverPreviewHideTimer]);
  const handleThumbLeave = useCallback(() => {
    scheduleHideHoverPreview();
  }, [scheduleHideHoverPreview]);
  const handleHoverPreviewEnter = useCallback(() => {
    clearHoverPreviewHideTimer();
  }, [clearHoverPreviewHideTimer]);
  const handleHoverPreviewLeave = useCallback(() => {
    hideHoverPreview();
  }, [hideHoverPreview]);

  useEffect(() => {
    return () => {
      clearHoverPreviewHideTimer();
    };
  }, [clearHoverPreviewHideTimer]);

  // --- 单镜头：打开图片生成弹窗 ---
  const selectedVideoAspectRatio = useMemo(() => {
    const optionAspectRatio = sizeOptions.find((option) => option.value === videoSize)?.aspectRatio;
    if (optionAspectRatio) {
      return optionAspectRatio;
    }
    if (videoSize?.includes('x')) {
      const [w, h] = videoSize.split('x').map(Number);
      if (w && h) {
        const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
        const d = gcd(w, h);
        return `${w / d}:${h / d}`;
      }
    }
    return aspectRatio.replace('x', ':');
  }, [aspectRatio, sizeOptions, videoSize]);

  // 视频 aspect_ratio (16x9) → 图片 aspectRatio (16:9)
  const imageAspectRatio = selectedVideoAspectRatio;
  const selectedImageAspectRatio = getAspectRatioFromImageSizeParam(
    imageSelectedParams.size
  );
  const imageGenerationSize = imageSelectedParams.size || imageAspectRatio;

  useEffect(() => {
    if (!imageModel) {
      return;
    }
    saveAIImageToolPreferences({
      currentModel: imageModel,
      currentSelectionKey: getSelectionKey(imageModel, imageModelRef),
      extraParams: imageSelectedParams,
      aspectRatio: selectedImageAspectRatio || imageAspectRatio,
    });
  }, [
    imageAspectRatio,
    imageModel,
    imageModelRef,
    imageSelectedParams,
    selectedImageAspectRatio,
  ]);

  const toDraftImages = useCallback((images: Array<{ url: string; name: string }>) => {
    return images.map((image) => ({
      url: image.url,
      name: image.name,
    }));
  }, []);

  const areDraftImagesEqual = useCallback((
    left: Array<{ url: string; name: string }> = [],
    right: Array<{ url: string; name: string }> = []
  ) => {
    return (
      left.length === right.length &&
      left.every((image, index) =>
        image.url === right[index]?.url && image.name === right[index]?.name
      )
    );
  }, []);

  const mergeReferenceImages = useCallback((
    ...groups: Array<Array<{ url: string; name: string }> | undefined>
  ): ReferenceImage[] | undefined => {
    const seenUrls = new Set<string>();
    const merged: ReferenceImage[] = [];

    groups.forEach((group) => {
      group?.forEach((image) => {
        const url = image.url?.trim();
        if (!url || seenUrls.has(url)) {
          return;
        }
        seenUrls.add(url);
        merged.push({
          url,
          name: image.name || '参考图',
        });
      });
    });

    return merged.length > 0 ? merged : undefined;
  }, []);

  const getShotCharacterReferenceImages = useCallback((shot: VideoShot): ReferenceImage[] => {
    if (!shot.character_ids?.length) {
      return [];
    }

    const seenUrls = new Set<string>();
    return shot.character_ids.reduce<ReferenceImage[]>((acc, charId) => {
      const character = characters.find((item) => item.id === charId);
      const url = character?.referenceImageUrl?.trim();
      if (!url || seenUrls.has(url)) {
        return acc;
      }
      seenUrls.add(url);
      acc.push({
        url,
        name: character?.name ? `角色：${character.name}` : '角色参考图',
      });
      return acc;
    }, []);
  }, [characters]);

  const saveShotDraft = useCallback(async (
    shotId: string,
    type: 'first' | 'last' | 'video',
    draft: {
      prompt: string;
      images: Array<{ url: string; name: string }>;
      aspectRatio?: string;
      duration?: number;
      size?: string;
    }
  ) => {
    let changed = false;
    const normalizedImages = toDraftImages(draft.images);
    const updatedShots = latestShotsRef.current.map((shot) => {
      if (shot.id !== shotId) {
        return shot;
      }

      if (type === 'first') {
        const currentDraft = shot.first_frame_draft;
        const nextDraft = {
          prompt: draft.prompt,
          images: normalizedImages,
          aspectRatio: draft.aspectRatio,
        };
        if (
          currentDraft?.prompt === nextDraft.prompt &&
          currentDraft?.aspectRatio === nextDraft.aspectRatio &&
          areDraftImagesEqual(currentDraft?.images, nextDraft.images)
        ) {
          return shot;
        }
        changed = true;
        return { ...shot, first_frame_draft: nextDraft };
      }

      if (type === 'last') {
        const currentDraft = shot.last_frame_draft;
        const nextDraft = {
          prompt: draft.prompt,
          images: normalizedImages,
          aspectRatio: draft.aspectRatio,
        };
        if (
          currentDraft?.prompt === nextDraft.prompt &&
          currentDraft?.aspectRatio === nextDraft.aspectRatio &&
          areDraftImagesEqual(currentDraft?.images, nextDraft.images)
        ) {
          return shot;
        }
        changed = true;
        return { ...shot, last_frame_draft: nextDraft };
      }

      const currentDraft = shot.video_draft;
      const nextDraft = {
        prompt: draft.prompt,
        images: normalizedImages,
        duration: draft.duration,
        size: draft.size,
      };
      if (
        currentDraft?.prompt === nextDraft.prompt &&
        currentDraft?.duration === nextDraft.duration &&
        currentDraft?.size === nextDraft.size &&
        areDraftImagesEqual(currentDraft?.images, nextDraft.images)
      ) {
        return shot;
      }
      changed = true;
      return { ...shot, video_draft: nextDraft };
    });

    if (!changed) {
      return;
    }
    await applyUpdatedShots(updatedShots);
  }, [applyUpdatedShots, areDraftImagesEqual, toDraftImages]);

  const handleShotGenerateFirstFrame = useCallback((shot: VideoShot) => {
    const rawPrompt = shot.first_frame_prompt || shot.description || '';
    if (!rawPrompt) return;
    analytics.trackUIInteraction({
      area: 'popular_video_tool',
      action: 'shot_first_frame_generation_opened',
      control: 'generate_first_frame',
      source: 'video_analyzer_generate_page',
      metadata: { shotId: shot.id, hasDraft: !!shot.first_frame_draft },
    });
    const prompt = buildFramePrompt(rawPrompt, record.analysis, generationProductInfo, {
      shot,
      characters,
    });
    const draft = shot.first_frame_draft;
    const draftImages = draft ? toDraftImages(draft.images || []) : undefined;
    const existingFrameImages = !draft && shot.generated_first_frame_url
      ? [{ url: shot.generated_first_frame_url, name: '首帧' }]
      : undefined;
    const characterReferenceImages = getShotCharacterReferenceImages(shot);
    const shotBatchId = `va_${record.id}_shot${shot.id}_first`;
    openDialog(DialogType.aiImageGeneration, {
      prefillId: shotBatchId,
      initialPrompt: draft?.prompt || prompt,
      batchId: shotBatchId,
      initialAspectRatio: draft?.aspectRatio ?? selectedImageAspectRatio,
      initialModel: imageModel || undefined,
      initialModelRef: imageModelRef,
      initialImages: mergeReferenceImages(
        draftImages,
        existingFrameImages,
        characterReferenceImages
      ),
      onDraftChange: (nextDraft: {
        prompt: string;
        images: Array<{ url: string; name: string }>;
        aspectRatio?: string;
      }) => saveShotDraft(shot.id, 'first', nextDraft),
    });
  }, [record, generationProductInfo, characters, openDialog, imageModel, imageModelRef, mergeReferenceImages, getShotCharacterReferenceImages, saveShotDraft, selectedImageAspectRatio, toDraftImages]);

  // 获取 shot 的尾帧 URL（优先使用已生成的，否则使用下一个 shot 的首帧）
  const getLastFrameUrl = useCallback((shot: VideoShot, index: number) => {
    if (shot.generated_last_frame_url) {
      return shot.generated_last_frame_url;
    }
    const nextShot = shots[index + 1];
    return nextShot?.generated_first_frame_url;
  }, [shots]);

  const handleShotGenerateLastFrame = useCallback((shot: VideoShot, index: number) => {
    const rawPrompt = shot.last_frame_prompt || '';
    if (!rawPrompt) return;
    analytics.trackUIInteraction({
      area: 'popular_video_tool',
      action: 'shot_last_frame_generation_opened',
      control: 'generate_last_frame',
      source: 'video_analyzer_generate_page',
      metadata: { shotId: shot.id, shotIndex: index, hasDraft: !!shot.last_frame_draft },
    });
    const prompt = buildFramePrompt(rawPrompt, record.analysis, generationProductInfo, {
      shot,
      characters,
    });
    const draft = shot.last_frame_draft;
    const draftImages = draft ? toDraftImages(draft.images || []) : undefined;
    const shotBatchId = `va_${record.id}_shot${shot.id}_last`;
    const lastFrameUrl = getLastFrameUrl(shot, index);
    const existingFrameImages = !draft && lastFrameUrl
      ? [{ url: lastFrameUrl, name: '尾帧' }]
      : undefined;
    const characterReferenceImages = getShotCharacterReferenceImages(shot);
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: draft?.prompt || prompt,
      batchId: shotBatchId,
      initialAspectRatio: draft?.aspectRatio ?? selectedImageAspectRatio,
      initialModel: imageModel || undefined,
      initialModelRef: imageModelRef,
      initialImages: mergeReferenceImages(
        draftImages,
        existingFrameImages,
        characterReferenceImages
      ),
      onDraftChange: (nextDraft: {
        prompt: string;
        images: Array<{ url: string; name: string }>;
        aspectRatio?: string;
      }) => saveShotDraft(shot.id, 'last', nextDraft),
    });
  }, [record, generationProductInfo, characters, openDialog, getLastFrameUrl, imageModel, imageModelRef, mergeReferenceImages, getShotCharacterReferenceImages, saveShotDraft, selectedImageAspectRatio, toDraftImages]);

  // --- 单镜头：打开视频生成弹窗 ---
  const handleShotGenerateVideo = useCallback((shot: VideoShot, index: number) => {
    analytics.trackUIInteraction({
      area: 'popular_video_tool',
      action: 'shot_video_generation_opened',
      control: 'generate_shot_video',
      source: 'video_analyzer_generate_page',
      metadata: { shotId: shot.id, shotIndex: index, hasDraft: !!shot.video_draft },
    });
    const draft = shot.video_draft;
    const shotBatchId = `va_${record.id}_shot${shot.id}_video`;
    // 将已生成的首帧/尾帧作为参考图带入
    const initialImages: ReferenceImage[] = [];
    if (shot.generated_first_frame_url) {
      initialImages.push({ url: shot.generated_first_frame_url, name: '首帧' });
    }
    const lastFrameUrl = getLastFrameUrl(shot, index);
    if (lastFrameUrl) {
      initialImages.push({ url: lastFrameUrl, name: '尾帧' });
    }
    const draftImages = toDraftImages(draft?.images || []);
    const resolvedInitialImages = draftImages.length > 0
      ? draftImages
      : initialImages.length > 0
        ? initialImages
        : undefined;
    const prompt = buildVideoPrompt(shot, record.analysis, generationProductInfo, {
      referenceImageDescriptions: buildVideoReferenceImageDescriptions(resolvedInitialImages),
    });
    if (!prompt) return;
    const durationStr = String(draft?.duration ?? segmentDuration);
    const validDuration = videoModelConfig.durationOptions.some(o => o.value === durationStr)
      ? (draft?.duration ?? segmentDuration)
      : undefined;
    const validSize = videoModelConfig.sizeOptions.some(o => o.value === (draft?.size ?? videoSize))
      ? (draft?.size ?? videoSize)
      : undefined;

    openDialog(DialogType.aiVideoGeneration, {
      initialPrompt: draft?.prompt || prompt,
      initialImages: resolvedInitialImages,
      initialDuration: validDuration,
      initialSize: validSize,
      initialModel: videoModel || undefined,
      initialModelRef: videoModelRef,
      batchId: shotBatchId,
      onDraftChange: (nextDraft: {
        prompt: string;
        images: Array<{ url: string; name: string }>;
        duration?: number;
        size?: string;
      }) => saveShotDraft(shot.id, 'video', nextDraft),
    });
  }, [record.id, segmentDuration, videoSize, videoModel, videoModelConfig, videoModelRef, openDialog, getLastFrameUrl, record.analysis, generationProductInfo, saveShotDraft, toDraftImages]);

  // --- 删除帧图片/视频 ---
  const handleDeleteFrame = useCallback((shotId: string, frameType: 'first' | 'last' | 'video') => {
    const field = frameType === 'first' ? 'generated_first_frame_url'
      : frameType === 'last' ? 'generated_last_frame_url'
      : 'generated_video_url';
    const currentShots = record.editedShots || record.analysis.shots;
    const updatedShots = currentShots.map(s =>
      s.id === shotId
        ? {
            ...s,
            [field]: undefined,
            suppressed_generated_urls: s[field]
              ? {
                  ...(s.suppressed_generated_urls || {}),
                  [frameType]: s[field] as string,
                }
              : s.suppressed_generated_urls,
          }
        : s
    );
    void updateRecord(record.id, updateActiveShotsInRecord(record, updatedShots)).then(updated => {
      onRecordsChange(updated);
      onRecordUpdate({ ...record, editedShots: updatedShots });
    });
  }, [record, onRecordUpdate, onRecordsChange]);

  /**
   * 为单个镜头生成关键帧图（等待完成后返回 URL）
   * 参考图 = 全局参考图 + 该镜头涉及的角色参考图（如有）
   */
  const generateFrameForShot = useCallback(async (
    shot: VideoShot,
    currentCharacters: VideoCharacter[],
    frameType: 'first' | 'last'
  ): Promise<string | null> => {
    const rawPrompt = frameType === 'first'
      ? shot.first_frame_prompt || shot.description || ''
      : shot.last_frame_prompt || '';
    if (!rawPrompt) return null;

    const prompt = buildFramePrompt(rawPrompt, record.analysis, generationProductInfo, {
      shot,
      characters: currentCharacters,
    });
    const referenceImages: string[] = [...refImageUrls];
    if (shot.character_ids && shot.character_ids.length > 0) {
      for (const charId of shot.character_ids) {
        const char = currentCharacters.find(c => c.id === charId);
        if (char?.referenceImageUrl && !referenceImages.includes(char.referenceImageUrl)) {
          referenceImages.push(char.referenceImageUrl);
        }
      }
    }

    const shotBatchId = `va_${record.id}_shot${shot.id}_${frameType}`;
    const result = await mcpRegistry.executeTool(
      { name: 'generate_image', arguments: {
        prompt: prompt.trim(), count: 1, size: imageGenerationSize,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        batchId: shotBatchId,
        ...(imageModel ? { model: imageModel, modelRef: imageModelRef } : {}),
        ...(imageGenerationExtraParams ? { params: imageGenerationExtraParams } : {}),
      }},
      { mode: 'queue' }
    );

    const taskId = (result as { taskId?: string; data?: { taskId?: string } }).taskId
      || (result.data as { taskId?: string } | undefined)?.taskId;
    if (!result.success || !taskId) return null;

    activeBatchTaskIdsRef.current.add(taskId);
    activeBatchTaskIdRef.current = taskId;
    setBatchVideoState(prev => ({
      ...prev,
      activeCount: activeBatchTaskIdsRef.current.size,
    }));

    let waitResult!: Awaited<ReturnType<typeof waitForBatchVideoTask>>;
    try {
      waitResult = await waitForBatchVideoTask(taskId, batchAbortControllerRef.current?.signal);
    } finally {
      activeBatchTaskIdsRef.current.delete(taskId);
      if (activeBatchTaskIdRef.current === taskId) {
        activeBatchTaskIdRef.current = null;
      }
      setBatchVideoState(prev => ({
        ...prev,
        activeCount: activeBatchTaskIdsRef.current.size,
      }));
    }
    if (!waitResult.success) return null;

    const task = waitResult.task || taskQueueService.getTask(taskId);
    return task?.result?.url || null;
  }, [record, generationProductInfo, imageGenerationExtraParams, imageGenerationSize, imageModel, imageModelRef, refImageUrls]);

  const generateFirstFrameForShot = useCallback((
    shot: VideoShot,
    currentCharacters: VideoCharacter[]
  ) => generateFrameForShot(shot, currentCharacters, 'first'), [generateFrameForShot]);

  const generateLastFrameForShot = useCallback((
    shot: VideoShot,
    currentCharacters: VideoCharacter[]
  ) => generateFrameForShot(shot, currentCharacters, 'last'), [generateFrameForShot]);

  const writeShotFirstFrameResult = useCallback(async (
    shotId: string,
    firstFrameUrl: string
  ) => {
    const latestShots = latestShotsRef.current;
    const shot = latestShots.find(item => item.id === shotId);
    if (!shot || shot.generated_first_frame_url === firstFrameUrl) {
      return latestShots;
    }
    const updatedShots = latestShots.map(item =>
      item.id === shotId ? { ...item, generated_first_frame_url: firstFrameUrl } : item
    );
    await applyUpdatedShots(updatedShots);
    return updatedShots;
  }, [applyUpdatedShots]);

  const writeShotLastFrameResult = useCallback(async (
    shotId: string,
    lastFrameUrl: string
  ) => {
    const latestShots = latestShotsRef.current;
    const shot = latestShots.find(item => item.id === shotId);
    if (!shot || shot.generated_last_frame_url === lastFrameUrl) {
      return latestShots;
    }
    const updatedShots = latestShots.map(item =>
      item.id === shotId ? { ...item, generated_last_frame_url: lastFrameUrl } : item
    );
    await applyUpdatedShots(updatedShots);
    return updatedShots;
  }, [applyUpdatedShots]);

  const getLatestShotById = useCallback((shotId: string) => {
    return latestShotsRef.current.find(item => item.id === shotId);
  }, []);

  const writeShotVideoResult = useCallback(async (
    shotId: string,
    videoUrl: string
  ) => {
    const shot = latestShotsRef.current.find(item => item.id === shotId);
    if (!shot || shot.generated_video_url === videoUrl) {
      return latestShotsRef.current;
    }
    const updatedShots = latestShotsRef.current.map(item =>
      item.id === shotId ? { ...item, generated_video_url: videoUrl } : item
    );
    await applyUpdatedShots(updatedShots);
    return updatedShots;
  }, [applyUpdatedShots]);

  const createBatchVideoTask = useCallback(async (
    shot: VideoShot,
    resolvedLastFrameUrl?: string
  ) => {
    const firstFrameUrl = shot.generated_first_frame_url;
    const lastFrameUrl = resolvedLastFrameUrl || shot.generated_last_frame_url;
    // 角色一致性通过首帧图实现，不再传 characterReferenceUrls 给视频模型
    const { referenceImages, referenceImageDescriptions } = buildBatchVideoReferenceImages({
      model: videoModel,
      firstFrameUrl,
      lastFrameUrl,
      extraReferenceUrls: refImageUrls,
    });
    const prompt = buildVideoPrompt(shot, record.analysis, generationProductInfo, {
      referenceImageDescriptions,
    });
    if (!prompt) {
      return null;
    }

    const shotBatchId = `va_${record.id}_shot${shot.id}_video`;
    const videoExtraParams = {
      ...splitVideoParams.extraParams,
      ...(videoModelConfig.provider === 'seedance'
        ? { aspect_ratio: selectedVideoAspectRatio }
        : {}),
    };

    const result = await mcpRegistry.executeTool(
      {
        name: 'generate_video',
        arguments: {
          prompt,
          size: splitVideoParams.size,
          seconds: splitVideoParams.duration,
          count: 1,
          batchId: shotBatchId,
          model: videoModel,
          modelRef: videoModelRef,
          referenceImages,
          params: Object.keys(videoExtraParams).length > 0 ? videoExtraParams : undefined,
        },
      },
      { mode: 'queue' }
    );

    const taskId = (result as { taskId?: string; data?: { taskId?: string } }).taskId
      || (result.data as { taskId?: string } | undefined)?.taskId;

    if (!result.success || !taskId) {
      throw new Error(result.error || '创建视频任务失败');
    }

    return taskId;
  }, [
    record.analysis,
    record.id,
    generationProductInfo,
    refImageUrls,
    splitVideoParams,
    videoModel,
    videoModelConfig.provider,
    videoModelRef,
    selectedVideoAspectRatio,
  ]);

  const stopBatchVideoGeneration = useCallback(() => {
    batchStopRef.current = true;
    setBatchVideoState(prev => prev.running ? { ...prev, stopping: true } : prev);
    if (activeBatchTaskIdRef.current) {
      taskQueueService.cancelTask(activeBatchTaskIdRef.current);
    }
    for (const taskId of activeBatchTaskIdsRef.current) {
      taskQueueService.cancelTask(taskId);
    }
    batchAbortControllerRef.current?.abort();
  }, []);

  const updateBatchActiveCount = useCallback(() => {
    setBatchVideoState(prev => ({
      ...prev,
      activeCount: activeBatchTaskIdsRef.current.size,
    }));
  }, []);

  const updateBatchVideoProgress = useCallback((index: number, retryCount: number) => {
    setBatchVideoState(prev => ({
      ...prev,
      currentIndex: index,
      retryCount,
      activeCount: activeBatchTaskIdsRef.current.size,
    }));
  }, []);

  useEffect(() => {
    return () => {
      batchStopRef.current = true;
      batchAbortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerateAllVideos = useCallback(async () => {
    if (batchVideoRunningRef.current || batchVideoState.running) {
      return;
    }
    batchVideoRunningRef.current = true;

    analytics.trackUIInteraction({
      area: 'popular_video_tool',
      action: 'batch_video_generation_started',
      control: 'generate_all_videos',
      source: 'video_analyzer_generate_page',
      metadata: {
        shotCount: latestShotsRef.current.length,
        insertToCanvasRequested: insertGeneratedVideosToCanvas,
        hasBoard: !!board,
      },
    });

    let shouldInsertToCanvas = insertGeneratedVideosToCanvas;
    if (shouldInsertToCanvas && !board) {
      MessagePlugin.warning('画布未就绪，本次将只生成不插入画布');
      shouldInsertToCanvas = false;
    }

    await ensureBatchId();
    batchStopRef.current = false;
    batchAbortControllerRef.current = new AbortController();
    activeBatchTaskIdRef.current = null;
    setBatchVideoState({
      running: true,
      stopping: false,
      currentIndex: -1,
      retryCount: 0,
      completedCount: 0,
      activeCount: 0,
    });

    try {
      // ── Step 0: 为缺少参考图的角色生成参考图 ──
      const currentCharacters = latestRecordRef.current.characters || latestRecordRef.current.analysis.characters || [];
      const charsNeedingRef = currentCharacters.filter(c => !c.referenceImageUrl);
      if (charsNeedingRef.length > 0 && !batchStopRef.current) {
        const characterRefResults = await Promise.all(charsNeedingRef.map(async (char) => {
          if (batchStopRef.current) return null;
          const charBatchId = `va_${record.id}_char${char.id}_ref`;
          const charPrompt = buildCharacterReferencePrompt(
            char,
            latestRecordRef.current.analysis,
            generationProductInfo
          );
          try {
            const result = await mcpRegistry.executeTool(
              { name: 'generate_image', arguments: {
                prompt: charPrompt,
                count: 1,
                size: imageGenerationSize,
                batchId: charBatchId,
                assetMetadata: {
                  category: AssetCategory.CHARACTER,
                  characterName: char.name,
                  characterPrompt: charPrompt,
                },
                ...(imageModel ? { model: imageModel, modelRef: imageModelRef } : {}),
                ...(imageGenerationExtraParams ? { params: imageGenerationExtraParams } : {}),
              }},
              { mode: 'queue' }
            );
            const taskId = (result as { taskId?: string; data?: { taskId?: string } }).taskId
              || (result.data as { taskId?: string } | undefined)?.taskId;
            if (!taskId) {
              return null;
            }

            activeBatchTaskIdRef.current = taskId;
            activeBatchTaskIdsRef.current.add(taskId);
            updateBatchActiveCount();

            let waitResult!: Awaited<ReturnType<typeof waitForBatchVideoTask>>;
            try {
              if (batchStopRef.current) {
                taskQueueService.cancelTask(taskId);
                return null;
              }
              waitResult = await waitForBatchVideoTask(taskId, batchAbortControllerRef.current?.signal);
            } finally {
              activeBatchTaskIdsRef.current.delete(taskId);
              if (activeBatchTaskIdRef.current === taskId) {
                activeBatchTaskIdRef.current = null;
              }
              updateBatchActiveCount();
            }
            if (!waitResult.success) {
              return null;
            }

            const task = waitResult.task || taskQueueService.getTask(taskId);
            const url = task?.result?.url;
            return url ? { charId: char.id, url } : null;
          } catch (error) {
            if (!batchStopRef.current) {
              console.error('[VideoAnalyzer] Character reference generation failed:', {
                characterId: char.id,
                error,
              });
            }
            return null;
          }
        }));

        const characterRefUpdates = characterRefResults.filter(
          (item): item is { charId: string; url: string } => !!item?.url
        );
        if (characterRefUpdates.length > 0) {
          const urlByCharacterId = new Map(
            characterRefUpdates.map(item => [item.charId, item.url])
          );
          const base = latestRecordRef.current.characters || latestRecordRef.current.analysis.characters || [];
          const updated = base.map(c => {
            const url = urlByCharacterId.get(c.id);
            return url ? { ...c, referenceImageUrl: url } : c;
          });
          await applyRecordPatch({ characters: updated });
        }
      }

      // ── Step 1: 先并行准备关键帧，再按每段依赖就绪启动视频 ──
      const batchShots = latestShotsRef.current;
      const markShotDone = () => {
        setBatchVideoState(prev => ({
          ...prev,
          completedCount: Math.min(prev.completedCount + 1, batchShots.length),
          activeCount: activeBatchTaskIdsRef.current.size,
        }));
      };
      const framePromises = new Map<
        string,
        {
          first?: Promise<string | null>;
          last?: Promise<string | null>;
        }
      >();
      const ensureFirstFrame = (shot: VideoShot) => {
        const latestShot = getLatestShotById(shot.id) || shot;
        if (latestShot.generated_first_frame_url) {
          return Promise.resolve(latestShot.generated_first_frame_url);
        }
        const cached = framePromises.get(shot.id)?.first;
        if (cached) {
          return cached;
        }
        const promise = (async () => {
          const pipelineCharacters = latestRecordRef.current.characters || latestRecordRef.current.analysis.characters || [];
          const firstFrameUrl = await generateFirstFrameForShot(latestShot, pipelineCharacters);
          if (firstFrameUrl && !batchStopRef.current) {
            await writeShotFirstFrameResult(latestShot.id, firstFrameUrl);
          }
          return firstFrameUrl;
        })();
        framePromises.set(shot.id, {
          ...(framePromises.get(shot.id) || {}),
          first: promise,
        });
        return promise;
      };
      const ensureOwnLastFrame = (shot: VideoShot) => {
        const latestShot = getLatestShotById(shot.id) || shot;
        if (latestShot.generated_last_frame_url) {
          return Promise.resolve(latestShot.generated_last_frame_url);
        }
        if (!latestShot.last_frame_prompt?.trim()) {
          return Promise.resolve(null);
        }
        const cached = framePromises.get(shot.id)?.last;
        if (cached) {
          return cached;
        }
        const promise = (async () => {
          const pipelineCharacters = latestRecordRef.current.characters || latestRecordRef.current.analysis.characters || [];
          const lastFrameUrl = await generateLastFrameForShot(latestShot, pipelineCharacters);
          if (lastFrameUrl && !batchStopRef.current) {
            await writeShotLastFrameResult(latestShot.id, lastFrameUrl);
          }
          return lastFrameUrl;
        })();
        framePromises.set(shot.id, {
          ...(framePromises.get(shot.id) || {}),
          last: promise,
        });
        return promise;
      };

      for (let index = 0; index < batchShots.length; index += 1) {
        const shot = batchShots[index];
        const nextShot = batchShots[index + 1];
        void ensureFirstFrame(shot).catch((error) => {
          if (!batchStopRef.current) {
            console.error('[VideoAnalyzer] Batch first frame generation failed:', {
              shotId: shot.id,
              error,
            });
          }
          return null;
        });
        if (nextShot && !shot.generated_last_frame_url && !shot.last_frame_prompt?.trim()) {
          void ensureFirstFrame(nextShot).catch((error) => {
            if (!batchStopRef.current) {
              console.error('[VideoAnalyzer] Batch next first frame generation failed:', {
                shotId: nextShot.id,
                error,
              });
            }
            return null;
          });
        } else if (shot.last_frame_prompt?.trim()) {
          void ensureOwnLastFrame(shot).catch((error) => {
            if (!batchStopRef.current) {
              console.error('[VideoAnalyzer] Batch last frame generation failed:', {
                shotId: shot.id,
                error,
              });
            }
            return null;
          });
        }
      }

      const runShotPipeline = async (shot: VideoShot, index: number) => {
        try {
          if (batchStopRef.current) {
            return;
          }

          setBatchVideoState(prev => ({
            ...prev,
            currentIndex: index,
          }));

          let currentShot = getLatestShotById(shot.id) || shot;
          if (currentShot.generated_video_url) {
            if (shouldInsertToCanvas) {
              await insertGeneratedVideoToCanvas(currentShot.generated_video_url);
            }
            return;
          }

          const firstFrameUrl = await ensureFirstFrame(currentShot);
          if (firstFrameUrl) {
            currentShot = {
              ...currentShot,
              generated_first_frame_url: firstFrameUrl,
            };
          }

          if (batchStopRef.current) {
            return;
          }

          currentShot = getLatestShotById(shot.id) || currentShot;
          if (!currentShot.generated_first_frame_url) {
            return;
          }

          let resolvedLastFrameUrl = currentShot.generated_last_frame_url;
          if (!resolvedLastFrameUrl) {
            if (currentShot.last_frame_prompt?.trim()) {
              resolvedLastFrameUrl = (await ensureOwnLastFrame(currentShot)) || undefined;
            } else {
              const nextShot = batchShots[index + 1];
              resolvedLastFrameUrl = nextShot
                ? (await ensureFirstFrame(nextShot)) || undefined
                : undefined;
            }
          }

          if (batchStopRef.current) {
            return;
          }

          let retryCount = 0;
          let taskId: string | null = null;

          while (!batchStopRef.current) {
            if (!taskId) {
              taskId = await createBatchVideoTask(
                getLatestShotById(currentShot.id) || currentShot,
                resolvedLastFrameUrl
              );
            }

            if (!taskId) {
              break;
            }

            batchCreatedVideoTaskIdsRef.current.add(taskId);
            activeBatchTaskIdRef.current = taskId;
            activeBatchTaskIdsRef.current.add(taskId);
            updateBatchVideoProgress(index, retryCount);

            let waitResult!: Awaited<ReturnType<typeof waitForBatchVideoTask>>;
            try {
              waitResult = await waitForBatchVideoTask(
                taskId,
                batchAbortControllerRef.current?.signal
              );
            } finally {
              activeBatchTaskIdsRef.current.delete(taskId);
              if (activeBatchTaskIdRef.current === taskId) {
                activeBatchTaskIdRef.current = null;
              }
              updateBatchActiveCount();
            }

            if (batchStopRef.current) {
              break;
            }

            const task = waitResult.task || taskQueueService.getTask(taskId);
            const videoUrl = task?.result?.url;

            if (waitResult.success && task && videoUrl) {
              await writeShotVideoResult(currentShot.id, videoUrl);
              if (shouldInsertToCanvas) {
                await insertGeneratedVideoToCanvas(
                  videoUrl,
                  typeof task.params.prompt === 'string'
                    ? task.params.prompt
                    : undefined
                );
              }
              break;
            }

            if (task?.status === TaskStatus.FAILED) {
              const nonRetryableReason = getNonRetryableBatchVideoFailureReason(
                task,
                waitResult.error
              );
              if (nonRetryableReason) {
                batchStopRef.current = true;
                for (const activeTaskId of activeBatchTaskIdsRef.current) {
                  taskQueueService.cancelTask(activeTaskId);
                }
                activeBatchTaskIdsRef.current.clear();
                activeBatchTaskIdRef.current = null;
                batchAbortControllerRef.current?.abort();
                MessagePlugin.error(
                  `视频生成失败且不可重试，已停止：${nonRetryableReason}`
                );
                break;
              }

              retryCount += 1;
              updateBatchVideoProgress(index, retryCount);
              taskQueueService.retryTask(taskId);
              continue;
            }

            taskId = null;
          }
        } catch (error) {
          if (!batchStopRef.current) {
            console.error('[VideoAnalyzer] Batch shot pipeline failed:', {
              shotId: shot.id,
              error,
            });
          }
        } finally {
          markShotDone();
        }
      };

      await Promise.all(batchShots.map((shot, index) => runShotPipeline(shot, index)));
    } finally {
      batchVideoRunningRef.current = false;
      activeBatchTaskIdRef.current = null;
      activeBatchTaskIdsRef.current.clear();
      batchAbortControllerRef.current = null;
      setBatchVideoState({
        running: false,
        stopping: false,
        currentIndex: -1,
        retryCount: 0,
        completedCount: 0,
        activeCount: 0,
      });
    }
  }, [
    batchVideoState.running,
    createBatchVideoTask,
    ensureBatchId,
    generateFirstFrameForShot,
    generateLastFrameForShot,
    applyRecordPatch,
    getLatestShotById,
    record.id,
    record.analysis,
    generationProductInfo,
    imageModel,
    imageGenerationExtraParams,
    imageGenerationSize,
    imageModelRef,
    insertGeneratedVideoToCanvas,
    insertGeneratedVideosToCanvas,
    updateBatchActiveCount,
    updateBatchVideoProgress,
    writeShotFirstFrameResult,
    writeShotLastFrameResult,
    writeShotVideoResult,
    board,
  ]);

  const handleResetAllGenerated = useCallback(async () => {
    const resetResult = buildVideoAnalyzerResetPayload(
      latestRecordRef.current,
      latestShotsRef.current
    );
    await applyRecordPatch({
      ...updateActiveShotsInRecord(latestRecordRef.current, resetResult.shots),
      characters: resetResult.characters,
      generatedAssetsResetAt: Date.now(),
    });
  }, [applyRecordPatch]);

  const thumbStyle = useMemo(() => {
    const [w, h] = selectedVideoAspectRatio.split(':').map(Number);
    if (!w || !h) return {};
    const computedW = Math.round(54 * w / h);
    return {
      width: Math.max(computedW, 48),
      height: computedW < 48 ? Math.round(48 * h / w) : 54,
    };
  }, [selectedVideoAspectRatio]);

  return (
    <div className="va-page">
      {/* 批量生成配置 */}
      <div className="va-batch-config">
        <div className="va-batch-config-title">批量生成配置</div>
        <ReferenceImageUpload
          images={refImages}
          onImagesChange={setRefImages}
          multiple
          label="参考图 (可选)"
        />
        {/* 角色管理：每个角色独立设置参考图 */}
        {characters.length > 0 && (
          <div className="va-characters">
            <div className="va-characters-title">角色</div>
            {characters.map(char => (
              <div key={char.id} className="va-character-item">
                <div className="va-character-info">
                  <span className="va-character-name">{char.name}</span>
                  <span className="va-character-desc">{char.description}</span>
                </div>
                <div className="va-character-ref">
                  {char.referenceImageUrl ? (
                    <div className="va-character-ref-thumb">
                      <RetryImage
                        src={char.referenceImageUrl}
                        alt={char.name}
                        showSkeleton={false}
                        eager
                      />
                      <button
                        className="va-shot-frame-delete"
                        onClick={() => void handleCharacterRefImageChange(char.id, undefined)}
                      >×</button>
                    </div>
                  ) : (
                    <span className="va-character-ref-empty">未设置</span>
                  )}
                  <button onClick={() => handleGenerateCharacterRef(char)}>生成</button>
                  <button onClick={() => setCharLibraryTarget(char.id)}>选主体</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="va-product-form">
          <div className="va-model-select">
            <label className="va-model-label">图片模型</label>
            <ModelDropdown
              variant="form"
              selectedModel={imageModel}
              selectedSelectionKey={getSelectionKey(imageModel, imageModelRef)}
              onSelect={setImageModel}
              models={imageModels}
              placement="down"
              placeholder="选择图片模型"
            />
            {compatibleImageParams.length > 0 && (
              <ParametersDropdown
                selectedParams={imageSelectedParams}
                onParamChange={handleImageParamChange}
                compatibleParams={compatibleImageParams}
                modelId={imageModel}
                placement="down"
              />
            )}
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
              placeholder="选择视频模型"
            />
            {compatibleVideoParams.length > 0 && (
              <ParametersDropdown
                selectedParams={videoSelectedParams}
                onParamChange={handleVideoParamChange}
                compatibleParams={compatibleVideoParams}
                modelId={videoModel}
                placement="down"
              />
            )}
          </div>
        </div>
        {batchVideoState.running && (
          <div className="va-batch-config-title">
            正在并行生成 {batchVideoState.completedCount}/{shots.length} 段
            {batchVideoState.activeCount > 0 ? `，运行中 ${batchVideoState.activeCount} 个任务` : ''}
            {batchVideoState.retryCount > 0 ? `，已重试 ${batchVideoState.retryCount} 次` : ''}
          </div>
        )}
        <div className="va-page-actions">
          {onRestart && <button onClick={onRestart}>重新分析</button>}
          <button onClick={handleResetAllGenerated}>重置生成</button>
          <label className="va-inline-checkbox">
            <input
              type="checkbox"
              checked={insertGeneratedVideosToCanvas}
              onChange={e => setInsertGeneratedVideosToCanvas(e.target.checked)}
            />
            生成后插入画布
          </label>
          <button onClick={handleGenerateAllVideos} disabled={batchVideoState.running}>全部→生成视频</button>
          {batchVideoState.running && (
            <button onClick={stopBatchVideoGeneration}>
              {batchVideoState.stopping ? '停止中…' : '停止全部生成'}
            </button>
          )}
        </div>
      </div>

      {/* 镜头列表 */}
      <div className="va-shots">
        {shots.map((shot, i) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            index={i}
            actions={
              <>
                {/* 首帧 */}
                {shot.generated_first_frame_url ? (
                  <div
                    className="va-shot-frame-thumb"
                    style={thumbStyle}
                    onMouseEnter={e => handleThumbEnter(shot.generated_first_frame_url!, 'image', e)}
                    onMouseLeave={handleThumbLeave}
                  >
                    <RetryImage
                      src={shot.generated_first_frame_url}
                      alt="首帧"
                      showSkeleton={false}
                      eager
                      onClick={() => handleShotGenerateFirstFrame(shot)}
                    />
                  <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'first')}>×</button>
                  <button className="va-shot-frame-regen" onClick={() => handleShotGenerateFirstFrame(shot)}>↻</button>
                  </div>
                ) : (shot.first_frame_prompt || shot.description) ? (
                  <span className="va-shot-frame-btn-group">
                    <button onClick={() => handleShotGenerateFirstFrame(shot)}>生成首帧</button>
                    <button
                      className="va-shot-frame-library-btn"
                      onClick={() => handlePickFromLibrary(shot.id, 'first')}
                    >
                      <HoverTip content="从素材库选择" showArrow={false}>
                        <span>
                          <MediaLibraryGridIcon />
                        </span>
                      </HoverTip>
                    </button>
                  </span>
                ) : null}
                {/* 尾帧 */}
                {(() => {
                  const lastFrameUrl = shot.generated_last_frame_url || getLastFrameUrl(shot, i);
                  const isFromNextShot = !shot.generated_last_frame_url && lastFrameUrl;
                  if (shot.generated_last_frame_url) {
                    return (
                      <div
                        className="va-shot-frame-thumb"
                        style={thumbStyle}
                        onMouseEnter={e => handleThumbEnter(shot.generated_last_frame_url!, 'image', e)}
                        onMouseLeave={handleThumbLeave}
                      >
                        <RetryImage
                          src={shot.generated_last_frame_url}
                          alt="尾帧"
                          showSkeleton={false}
                          eager
                          onClick={() => handleShotGenerateLastFrame(shot, i)}
                        />
                        <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'last')}>×</button>
                        <button className="va-shot-frame-regen" onClick={() => handleShotGenerateLastFrame(shot, i)}>↻</button>
                      </div>
                    );
                  }
                  if (isFromNextShot) {
                    return (
                      <div
                        className="va-shot-frame-thumb va-shot-frame-thumb--borrowed"
                        style={thumbStyle}
                        onMouseEnter={e => handleThumbEnter(lastFrameUrl!, 'image', e)}
                        onMouseLeave={handleThumbLeave}
                      >
                        <RetryImage
                          src={lastFrameUrl}
                          alt="尾帧(下一镜头首帧)"
                          showSkeleton={false}
                          eager
                          onClick={() => handleShotGenerateLastFrame(shot, i)}
                        />
                        <span className="va-shot-frame-label">下一镜头首帧</span>
                      </div>
                    );
                  }
                  if (shot.last_frame_prompt?.trim()) {
                    return (
                      <span className="va-shot-frame-btn-group">
                        <button onClick={() => handleShotGenerateLastFrame(shot, i)}>生成尾帧</button>
                        <button
                          className="va-shot-frame-library-btn"
                          onClick={() => handlePickFromLibrary(shot.id, 'last')}
                        >
                          <HoverTip content="从素材库选择" showArrow={false}>
                            <span>
                              <MediaLibraryGridIcon />
                            </span>
                          </HoverTip>
                        </button>
                      </span>
                    );
                  }
                  return null;
                })()}
                {/* 视频 */}
                {shot.generated_video_url ? (
                  <div
                    className="va-shot-frame-thumb"
                    style={thumbStyle}
                    onMouseEnter={e => handleThumbEnter(shot.generated_video_url!, 'video', e)}
                    onMouseLeave={handleThumbLeave}
                  >
                    <VideoPosterPreview
                      src={shot.generated_video_url}
                      alt="生成视频缩略图"
                      className="va-shot-frame-media"
                      thumbnailSize="small"
                      onClick={() => handleShotGenerateVideo(shot, i)}
                      videoProps={{
                        muted: true,
                        preload: 'metadata',
                      }}
                    />
                    <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'video')}>×</button>
                    <button className="va-shot-frame-regen" onClick={() => handleShotGenerateVideo(shot, i)}>↻</button>
                  </div>
                ) : (shot.description || shot.narration || shot.dialogue || shot.camera_movement || shot.first_frame_prompt || shot.last_frame_prompt) ? (
                  <span className="va-shot-frame-btn-group">
                    <button onClick={() => handleShotGenerateVideo(shot, i)}>生成视频</button>
                    <button
                      className="va-shot-frame-library-btn"
                      onClick={() => handlePickFromLibrary(shot.id, 'video')}
                    >
                      <HoverTip content="从素材库插入视频" showArrow={false}>
                        <span>
                          <MediaLibraryGridIcon />
                        </span>
                      </HoverTip>
                    </button>
                  </span>
                ) : null}
              </>
            }
          />
        ))}
      </div>

      <div className="va-page-actions mv-generate-footer-actions">
        <button onClick={() => void handleInsertScriptToCanvas()} disabled={shots.length === 0 || !board}>
          脚本插入画布
        </button>
        <button onClick={() => void handleDownloadAssetsZip()} disabled={isExportingAssets || shots.length === 0}>
          {isExportingAssets ? `素材下载 ${exportProgress}%` : '素材下载 ZIP'}
        </button>
      </div>
      <div className="mv-generate-footer-hint">
        若有素材未打包成功，解压后在 ZIP 根目录运行 `sh 00.补全下载.sh` 即可按 manifest 补全下载。
      </div>

      {/* 素材库选择弹窗 */}
      <MediaLibraryModal
        isOpen={!!libraryTarget}
        onClose={() => setLibraryTarget(null)}
        mode={SelectionMode.SELECT}
        filterType={libraryTarget?.assetType === 'video' ? AssetType.VIDEO : AssetType.IMAGE}
        onSelect={handleLibrarySelect}
        selectButtonText={libraryTarget?.assetType === 'video' ? '使用此视频' : '使用此图片'}
      />
      {/* 角色参考图素材库弹窗 */}
      <MediaLibraryModal
        isOpen={!!charLibraryTarget}
        onClose={() => setCharLibraryTarget(null)}
        mode={SelectionMode.SELECT}
        filterType={AssetType.IMAGE}
        filterCategory={AssetCategory.CHARACTER}
        onSelect={(asset: Asset) => {
          if (charLibraryTarget) {
            const current = latestRecordRef.current;
            const char = (current.characters || current.analysis.characters || [])
              .find(c => c.id === charLibraryTarget);
            void handleCharacterRefImageChange(charLibraryTarget, asset.url);
            if (char) {
              markAssetAsCharacter(asset, {
                name: char.name,
                prompt: char.description,
              }).catch((error) => {
                console.warn('[VideoAnalyzer] Failed to mark asset as character:', error);
              });
            }
          }
          setCharLibraryTarget(null);
        }}
        selectButtonText="使用此主体"
      />

      {hoverPreview && ReactDOM.createPortal(
        <div
          className="mv-hover-preview"
          style={{ left: `${hoverPreview.x}px`, top: `${hoverPreview.y}px` }}
          onMouseEnter={handleHoverPreviewEnter}
          onMouseLeave={handleHoverPreviewLeave}
        >
          {hoverPreview.type === 'image' ? (
            <RetryImage
              src={hoverPreview.url}
              alt="Preview"
              showSkeleton={false}
              eager
            />
          ) : (
            <video src={hoverPreview.url} controls muted preload="metadata" />
          )}
        </div>,
        document.body
      )}
    </div>
  );
};
