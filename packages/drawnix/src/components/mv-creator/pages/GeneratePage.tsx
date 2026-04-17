/**
 * MV 批量视频生成页
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import type { MVRecord, VideoShot, VideoCharacter } from '../types';
import { updateRecord } from '../storage';
import { updateActiveShotsInRecord } from '../utils';
import { getValidVideoSize, getVideoModelConfig } from '../../../constants/video-model-config';
import { mcpRegistry } from '../../../mcp/registry';
import { ShotCard } from '../../video-analyzer/components/ShotCard';
import {
  buildVideoPrompt,
  buildFramePrompt,
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../../video-analyzer/utils';
import { ReferenceImageUpload } from '../../ttd-dialog/shared';
import { extractFrameFromUrl } from '../../../utils/video-frame-cache';
import type { ReferenceImage } from '../../ttd-dialog/shared';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { useDrawnix, DialogType } from '../../../hooks/use-drawnix';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import { TaskStatus } from '../../../types/task.types';
import { taskQueueService } from '../../../services/task-queue';
import { buildBatchVideoReferenceImages, waitForBatchVideoTask } from '../../../utils/batch-video-generation';
import { MediaLibraryModal } from '../../media-library';
import { VideoPosterPreview } from '../../shared/VideoPosterPreview';
import { SelectionMode, AssetType } from '../../../types/asset.types';
import type { Asset } from '../../../types/asset.types';

const STORAGE_KEY_IMAGE_MODEL = 'mv-creator:image-model';
const STORAGE_KEY_VIDEO_MODEL = 'mv-creator:gen-video-model';

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
  record: MVRecord;
  onRecordUpdate: (record: MVRecord) => void;
  onRecordsChange: (records: MVRecord[]) => void;
  onRestart?: () => void;
}

export const GeneratePage: React.FC<GeneratePageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
  onRestart,
}) => {
  const shots = useMemo(() => record.editedShots || [], [record.editedShots]);
  const aspectRatio = record.aspectRatio || '16x9';
  const batchId = record.batchId || `mv_${record.id}`;
  const { openDialog } = useDrawnix();
  const latestRecordRef = useRef(record);
  const latestShotsRef = useRef(shots);
  const batchStopRef = useRef(false);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const activeBatchTaskIdRef = useRef<string | null>(null);

  const [refImages, setRefImages] = useState<ReferenceImage[]>([]);
  const characters = useMemo<VideoCharacter[]>(
    () => record.characters || [],
    [record.characters]
  );
  const [charLibraryTarget, setCharLibraryTarget] = useState<string | null>(null);
  const imageModels = useSelectableModels('image');
  const videoModels = useSelectableModels('video');
  const [imageModel, setImageModelState] = useState(
    () => readStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, '').modelId
  );
  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(
    () => readStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, '').modelRef
  );
  const [videoModel, setVideoModelState] = useState(
    () => record.videoModel || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () => record.videoModelRef || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelRef
  );
  const [videoSize, setVideoSizeState] = useState<string>(
    () => getValidVideoSize(
      record.videoModel || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId,
      record.videoSize
    )
  );
  const [segmentDuration, setSegmentDuration] = useState<number>(
    () => record.segmentDuration || parseInt(getVideoModelConfig(record.videoModel || 'veo3').defaultDuration, 10) || 8
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

  const applyRecordPatch = useCallback(async (patch: Partial<MVRecord>) => {
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

  const setImageModel = useCallback((model: string, ref?: ModelRef | null) => {
    setImageModelState(model);
    setImageModelRef(ref || null);
    writeStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, model, ref);
  }, []);

  const setVideoModel = useCallback((model: string, ref?: ModelRef | null) => {
    setVideoModelState(model);
    setVideoModelRef(ref || null);
    writeStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, model, ref);
    const cfg = getVideoModelConfig(model);
    const nextSegmentDuration = parseInt(cfg.defaultDuration, 10) || 8;
    const nextVideoSize = getValidVideoSize(model, videoSize);
    setSegmentDuration(nextSegmentDuration);
    setVideoSizeState(nextVideoSize);
    void applyRecordPatch({
      videoModel: model,
      videoModelRef: ref || null,
      segmentDuration: nextSegmentDuration,
      videoSize: nextVideoSize,
    });
  }, [applyRecordPatch, videoSize]);

  const handleSegmentDurationChange = useCallback((value: number) => {
    setSegmentDuration(value);
    void applyRecordPatch({ segmentDuration: value });
  }, [applyRecordPatch]);

  const handleVideoSizeChange = useCallback((value: string) => {
    const nextVideoSize = getValidVideoSize(videoModel, value);
    setVideoSizeState(nextVideoSize);
    void applyRecordPatch({ videoSize: nextVideoSize });
  }, [applyRecordPatch, videoModel]);

  const refImageUrls = useMemo(() => refImages.map(img => img.url).filter(Boolean), [refImages]);

  const handleCharacterRefImageChange = useCallback(async (charId: string, url: string | undefined) => {
    const base = latestRecordRef.current.characters || [];
    const updated = base.map(c => c.id === charId ? { ...c, referenceImageUrl: url } : c);
    await applyRecordPatch({ characters: updated });
  }, [applyRecordPatch]);

  const handleGenerateCharacterRef = useCallback((char: VideoCharacter) => {
    const charBatchId = `mv_${record.id}_char${char.id}_ref`;
    const style = record.videoStyle ? `${record.videoStyle} style. ` : '';
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: `${style}${char.description}`,
      batchId: charBatchId,
      initialAspectRatio: '1:1',
      initialModel: imageModel || undefined,
      initialModelRef: imageModelRef,
    });
  }, [record.id, record.videoStyle, openDialog, imageModel, imageModelRef]);

  const ensureBatchId = useCallback(async () => {
    if (!record.batchId) {
      await applyRecordPatch({ batchId });
    }
  }, [record.batchId, batchId, applyRecordPatch]);

  // 任务状态回填
  const { tasks: allTasks } = useSharedTaskState();
  const processedTaskIdsRef = useRef(new Set<string>());
  const extractingRef = useRef(new Set<string>());

  /** 从新生成的视频中提取帧，自动填入相邻片段的空位 */
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
        const prevShot = idx > 0 ? updatedShots[idx - 1] : undefined;

        // 视频尾帧 → 下一片段首帧（如果下一片段首帧为空）
        if (nextShot && !nextShot.generated_first_frame_url) {
          const url = await extractFrameFromUrl(videoUrl, nextShot.id, 'first', 'last');
          if (url) {
            updatedShots = updatedShots.map(s =>
              s.id === nextShot.id ? { ...s, generated_first_frame_url: url } : s
            );
            changed = true;
          }
        }

        // 视频首帧 → 前一片段尾帧（如果前一片段尾帧为空且前一片段未生成视频）
        if (prevShot && !prevShot.generated_last_frame_url && !prevShot.generated_video_url) {
          const url = await extractFrameFromUrl(videoUrl, prevShot.id, 'last', 'first');
          if (url) {
            updatedShots = updatedShots.map(s =>
              s.id === prevShot.id ? { ...s, generated_last_frame_url: url } : s
            );
            changed = true;
          }
        }
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
    const prefix = `mv_${record.id}_shot`;
    const charPrefix = `mv_${record.id}_char`;
    let hasUpdate = false;
    const currentRecord = record;
    let currentShots = currentRecord.editedShots || [];
    const newVideoShots: Array<{ shotId: string; videoUrl: string }> = [];

    for (const task of allTasks) {
      if (task.status !== TaskStatus.COMPLETED) continue;
      if (processedTaskIdsRef.current.has(task.id)) continue;
      const taskBatchId = task.params?.batchId as string | undefined;
      if (!taskBatchId) continue;

      // 角色参考图任务回填
      if (taskBatchId.startsWith(charPrefix)) {
        const resultUrl = task.result?.url;
        processedTaskIdsRef.current.add(task.id);
        if (resultUrl) {
          const suffix = taskBatchId.slice(charPrefix.length);
          const refIdx = suffix.lastIndexOf('_ref');
          if (refIdx !== -1) {
            const charId = suffix.slice(0, refIdx);
            const base = latestRecordRef.current.characters || [];
            const updatedChars = base.map(c => c.id === charId ? { ...c, referenceImageUrl: resultUrl } : c);
            void applyRecordPatch({ characters: updatedChars });
          }
        }
        continue;
      }

      if (!taskBatchId.startsWith(prefix)) continue;
      // 跳过在当前分镜生成之前创建的任务，防止旧任务结果污染新脚本
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

    // 新视频完成 → 自动提取帧填入相邻片段
    if (newVideoShots.length > 0) {
      void autoFillAdjacentFrames(currentRecord.id, currentShots, newVideoShots);
    }
  }, [allTasks, autoFillAdjacentFrames, record, onRecordUpdate, onRecordsChange, applyRecordPatch]);

  // 素材库选择
  const [libraryTarget, setLibraryTarget] = useState<{ shotId: string; assetType: 'first' | 'last' | 'video' } | null>(null);

  const handleLibrarySelect = useCallback(async (asset: Asset) => {
    if (!libraryTarget) return;
    setLibraryTarget(null);
    const { shotId, assetType } = libraryTarget;
    const field = assetType === 'first'
      ? 'generated_first_frame_url'
      : assetType === 'last'
        ? 'generated_last_frame_url'
        : 'generated_video_url';
    const updatedShots = shots.map(s =>
      s.id === shotId ? { ...s, [field]: asset.url } : s
    );
    const updated = await updateRecord(record.id, updateActiveShotsInRecord(record, updatedShots));
    onRecordsChange(updated);
    onRecordUpdate({ ...record, editedShots: updatedShots });
  }, [libraryTarget, record, shots, onRecordsChange, onRecordUpdate]);

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

  const imageAspectRatio = useMemo(() => {
    if (videoSize?.includes('x')) {
      const [w, h] = videoSize.split('x').map(Number);
      if (w && h) {
        const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
        const d = gcd(w, h);
        return `${w / d}:${h / d}`;
      }
    }
    return aspectRatio.replace('x', ':');
  }, [videoSize, aspectRatio]);
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

  // 构建 MV 专用的 analysis-like 对象给 buildVideoPrompt / buildFramePrompt
  const pseudoAnalysis = useMemo(() => ({
    totalDuration: record.selectedClipDuration || 30,
    productExposureDuration: 0,
    productExposureRatio: 0,
    shotCount: shots.length,
    firstProductAppearance: 0,
    aspect_ratio: aspectRatio,
    video_style: record.videoStyle || '',
    bgm_mood: '',
    suggestion: '',
    shots,
  }), [record, shots, aspectRatio]);

  const pseudoProductInfo = useMemo(() => ({
    prompt: record.creationPrompt || '',
    videoStyle: record.videoStyle || '',
  }), [record]);

  // 单镜头操作
  const handleShotGenerateFirstFrame = useCallback((shot: VideoShot) => {
    const rawPrompt = shot.first_frame_prompt || shot.description || '';
    if (!rawPrompt) return;
    const prompt = buildFramePrompt(rawPrompt, pseudoAnalysis, pseudoProductInfo);
    const draft = shot.first_frame_draft;
    const shotBatchId = `mv_${record.id}_shot${shot.id}_first`;
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: draft?.prompt || prompt,
      batchId: shotBatchId,
      initialAspectRatio: draft?.aspectRatio ?? imageAspectRatio,
      initialModel: imageModel || undefined,
      initialModelRef: imageModelRef,
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
  }, [record.id, pseudoAnalysis, pseudoProductInfo, openDialog, imageAspectRatio, imageModel, imageModelRef, saveShotDraft, toDraftImages]);

  const getLastFrameUrl = useCallback((shot: VideoShot, index: number) => {
    if (shot.generated_last_frame_url) return shot.generated_last_frame_url;
    return shots[index + 1]?.generated_first_frame_url;
  }, [shots]);

  const handleShotGenerateLastFrame = useCallback((shot: VideoShot, index: number) => {
    const rawPrompt = shot.last_frame_prompt || shot.description || '';
    if (!rawPrompt) return;
    const prompt = buildFramePrompt(rawPrompt, pseudoAnalysis, pseudoProductInfo);
    const draft = shot.last_frame_draft;
    const shotBatchId = `mv_${record.id}_shot${shot.id}_last`;
    const lastFrameUrl = getLastFrameUrl(shot, index);
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: draft?.prompt || prompt,
      batchId: shotBatchId,
      initialAspectRatio: draft?.aspectRatio ?? imageAspectRatio,
      initialModel: imageModel || undefined,
      initialModelRef: imageModelRef,
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
  }, [record.id, pseudoAnalysis, pseudoProductInfo, openDialog, getLastFrameUrl, imageAspectRatio, imageModel, imageModelRef, saveShotDraft, toDraftImages]);

  const handleShotGenerateVideo = useCallback(async (shot: VideoShot, index: number) => {
    const prompt = buildVideoPrompt(shot, pseudoAnalysis, pseudoProductInfo);
    if (!prompt) return;
    const draft = shot.video_draft;
    const shotBatchId = `mv_${record.id}_shot${shot.id}_video`;
    const initialImages: ReferenceImage[] = [];
    if (shot.generated_first_frame_url) {
      initialImages.push({ url: shot.generated_first_frame_url, name: '首帧' });
    }
    const lastFrameUrl = getLastFrameUrl(shot, index);
    if (lastFrameUrl) {
      initialImages.push({ url: lastFrameUrl, name: '尾帧' });
    }

    const targetModelConfig = getVideoModelConfig(videoModel);
    const durationStr = String(draft?.duration ?? segmentDuration);
    const validDuration = targetModelConfig.durationOptions.some(o => o.value === durationStr)
      ? (draft?.duration ?? segmentDuration)
      : undefined;
    const validSize = targetModelConfig.sizeOptions.some(o => o.value === (draft?.size ?? videoSize))
      ? (draft?.size ?? videoSize)
      : undefined;

    openDialog(DialogType.aiVideoGeneration, {
      initialPrompt: draft?.prompt || prompt,
      initialImages: draft
        ? toDraftImages(draft.images || [])
        : initialImages.length > 0
          ? initialImages
          : undefined,
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
  }, [record.id, pseudoAnalysis, pseudoProductInfo, segmentDuration, videoSize, videoModel, videoModelRef, openDialog, getLastFrameUrl, saveShotDraft, toDraftImages]);

  const handleDeleteFrame = useCallback((shotId: string, frameType: 'first' | 'last' | 'video') => {
    const field = frameType === 'first' ? 'generated_first_frame_url'
      : frameType === 'last' ? 'generated_last_frame_url'
      : 'generated_video_url';
    const updatedShots = shots.map(s =>
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
  }, [record, shots, onRecordUpdate, onRecordsChange]);

  // 帧传递：从视频提取帧填入相邻片段
  const handleFillFrame = useCallback(async (
    shot: VideoShot,
    index: number,
    direction: 'prev-last' | 'next-first'
  ) => {
    if (!shot.generated_video_url) return;
    const targetShot = direction === 'next-first' ? shots[index + 1] : shots[index - 1];
    if (!targetShot) return;

    const frameType = direction === 'next-first' ? 'first' : 'last';
    // 提取：next-first 取视频尾帧，prev-last 取视频首帧
    const extractPosition = direction === 'next-first' ? 'last' : 'first';
    const url = await extractFrameFromUrl(shot.generated_video_url, targetShot.id, frameType, extractPosition);
    if (!url) return;

    const field = frameType === 'first' ? 'generated_first_frame_url' : 'generated_last_frame_url';
    const updatedShots = shots.map(s =>
      s.id === targetShot.id ? { ...s, [field]: url } : s
    );
    void updateRecord(record.id, updateActiveShotsInRecord(record, updatedShots)).then(updated => {
      onRecordsChange(updated);
      onRecordUpdate({ ...record, editedShots: updatedShots });
    });
  }, [record, shots, onRecordUpdate, onRecordsChange]);
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

  const generateFirstFrameForShot = useCallback(async (
    shot: VideoShot,
    prevLastFrameUrl: string | undefined,
    currentCharacters: VideoCharacter[]
  ): Promise<string | null> => {
    const rawPrompt = shot.first_frame_prompt || shot.description || '';
    if (!rawPrompt) return null;

    let prompt = buildFramePrompt(rawPrompt, pseudoAnalysis, pseudoProductInfo);
    // 在 prompt 中补充角色外貌描述和前帧上下文，提升生图一致性
    const charDescs: string[] = [];
    if (shot.character_ids && shot.character_ids.length > 0) {
      for (const charId of shot.character_ids) {
        const char = currentCharacters.find(c => c.id === charId);
        if (char?.description) charDescs.push(`${char.name}: ${char.description}`);
      }
    }
    if (charDescs.length > 0) {
      prompt += `\nCharacters in this frame: ${charDescs.join('; ')}`;
    }
    if (prevLastFrameUrl) {
      prompt += '\nThis frame should visually continue from the previous shot\'s last frame (provided as reference image #1).';
    }

    const referenceImages: string[] = [];
    if (prevLastFrameUrl) referenceImages.push(prevLastFrameUrl);
    if (shot.character_ids && shot.character_ids.length > 0) {
      for (const charId of shot.character_ids) {
        const char = currentCharacters.find(c => c.id === charId);
        if (char?.referenceImageUrl && !referenceImages.includes(char.referenceImageUrl)) {
          referenceImages.push(char.referenceImageUrl);
        }
      }
    }

    const shotBatchId = `mv_${record.id}_shot${shot.id}_first`;
    const result = await mcpRegistry.executeTool(
      { name: 'generate_image', arguments: {
        prompt: prompt.trim(), count: 1, size: imageAspectRatio,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        batchId: shotBatchId,
        ...(imageModel ? { model: imageModel, modelRef: imageModelRef } : {}),
      }},
      { mode: 'queue' }
    );

    const taskId = (result as { taskId?: string; data?: { taskId?: string } }).taskId
      || (result.data as { taskId?: string } | undefined)?.taskId;
    if (!result.success || !taskId) return null;

    const waitResult = await waitForBatchVideoTask(taskId, batchAbortControllerRef.current?.signal);
    if (!waitResult.success) return null;

    const task = waitResult.task || taskQueueService.getTask(taskId);
    return task?.result?.url || null;
  }, [record.id, pseudoAnalysis, pseudoProductInfo, imageAspectRatio, imageModel, imageModelRef]);

  const createBatchVideoTask = useCallback(async (
    shot: VideoShot,
    index: number,
    currentShots: VideoShot[]
  ) => {
    const prompt = buildVideoPrompt(shot, pseudoAnalysis, pseudoProductInfo);
    if (!prompt) {
      return null;
    }

    const firstFrameUrl = index === 0 ? refImageUrls[0] : shot.generated_first_frame_url;
    const lastFrameUrl = shot.generated_last_frame_url || currentShots[index + 1]?.generated_first_frame_url;
    const { referenceImages } = buildBatchVideoReferenceImages({
      model: videoModel,
      firstFrameUrl,
      lastFrameUrl,
      extraReferenceUrls: refImageUrls.slice(index === 0 ? 1 : 0),
    });

    const shotBatchId = `mv_${record.id}_shot${shot.id}_video`;

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
    pseudoAnalysis,
    pseudoProductInfo,
    refImageUrls,
    record.id,
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
      // ── Step 0: 为缺少参考图的角色生成参考图 ──
      let currentCharacters = latestRecordRef.current.characters || [];
      const charsNeedingRef = currentCharacters.filter(c => !c.referenceImageUrl);
      const stylePrefix = latestRecordRef.current.videoStyle ? `${latestRecordRef.current.videoStyle} style. ` : '';
      if (charsNeedingRef.length > 0 && !batchStopRef.current) {
        for (const char of charsNeedingRef) {
          if (batchStopRef.current) break;
          const charBatchId = `mv_${record.id}_char${char.id}_ref`;
          const result = await mcpRegistry.executeTool(
            { name: 'generate_image', arguments: {
              prompt: `${stylePrefix}${char.description}`,
              count: 1,
              size: '1:1',
              batchId: charBatchId,
              ...(imageModel ? { model: imageModel, modelRef: imageModelRef } : {}),
            }},
            { mode: 'queue' }
          );
          const taskId = (result as { taskId?: string; data?: { taskId?: string } }).taskId
            || (result.data as { taskId?: string } | undefined)?.taskId;
          if (taskId) {
            const waitResult = await waitForBatchVideoTask(taskId, batchAbortControllerRef.current?.signal);
            if (waitResult.success) {
              const task = waitResult.task || taskQueueService.getTask(taskId);
              const url = task?.result?.url;
              if (url) {
                const base = latestRecordRef.current.characters || [];
                const updated = base.map(c => c.id === char.id ? { ...c, referenceImageUrl: url } : c);
                await applyRecordPatch({ characters: updated });
              }
            }
          }
        }
        currentCharacters = latestRecordRef.current.characters || [];
      }

      // ── Step 1: 逐镜头生成首帧 + 视频 ──
      let currentShots = latestShotsRef.current;
      let prevLastFrameUrl: string | undefined;

      for (let index = 0; index < currentShots.length; index++) {
        if (batchStopRef.current) {
          break;
        }

        currentShots = latestShotsRef.current;
        const shot = currentShots[index];
        if (!shot) {
          continue;
        }

        const prompt = buildVideoPrompt(shot, pseudoAnalysis, pseudoProductInfo);
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
          try {
            const lastFrame = await extractFrameFromUrl(shot.generated_video_url, shot.id, 'last', 'last');
            prevLastFrameUrl = lastFrame || undefined;
          } catch {
            prevLastFrameUrl = undefined;
          }
          continue;
        }

        // 生成首帧（镜头有角色 或 有上一段尾帧）
        // 有角色时必须用生图模型生成（保持角色一致性），即使已有提取的尾帧
        currentCharacters = latestRecordRef.current.characters || [];
        const shotHasCharacters = (shot.character_ids || []).length > 0;
        const needsFirstFrame = shotHasCharacters || (prevLastFrameUrl !== undefined);
        const hasGeneratedFirstFrame = !!shot.generated_first_frame_url;
        const shouldGenerateFirstFrame = needsFirstFrame && (!hasGeneratedFirstFrame || shotHasCharacters);

        if (shouldGenerateFirstFrame && !batchStopRef.current) {
          const firstFrameUrl = await generateFirstFrameForShot(shot, prevLastFrameUrl, currentCharacters);
          if (firstFrameUrl) {
            currentShots = currentShots.map((s, i) =>
              i === index ? { ...s, generated_first_frame_url: firstFrameUrl } : s
            );
            await applyUpdatedShots(currentShots);
          }
        }

        let retryCount = 0;
        let taskId: string | null = null;

        while (!batchStopRef.current) {
          if (!taskId) {
            taskId = await createBatchVideoTask(currentShots[index] || shot, index, currentShots);
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
            try {
              const lastFrame = await extractFrameFromUrl(videoUrl, shot.id, 'last', 'last');
              prevLastFrameUrl = lastFrame || undefined;
            } catch {
              prevLastFrameUrl = undefined;
            }
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
    generateFirstFrameForShot,
    propagateTailFrameToNextShot,
    pseudoAnalysis,
    pseudoProductInfo,
    applyUpdatedShots,
    applyRecordPatch,
    record.id,
    imageModel,
    imageModelRef,
    writeShotVideoResult,
  ]);

  const handleResetAllGenerated = useCallback(async () => {
    const clearedShots = shots.map(s => ({
      ...s,
      generated_first_frame_url: undefined,
      generated_last_frame_url: undefined,
      generated_video_url: undefined,
      suppressed_generated_urls: undefined,
    }));
    const clearedChars = (record.characters || []).map(c => ({ ...c, referenceImageUrl: undefined }));
    await applyUpdatedShots(clearedShots);
    await applyRecordPatch({ characters: clearedChars });
  }, [shots, record.characters, applyUpdatedShots, applyRecordPatch]);

  const thumbStyle = useMemo(() => {
    if (!videoSize?.includes('x')) return {};
    const [w, h] = videoSize.split('x').map(Number);
    if (!w || !h) return {};
    const computedW = Math.round(54 * w / h);
    return { width: Math.max(computedW, 48), height: computedW < 48 ? Math.round(48 * h / w) : 54 };
  }, [videoSize]);

  return (
    <div className="va-page">
      <div className="va-batch-config">
        <div className="va-batch-config-title">批量生成配置</div>
        <ReferenceImageUpload images={refImages} onImagesChange={setRefImages} multiple label="参考图 (可选)" />
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
                      <img src={char.referenceImageUrl} alt={char.name} referrerPolicy="no-referrer" />
                      <button className="va-shot-frame-delete" onClick={() => void handleCharacterRefImageChange(char.id, undefined)}>×</button>
                    </div>
                  ) : (
                    <span className="va-character-ref-empty">未设置</span>
                  )}
                  <button onClick={() => handleGenerateCharacterRef(char)}>生成</button>
                  <button onClick={() => setCharLibraryTarget(char.id)}>素材库</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="va-product-form">
          <div className="va-model-select">
            <label className="va-model-label">图片模型</label>
            <ModelDropdown variant="form" selectedModel={imageModel}
              selectedSelectionKey={getSelectionKey(imageModel, imageModelRef)}
              onSelect={setImageModel} models={imageModels} placement="down" placeholder="选择图片模型" />
          </div>
          <div className="va-model-select">
            <label className="va-model-label">视频模型</label>
            <ModelDropdown variant="form" selectedModel={videoModel}
              selectedSelectionKey={getSelectionKey(videoModel, videoModelRef)}
              onSelect={setVideoModel} models={videoModels} placement="down" placeholder="选择视频模型" />
            <div className="va-segment-duration-select">
              <label className="va-model-label">单段</label>
              <select className="va-form-select" value={String(segmentDuration)}
                onChange={e => handleSegmentDurationChange(parseInt(e.target.value, 10))}
                disabled={durationOptions.length <= 1}>
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
          {onRestart && <button onClick={onRestart}>重新开始</button>}
          <button onClick={handleResetAllGenerated}>重置生成</button>
          <button onClick={handleGenerateAllVideos} disabled={batchVideoState.running}>全部→生成视频</button>
          {batchVideoState.running && (
            <button onClick={stopBatchVideoGeneration}>
              {batchVideoState.stopping ? '停止中…' : '停止全部生成'}
            </button>
          )}
        </div>
      </div>

      <div className="va-shots">
        {shots.map((shot, i) => (
          <ShotCard key={shot.id} shot={shot} index={i} actions={
            <>
              {shot.generated_first_frame_url ? (
                <div className="va-shot-frame-thumb" style={thumbStyle}
                  onMouseEnter={e => handleThumbEnter(shot.generated_first_frame_url!, 'image', e)}
                  onMouseLeave={handleThumbLeave}>
                  <img src={shot.generated_first_frame_url} alt="首帧" referrerPolicy="no-referrer"
                    onClick={() => handleShotGenerateFirstFrame(shot)} />
                  <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'first')}>×</button>
                  <button className="va-shot-frame-regen" onClick={() => handleShotGenerateFirstFrame(shot)}>↻</button>
                </div>
              ) : (shot.first_frame_prompt || shot.description) ? (
                <span className="va-shot-frame-btn-group">
                  <button onClick={() => handleShotGenerateFirstFrame(shot)}>生成首帧</button>
                  <button className="va-shot-frame-library-btn"
                    onClick={() => setLibraryTarget({ shotId: shot.id, assetType: 'first' })} title="从素材库选择">
                    <MediaLibraryGridIcon />
                  </button>
                </span>
              ) : null}
              {(() => {
                const lastFrameUrl = getLastFrameUrl(shot, i);
                if (shot.generated_last_frame_url) {
                  return (
                    <div className="va-shot-frame-thumb" style={thumbStyle}
                      onMouseEnter={e => handleThumbEnter(shot.generated_last_frame_url!, 'image', e)}
                      onMouseLeave={handleThumbLeave}>
                      <img src={shot.generated_last_frame_url} alt="尾帧" referrerPolicy="no-referrer"
                        onClick={() => handleShotGenerateLastFrame(shot, i)} />
                      <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'last')}>×</button>
                      <button className="va-shot-frame-regen" onClick={() => handleShotGenerateLastFrame(shot, i)}>↻</button>
                    </div>
                  );
                }
                if (!shot.generated_last_frame_url && lastFrameUrl) {
                  return (
                    <div className="va-shot-frame-thumb va-shot-frame-thumb--borrowed" style={thumbStyle}
                      onMouseEnter={e => handleThumbEnter(lastFrameUrl!, 'image', e)}
                      onMouseLeave={handleThumbLeave}>
                      <img src={lastFrameUrl} alt="尾帧(下一镜头首帧)" referrerPolicy="no-referrer"
                        onClick={() => handleShotGenerateLastFrame(shot, i)} />
                      <span className="va-shot-frame-label">下一镜头首帧</span>
                    </div>
                  );
                }
                if (shot.last_frame_prompt || shot.description) {
                  return (
                    <span className="va-shot-frame-btn-group">
                      <button onClick={() => handleShotGenerateLastFrame(shot, i)}>生成尾帧</button>
                      <button className="va-shot-frame-library-btn"
                        onClick={() => setLibraryTarget({ shotId: shot.id, assetType: 'last' })} title="从素材库选择">
                        <MediaLibraryGridIcon />
                      </button>
                    </span>
                  );
                }
                return null;
              })()}
              {shot.generated_video_url ? (
                <div className="va-shot-video-wrap">
                  <div className="va-shot-frame-thumb" style={thumbStyle}
                    onMouseEnter={e => handleThumbEnter(shot.generated_video_url!, 'video', e)}
                    onMouseLeave={handleThumbLeave}>
                    <VideoPosterPreview
                      src={shot.generated_video_url}
                      alt="生成视频缩略图"
                      className="va-shot-frame-media"
                      thumbnailSize="small"
                      onClick={() => handleShotGenerateVideo(shot, i)}
                      videoProps={{
                        muted: true,
                        preload: 'metadata',
                        title: '重新生成视频',
                      }}
                    />
                    <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'video')}>×</button>
                    <button className="va-shot-frame-regen" onClick={() => handleShotGenerateVideo(shot, i)}>↻</button>
                  </div>
                  {(i > 0 || i < shots.length - 1) && (
                    <div className="va-shot-frame-transfer">
                      {i > 0 && (
                        <button
                          className="va-shot-frame-transfer-btn"
                          onClick={() => handleFillFrame(shot, i, 'prev-last')}
                          title="提取首帧 → 前一片段尾帧"
                        ><ArrowUpToLine size={12} /></button>
                      )}
                      {i < shots.length - 1 && (
                        <button
                          className="va-shot-frame-transfer-btn"
                          onClick={() => handleFillFrame(shot, i, 'next-first')}
                          title="提取尾帧 → 后一片段首帧"
                        ><ArrowDownToLine size={12} /></button>
                      )}
                    </div>
                  )}
                </div>
              ) : shot.description ? (
                <span className="va-shot-frame-btn-group">
                  <button onClick={() => handleShotGenerateVideo(shot, i)}>生成视频</button>
                  <button
                    className="va-shot-frame-library-btn"
                    onClick={() => setLibraryTarget({ shotId: shot.id, assetType: 'video' })}
                    title="从素材库插入视频"
                  >
                    <MediaLibraryGridIcon />
                  </button>
                </span>
              ) : null}
            </>
          } />
        ))}
      </div>

      <MediaLibraryModal
        isOpen={!!libraryTarget}
        onClose={() => setLibraryTarget(null)}
        mode={SelectionMode.SELECT}
        filterType={libraryTarget?.assetType === 'video' ? AssetType.VIDEO : AssetType.IMAGE}
        onSelect={handleLibrarySelect}
        selectButtonText={libraryTarget?.assetType === 'video' ? '使用此视频' : '使用此图片'}
      />

      <MediaLibraryModal
        isOpen={!!charLibraryTarget}
        onClose={() => setCharLibraryTarget(null)}
        mode={SelectionMode.SELECT}
        filterType={AssetType.IMAGE}
        onSelect={(asset: Asset) => {
          if (charLibraryTarget) {
            void handleCharacterRefImageChange(charLibraryTarget, asset.url);
          }
          setCharLibraryTarget(null);
        }}
        selectButtonText="使用此图片"
      />

      {hoverPreview && ReactDOM.createPortal(
        <div
          className="mv-hover-preview"
          style={{ left: `${hoverPreview.x}px`, top: `${hoverPreview.y}px` }}
          onMouseEnter={handleHoverPreviewEnter}
          onMouseLeave={handleHoverPreviewLeave}
        >
          {hoverPreview.type === 'image' ? (
            <img src={hoverPreview.url} alt="Preview" referrerPolicy="no-referrer" />
          ) : (
            <video src={hoverPreview.url} controls muted preload="metadata" />
          )}
        </div>,
        document.body
      )}
    </div>
  );
};
