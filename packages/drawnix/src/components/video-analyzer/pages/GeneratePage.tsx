/**
 * 素材生成页 - 单镜头弹窗生成 + 底部批量配置
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ImageIcon } from 'lucide-react';
import type { AnalysisRecord, VideoShot } from '../types';
import { aspectRatioToVideoSize, migrateProductInfo } from '../types';
import { getVideoModelConfig } from '../../../constants/video-model-config';
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
import {
  readStoredModelSelection,
  writeStoredModelSelection,
  updateActiveShotsInRecord,
} from '../utils';

const STORAGE_KEY_IMAGE_MODEL = 'video-analyzer:image-model';
const STORAGE_KEY_VIDEO_MODEL = 'video-analyzer:video-model';

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
  const shots = record.editedShots || record.analysis.shots;
  const aspectRatio = record.analysis.aspect_ratio || '16x9';
  const batchId = record.batchId || `va_${record.id}`;
  const { openDialog } = useDrawnix();

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
  const [segmentDuration, setSegmentDuration] = useState<number>(
    () => record.productInfo?.segmentDuration || parseInt(getVideoModelConfig(record.productInfo?.videoModel || 'veo3').defaultDuration, 10) || 8
  );

  // 视频模型时长选项
  const durationOptions = useMemo(() => {
    return getVideoModelConfig(videoModel).durationOptions;
  }, [videoModel]);

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
    setSegmentDuration(nextSegmentDuration);

    const nextProductInfo = {
      ...migrateProductInfo(record.productInfo || { prompt: '' }, record.analysis.totalDuration),
      videoModel: model,
      videoModelRef: modelRef || null,
      segmentDuration: nextSegmentDuration,
    };

    void updateRecord(record.id, { productInfo: nextProductInfo }).then(updated => {
      onRecordsChange(updated);
      onRecordUpdate({ ...record, productInfo: nextProductInfo });
    });
  }, [record, onRecordUpdate, onRecordsChange]);

  // 参考图 URL 列表（用于传给批量生成接口）
  const refImageUrls = useMemo(() => refImages.map(img => img.url).filter(Boolean), [refImages]);

  // 确保 batchId 已保存
  const ensureBatchId = useCallback(async () => {
    if (!record.batchId) {
      const updated = await updateRecord(record.id, { batchId });
      onRecordsChange(updated);
      onRecordUpdate({ ...record, batchId });
    }
  }, [record, batchId, onRecordUpdate, onRecordsChange]);

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

  useEffect(() => {
    const prefix = `va_${record.id}_shot`;
    let hasUpdate = false;
    const currentRecord = record;
    let currentShots = currentRecord.editedShots || currentRecord.analysis.shots;

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
      if (!shot || shot[field] === resultUrl) {
        processedTaskIdsRef.current.add(task.id);
        continue;
      }

      currentShots = currentShots.map(s =>
        s.id === shotId ? { ...s, [field]: resultUrl } : s
      );
      processedTaskIdsRef.current.add(task.id);
      hasUpdate = true;
    }

    if (hasUpdate) {
      void updateRecord(currentRecord.id, updateActiveShotsInRecord(currentRecord, currentShots)).then(updated => {
        onRecordsChange(updated);
        onRecordUpdate({ ...currentRecord, editedShots: currentShots });
      });
    }
  }, [allTasks, record, onRecordUpdate, onRecordsChange]);

  // --- 从素材库选择帧图片 ---
  const [libraryTarget, setLibraryTarget] = useState<{ shotId: string; frame: 'first' | 'last' } | null>(null);

  const handlePickFromLibrary = useCallback((shotId: string, frame: 'first' | 'last') => {
    setLibraryTarget({ shotId, frame });
  }, []);

  const handleLibrarySelect = useCallback(async (asset: Asset) => {
    if (!libraryTarget) return;
    setLibraryTarget(null);
    const { shotId, frame } = libraryTarget;
    const field = frame === 'first' ? 'generated_first_frame_url' : 'generated_last_frame_url';
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

  const handleShotGenerateFirstFrame = useCallback((shot: VideoShot) => {
    const rawPrompt = shot.first_frame_prompt || shot.description || '';
    if (!rawPrompt) return;
    const prompt = buildFramePrompt(rawPrompt, record.analysis, record.productInfo);
    const shotBatchId = `va_${record.id}_shot${shot.id}_first`;
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: prompt,
      batchId: shotBatchId,
      initialAspectRatio: imageAspectRatio,
      ...(shot.generated_first_frame_url ? {
        initialImages: [{ url: shot.generated_first_frame_url, name: '首帧' }],
      } : {}),
    });
  }, [record, openDialog, imageAspectRatio]);

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
    const shotBatchId = `va_${record.id}_shot${shot.id}_last`;
    const lastFrameUrl = getLastFrameUrl(shot, index);
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: prompt,
      batchId: shotBatchId,
      initialAspectRatio: imageAspectRatio,
      ...(lastFrameUrl ? {
        initialImages: [{ url: lastFrameUrl, name: '尾帧' }],
      } : {}),
    });
  }, [record, openDialog, getLastFrameUrl, imageAspectRatio]);

  // --- 单镜头：打开视频生成弹窗 ---
  const handleShotGenerateVideo = useCallback((shot: VideoShot, index: number) => {
    const prompt = buildVideoPrompt(shot, record.analysis, record.productInfo);
    if (!prompt) return;
    const size = aspectRatioToVideoSize(aspectRatio);
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
      initialPrompt: prompt,
      initialImages: initialImages.length > 0 ? initialImages : undefined,
      initialDuration: segmentDuration,
      initialSize: size,
      batchId: shotBatchId,
    });
  }, [record.id, aspectRatio, segmentDuration, openDialog, getLastFrameUrl]);

  // --- 删除帧图片/视频 ---
  const handleDeleteFrame = useCallback((shotId: string, frameType: 'first' | 'last' | 'video') => {
    const field = frameType === 'first' ? 'generated_first_frame_url'
      : frameType === 'last' ? 'generated_last_frame_url'
      : 'generated_video_url';
    const currentShots = record.editedShots || record.analysis.shots;
    const updatedShots = currentShots.map(s =>
      s.id === shotId ? { ...s, [field]: undefined } : s
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

  const handleGenerateAllVideos = useCallback(async () => {
    await ensureBatchId();
    const size = aspectRatioToVideoSize(aspectRatio);
    const seconds = String(segmentDuration);
    for (const shot of shots) {
      const prompt = buildVideoPrompt(shot, record.analysis, record.productInfo);
      if (!prompt) continue;
      const shotBatchId = `va_${record.id}_shot${shot.id}_video`;
      await mcpRegistry.executeTool(
        { name: 'generate_video', arguments: {
          prompt, size, seconds, count: 1, batchId: shotBatchId, model: videoModel,
          modelRef: videoModelRef,
          referenceImages: refImageUrls.length > 0 ? refImageUrls : undefined,
        }},
        { mode: 'queue' }
      );
    }
  }, [shots, record, aspectRatio, batchId, videoModel, videoModelRef, ensureBatchId, segmentDuration, refImageUrls]);

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
                      <ImageIcon size={14} />
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
                          <ImageIcon size={14} />
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
                  <button onClick={() => handleShotGenerateVideo(shot, i)}>生成视频</button>
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
        <div className="va-page-actions">
          {onRestart && <button onClick={onRestart}>重新分析</button>}
          <button onClick={handleGenerateAllFirstFrames}>全部→生成首帧图片</button>
          <button onClick={handleGenerateAllLastFrames}>全部→生成尾帧图片</button>
          <button onClick={handleGenerateAllVideos}>全部→生成视频</button>
        </div>
      </div>

      {/* 素材库选择弹窗 */}
      <MediaLibraryModal
        isOpen={!!libraryTarget}
        onClose={() => setLibraryTarget(null)}
        mode={SelectionMode.SELECT}
        filterType={AssetType.IMAGE}
        onSelect={handleLibrarySelect}
        selectButtonText="使用此图片"
      />
    </div>
  );
};
