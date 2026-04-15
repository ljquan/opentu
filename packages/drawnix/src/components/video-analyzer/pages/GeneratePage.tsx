/**
 * 素材生成页 - 单镜头弹窗生成 + 底部批量配置
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { AnalysisRecord, VideoShot } from '../types';
import { migrateProductInfo } from '../types';
import { getValidVideoSize, getVideoModelConfig } from '../../../constants/video-model-config';
import { mcpRegistry } from '../../../mcp/registry';
import { updateRecord } from '../storage';
import { MediaLibraryModal } from '../../media-library';
import { SelectionMode, AssetType } from '../../../types/asset.types';
import type { Asset } from '../../../types/asset.types';
import { ShotCard } from '../components/ShotCard';
import { buildVideoPrompt, buildFramePrompt } from '../utils';
import { ReferenceImageUpload } from '../../ttd-dialog/shared';
import type { ReferenceImage } from '../../ttd-dialog/shared';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { useDrawnix, DialogType } from '../../../hooks/use-drawnix';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import { TaskStatus } from '../../../types/task.types';
import { taskQueueService } from '../../../services/task-queue';
import { extractFrameFromUrl } from '../../../utils/video-frame-cache';
import { buildBatchVideoReferenceImages, waitForBatchVideoTask } from '../../../utils/batch-video-generation';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
  updateActiveShotsInRecord,
} from '../utils';

const STORAGE_KEY_IMAGE_MODEL = 'video-analyzer:image-model';
const STORAGE_KEY_VIDEO_MODEL = 'video-analyzer:video-model';

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
  const { openDialog } = useDrawnix();
  const latestRecordRef = useRef(record);
  const latestShotsRef = useRef(shots);
  const batchStopRef = useRef(false);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const activeBatchTaskIdRef = useRef<string | null>(null);

  const [refImages, setRefImages] = useState<ReferenceImage[]>([]);
  const imageModels = useSelectableModels('image');
  const videoModels = useSelectableModels('video');
  const [imageModel, setImageModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, '').modelId
  );
  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, '').modelRef
  );
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
  const [videoSize, setVideoSizeState] = useState<string>(
    () => getValidVideoSize(
      record.productInfo?.videoModel || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId,
      record.productInfo?.videoSize
    )
  );
  const [segmentDuration, setSegmentDuration] = useState<number>(
    () => record.productInfo?.segmentDuration || parseInt(getVideoModelConfig(record.productInfo?.videoModel || 'veo3').defaultDuration, 10) || 8
  );
  const [batchVideoState, setBatchVideoState] = useState({
    running: false,
    stopping: false,
    currentIndex: -1,
    retryCount: 0,
  });

  const videoModelConfig = useMemo(() => getVideoModelConfig(videoModel), [videoModel]);
  const durationOptions = useMemo(() => videoModelConfig.durationOptions, [videoModelConfig]);
  const sizeOptions = useMemo(() => videoModelConfig.sizeOptions, [videoModelConfig]);

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

  const setImageModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setImageModelState(model);
    setImageModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, model, modelRef);
  }, []);

  const setVideoModel = useCallback((model: string, modelRef?: ModelRef | null) => {
    setVideoModelState(model);
    setVideoModelRef(modelRef || null);
    writeStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, model, modelRef);
    const cfg = getVideoModelConfig(model);
    const nextSegmentDuration = parseInt(cfg.defaultDuration, 10) || 8;
    const nextVideoSize = getValidVideoSize(model, videoSize);
    setSegmentDuration(nextSegmentDuration);
    setVideoSizeState(nextVideoSize);
    void applyProductInfoPatch({
      videoModel: model,
      videoModelRef: modelRef || null,
      segmentDuration: nextSegmentDuration,
      videoSize: nextVideoSize,
    });
  }, [applyProductInfoPatch, videoSize]);

  const handleSegmentDurationChange = useCallback((value: number) => {
    setSegmentDuration(value);
    void applyProductInfoPatch({ segmentDuration: value });
  }, [applyProductInfoPatch]);

  const handleVideoSizeChange = useCallback((value: string) => {
    const nextVideoSize = getValidVideoSize(videoModel, value);
    setVideoSizeState(nextVideoSize);
    void applyProductInfoPatch({ videoSize: nextVideoSize });
  }, [applyProductInfoPatch, videoModel]);

  // 参考图 URL 列表（用于传给批量生成接口）
  const refImageUrls = useMemo(() => refImages.map(img => img.url).filter(Boolean), [refImages]);

  // 确保 batchId 已保存
  const ensureBatchId = useCallback(async () => {
    if (!record.batchId) {
      await applyRecordPatch({ batchId });
    }
  }, [record.batchId, batchId, applyRecordPatch]);

  // --- Prompt 提取 ---
  const getFirstFramePrompt = useCallback((shot: VideoShot) => {
    return shot.first_frame_prompt || shot.description || '';
  }, []);

  const getLastFramePrompt = useCallback((shot: VideoShot) => {
    return shot.last_frame_prompt || shot.description || '';
  }, []);

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
    let hasUpdate = false;
    const currentRecord = record;
    let currentShots = currentRecord.editedShots || currentRecord.analysis.shots;
    const newVideoShots: Array<{ shotId: string; videoUrl: string }> = [];

    for (const task of allTasks) {
      if (task.status !== TaskStatus.COMPLETED) continue;
      if (processedTaskIdsRef.current.has(task.id)) continue;
      const taskBatchId = task.params?.batchId as string | undefined;
      if (!taskBatchId || !taskBatchId.startsWith(prefix)) continue;
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
      const suppressedUrl = shot?.suppressed_generated_urls?.[frameType];
      if (suppressedUrl && suppressedUrl === resultUrl) {
        processedTaskIdsRef.current.add(task.id);
        continue;
      }
      if (!shot || shot[field] === resultUrl) {
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
        newVideoShots.push({ shotId, videoUrl: resultUrl });
      }
    }

    if (hasUpdate) {
      void updateRecord(currentRecord.id, updateActiveShotsInRecord(currentRecord, currentShots)).then(updated => {
        onRecordsChange(updated);
        onRecordUpdate({ ...currentRecord, editedShots: currentShots });
      });
    }

    if (newVideoShots.length > 0) {
      void autoFillAdjacentFrames(currentRecord.id, currentShots, newVideoShots);
    }
  }, [allTasks, autoFillAdjacentFrames, record, onRecordUpdate, onRecordsChange]);

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

  // --- 单镜头：打开图片生成弹窗 ---
  // 视频 aspect_ratio (16x9) → 图片 aspectRatio (16:9)
  const imageAspectRatio = aspectRatio.replace('x', ':');
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
    const prompt = buildFramePrompt(rawPrompt, record.analysis, record.productInfo);
    const draft = shot.first_frame_draft;
    const shotBatchId = `va_${record.id}_shot${shot.id}_first`;
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: draft?.prompt ?? prompt,
      batchId: shotBatchId,
      initialAspectRatio: draft?.aspectRatio ?? imageAspectRatio,
      initialImages: draft
        ? toDraftImages(draft.images || [])
        : shot.generated_first_frame_url
          ? [{ url: shot.generated_first_frame_url, name: '首帧' }]
          : undefined,
      onDraftChange: (nextDraft: {
        prompt: string;
        images: Array<{ url: string; name: string }>;
        aspectRatio?: string;
      }) => saveShotDraft(shot.id, 'first', nextDraft),
    });
  }, [record, openDialog, imageAspectRatio, saveShotDraft, toDraftImages]);

  // 获取 shot 的尾帧 URL（优先使用已生成的，否则使用下一个 shot 的首帧）
  const getLastFrameUrl = useCallback((shot: VideoShot, index: number) => {
    if (shot.generated_last_frame_url) {
      return shot.generated_last_frame_url;
    }
    const nextShot = shots[index + 1];
    return nextShot?.generated_first_frame_url;
  }, [shots]);

  const handleShotGenerateLastFrame = useCallback((shot: VideoShot, index: number) => {
    const rawPrompt = shot.last_frame_prompt || shot.description || '';
    if (!rawPrompt) return;
    const prompt = buildFramePrompt(rawPrompt, record.analysis, record.productInfo);
    const draft = shot.last_frame_draft;
    const shotBatchId = `va_${record.id}_shot${shot.id}_last`;
    const lastFrameUrl = getLastFrameUrl(shot, index);
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: draft?.prompt ?? prompt,
      batchId: shotBatchId,
      initialAspectRatio: draft?.aspectRatio ?? imageAspectRatio,
      initialImages: draft
        ? toDraftImages(draft.images || [])
        : lastFrameUrl
          ? [{ url: lastFrameUrl, name: '尾帧' }]
          : undefined,
      onDraftChange: (nextDraft: {
        prompt: string;
        images: Array<{ url: string; name: string }>;
        aspectRatio?: string;
      }) => saveShotDraft(shot.id, 'last', nextDraft),
    });
  }, [record, openDialog, getLastFrameUrl, imageAspectRatio, saveShotDraft, toDraftImages]);

  // --- 单镜头：打开视频生成弹窗 ---
  const handleShotGenerateVideo = useCallback((shot: VideoShot, index: number) => {
    const prompt = buildVideoPrompt(shot, record.analysis, record.productInfo);
    if (!prompt) return;
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
    openDialog(DialogType.aiVideoGeneration, {
      initialPrompt: draft?.prompt ?? prompt,
      initialImages: draft
        ? toDraftImages(draft.images || [])
        : initialImages.length > 0
          ? initialImages
          : undefined,
      initialDuration: draft?.duration ?? segmentDuration,
      initialSize: draft?.size ?? videoSize,
      batchId: shotBatchId,
      onDraftChange: (nextDraft: {
        prompt: string;
        images: Array<{ url: string; name: string }>;
        duration?: number;
        size?: string;
      }) => saveShotDraft(shot.id, 'video', nextDraft),
    });
  }, [record.id, segmentDuration, videoSize, openDialog, getLastFrameUrl, record.analysis, record.productInfo, saveShotDraft, toDraftImages]);

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

  const handleGenerateAllFirstFrames = useCallback(async () => {
    await ensureBatchId();
    for (const shot of shots) {
      const rawPrompt = getFirstFramePrompt(shot);
      if (!rawPrompt) continue;
      const prompt = buildFramePrompt(rawPrompt, record.analysis, record.productInfo);
      const shotBatchId = `va_${record.id}_shot${shot.id}_first`;
      await mcpRegistry.executeTool(
        { name: 'generate_image', arguments: {
          prompt: prompt.trim(), count: 1, size: aspectRatio,
          referenceImages: refImageUrls.length > 0 ? refImageUrls : undefined,
          batchId: shotBatchId,
          ...(imageModel ? { model: imageModel, modelRef: imageModelRef } : {}),
        }},
        { mode: 'queue' }
      );
    }
  }, [shots, record, ensureBatchId, getFirstFramePrompt, aspectRatio, refImageUrls, imageModel, imageModelRef]);

  const handleGenerateAllLastFrames = useCallback(async () => {
    await ensureBatchId();
    for (const shot of shots) {
      const rawPrompt = getLastFramePrompt(shot);
      if (!rawPrompt) continue;
      const prompt = buildFramePrompt(rawPrompt, record.analysis, record.productInfo);
      const shotBatchId = `va_${record.id}_shot${shot.id}_last`;
      await mcpRegistry.executeTool(
        { name: 'generate_image', arguments: {
          prompt: prompt.trim(), count: 1, size: aspectRatio,
          referenceImages: refImageUrls.length > 0 ? refImageUrls : undefined,
          batchId: shotBatchId,
          ...(imageModel ? { model: imageModel, modelRef: imageModelRef } : {}),
        }},
        { mode: 'queue' }
      );
    }
  }, [shots, record, ensureBatchId, getLastFramePrompt, aspectRatio, refImageUrls, imageModel, imageModelRef]);

  const propagateTailFrameToNextShot = useCallback(async (
    currentShots: VideoShot[],
    index: number,
    videoUrl: string
  ) => {
    const nextShot = currentShots[index + 1];
    if (!nextShot) {
      return currentShots;
    }

    const nextFirstFrameUrl = await extractFrameFromUrl(videoUrl, nextShot.id, 'first', 'last');
    if (!nextFirstFrameUrl || nextShot.generated_first_frame_url === nextFirstFrameUrl) {
      return currentShots;
    }

    const updatedShots = currentShots.map((item, shotIndex) =>
      shotIndex === index + 1
        ? { ...item, generated_first_frame_url: nextFirstFrameUrl }
        : item
    );
    await applyUpdatedShots(updatedShots);
    return updatedShots;
  }, [applyUpdatedShots]);

  const writeShotVideoResult = useCallback(async (
    currentShots: VideoShot[],
    index: number,
    videoUrl: string
  ) => {
    const shot = currentShots[index];
    if (!shot || shot.generated_video_url === videoUrl) {
      return currentShots;
    }
    const updatedShots = currentShots.map((item, shotIndex) =>
      shotIndex === index ? { ...item, generated_video_url: videoUrl } : item
    );
    await applyUpdatedShots(updatedShots);
    return updatedShots;
  }, [applyUpdatedShots]);

  const createBatchVideoTask = useCallback(async (
    shot: VideoShot,
    index: number,
    currentShots: VideoShot[]
  ) => {
    const prompt = buildVideoPrompt(shot, record.analysis, record.productInfo);
    if (!prompt) {
      return null;
    }

    const firstFrameUrl = index === 0 ? refImageUrls[0] : shot.generated_first_frame_url;
    const lastFrameUrl = shot.generated_last_frame_url || currentShots[index + 1]?.generated_first_frame_url;
    const referenceImages = buildBatchVideoReferenceImages({
      model: videoModel,
      firstFrameUrl,
      lastFrameUrl,
      extraReferenceUrls: refImageUrls.slice(index === 0 ? 1 : 0),
    });
    const shotBatchId = `va_${record.id}_shot${shot.id}_video`;

    const result = await mcpRegistry.executeTool(
      {
        name: 'generate_video',
        arguments: {
          prompt,
          size: videoSize,
          seconds: String(segmentDuration),
          count: 1,
          batchId: shotBatchId,
          model: videoModel,
          modelRef: videoModelRef,
          referenceImages,
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
    record.productInfo,
    refImageUrls,
    segmentDuration,
    videoModel,
    videoModelRef,
    videoSize,
  ]);

  const stopBatchVideoGeneration = useCallback(() => {
    batchStopRef.current = true;
    setBatchVideoState(prev => prev.running ? { ...prev, stopping: true } : prev);
    if (activeBatchTaskIdRef.current) {
      taskQueueService.cancelTask(activeBatchTaskIdRef.current);
    }
    batchAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      batchStopRef.current = true;
      batchAbortControllerRef.current?.abort();
    };
  }, []);

  const handleGenerateAllVideos = useCallback(async () => {
    if (batchVideoState.running) {
      return;
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
    });

    try {
      let currentShots = latestShotsRef.current;

      for (let index = 0; index < currentShots.length; index++) {
        if (batchStopRef.current) {
          break;
        }

        currentShots = latestShotsRef.current;
        const shot = currentShots[index];
        if (!shot) {
          continue;
        }

        const prompt = buildVideoPrompt(shot, record.analysis, record.productInfo);
        if (!prompt) {
          continue;
        }

        setBatchVideoState(prev => ({
          ...prev,
          currentIndex: index,
          retryCount: 0,
        }));

        if (shot.generated_video_url) {
          currentShots = await propagateTailFrameToNextShot(currentShots, index, shot.generated_video_url);
          continue;
        }

        let retryCount = 0;
        let taskId: string | null = null;

        while (!batchStopRef.current) {
          if (!taskId) {
            taskId = await createBatchVideoTask(shot, index, currentShots);
          }

          if (!taskId) {
            break;
          }

          activeBatchTaskIdRef.current = taskId;
          setBatchVideoState({
            running: true,
            stopping: false,
            currentIndex: index,
            retryCount,
          });

          const waitResult = await waitForBatchVideoTask(
            taskId,
            batchAbortControllerRef.current?.signal
          );

          if (batchStopRef.current) {
            break;
          }

          const task = waitResult.task || taskQueueService.getTask(taskId);
          const videoUrl = task?.result?.url;

          if (waitResult.success && task && videoUrl) {
            currentShots = await writeShotVideoResult(currentShots, index, videoUrl);
            currentShots = await propagateTailFrameToNextShot(currentShots, index, videoUrl);
            break;
          }

          retryCount += 1;
          setBatchVideoState({
            running: true,
            stopping: false,
            currentIndex: index,
            retryCount,
          });

          if (task?.status === TaskStatus.FAILED) {
            taskQueueService.retryTask(taskId);
            continue;
          }

          taskId = null;
        }

        activeBatchTaskIdRef.current = null;
      }
    } finally {
      activeBatchTaskIdRef.current = null;
      batchAbortControllerRef.current = null;
      setBatchVideoState({
        running: false,
        stopping: false,
        currentIndex: -1,
        retryCount: 0,
      });
    }
  }, [
    batchVideoState.running,
    createBatchVideoTask,
    ensureBatchId,
    propagateTailFrameToNextShot,
    record.analysis,
    record.productInfo,
    writeShotVideoResult,
  ]);

  return (
    <div className="va-page">
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
                  <div className="va-shot-frame-thumb">
                    <img
                      src={shot.generated_first_frame_url}
                      alt="首帧"
                      referrerPolicy="no-referrer"
                      onClick={() => handleShotGenerateFirstFrame(shot)}
                      title="点击以此帧为参考图生成首帧"
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
                      title="从素材库选择"
                    >
                      <MediaLibraryGridIcon />
                    </button>
                  </span>
                ) : null}
                {/* 尾帧 */}
                {(() => {
                  const lastFrameUrl = shot.generated_last_frame_url || getLastFrameUrl(shot, i);
                  const isFromNextShot = !shot.generated_last_frame_url && lastFrameUrl;
                  if (shot.generated_last_frame_url) {
                    return (
                      <div className="va-shot-frame-thumb">
                        <img
                          src={shot.generated_last_frame_url}
                          alt="尾帧"
                          referrerPolicy="no-referrer"
                          onClick={() => handleShotGenerateLastFrame(shot, i)}
                          title="点击以此帧为参考图生成尾帧"
                        />
                        <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'last')}>×</button>
                        <button className="va-shot-frame-regen" onClick={() => handleShotGenerateLastFrame(shot, i)}>↻</button>
                      </div>
                    );
                  }
                  if (isFromNextShot) {
                    return (
                      <div className="va-shot-frame-thumb va-shot-frame-thumb--borrowed">
                        <img
                          src={lastFrameUrl}
                          alt="尾帧(下一镜头首帧)"
                          referrerPolicy="no-referrer"
                          onClick={() => handleShotGenerateLastFrame(shot, i)}
                          title="下一镜头首帧，点击以此为参考图生成尾帧"
                        />
                        <span className="va-shot-frame-label">下一镜头首帧</span>
                      </div>
                    );
                  }
                  if (shot.last_frame_prompt || shot.description) {
                    return (
                      <span className="va-shot-frame-btn-group">
                        <button onClick={() => handleShotGenerateLastFrame(shot, i)}>生成尾帧</button>
                        <button
                          className="va-shot-frame-library-btn"
                          onClick={() => handlePickFromLibrary(shot.id, 'last')}
                          title="从素材库选择"
                        >
                          <MediaLibraryGridIcon />
                        </button>
                      </span>
                    );
                  }
                  return null;
                })()}
                {/* 视频 */}
                {shot.generated_video_url ? (
                  <div className="va-shot-frame-thumb">
                    <video
                      src={shot.generated_video_url}
                      muted
                      preload={'metadata' as const}
                      onClick={() => handleShotGenerateVideo(shot, i)}
                      title="点击重新生成视频"
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
                      title="从素材库插入视频"
                    >
                      <MediaLibraryGridIcon />
                    </button>
                  </span>
                ) : null}
              </>
            }
          />
        ))}
      </div>

      {/* 批量生成配置 */}
      <div className="va-batch-config">
        <div className="va-batch-config-title">批量生成配置</div>
        <ReferenceImageUpload
          images={refImages}
          onImagesChange={setRefImages}
          multiple
          label="参考图 (可选)"
        />
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
            <div className="va-segment-duration-select">
              <label className="va-model-label">单段</label>
              <select
                className="va-form-select"
                value={String(segmentDuration)}
                onChange={e => handleSegmentDurationChange(parseInt(e.target.value, 10))}
                disabled={durationOptions.length <= 1}
              >
                {durationOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="va-segment-duration-select">
              <label className="va-model-label">尺寸</label>
              <select
                className="va-form-select"
                value={videoSize}
                onChange={e => handleVideoSizeChange(e.target.value)}
                disabled={sizeOptions.length <= 1}
              >
                {sizeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {batchVideoState.running && (
          <div className="va-batch-config-title">
            正在串行生成第 {Math.max(batchVideoState.currentIndex + 1, 1)}/{shots.length} 段
            {batchVideoState.retryCount > 0 ? `，已重试 ${batchVideoState.retryCount} 次` : ''}
          </div>
        )}
        <div className="va-page-actions">
          {onRestart && <button onClick={onRestart}>重新分析</button>}
          <button onClick={handleGenerateAllFirstFrames}>全部→生成首帧图片</button>
          <button onClick={handleGenerateAllLastFrames}>全部→生成尾帧图片</button>
          <button onClick={handleGenerateAllVideos} disabled={batchVideoState.running}>全部→生成视频</button>
          {batchVideoState.running && (
            <button onClick={stopBatchVideoGeneration}>
              {batchVideoState.stopping ? '停止中…' : '停止全部生成'}
            </button>
          )}
        </div>
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
    </div>
  );
};
