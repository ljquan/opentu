/**
 * 素材生成页 - 单镜头弹窗生成 + 底部批量配置
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { AnalysisRecord, VideoShot } from '../types';
import { aspectRatioToVideoSize, migrateProductInfo } from '../types';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import { mcpRegistry } from '../../../mcp/registry';
import { updateRecord } from '../storage';
import { ShotCard } from '../components/ShotCard';
import { buildVideoPrompt } from '../utils';
import { ReferenceImageUpload } from '../../ttd-dialog/shared';
import type { ReferenceImage } from '../../ttd-dialog/shared';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { useDrawnix, DialogType } from '../../../hooks/use-drawnix';
import { taskQueueService } from '../../../services/task-queue';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
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

  // --- 订阅任务完成事件，自动关联帧图片 ---
  const recordRef = useRef(record);
  recordRef.current = record;

  useEffect(() => {
    const prefix = `va_${record.id}_shot`;
    const sub = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (event.type !== 'taskCompleted') return;
      const taskBatchId = event.task.params?.batchId as string | undefined;
      if (!taskBatchId || !taskBatchId.startsWith(prefix)) return;
      const resultUrl = event.task.result?.url;
      if (!resultUrl) return;

      // 解析 batchId: va_{recordId}_shot{shotId}_{first|last}
      const suffix = taskBatchId.slice(prefix.length);
      const lastUnderscore = suffix.lastIndexOf('_');
      if (lastUnderscore === -1) return;
      const shotId = suffix.slice(0, lastUnderscore);
      const frameType = suffix.slice(lastUnderscore + 1);
      if (frameType !== 'first' && frameType !== 'last') return;

      const field = frameType === 'first' ? 'generated_first_frame_url' : 'generated_last_frame_url';
      const currentRecord = recordRef.current;
      const currentShots = currentRecord.editedShots || currentRecord.analysis.shots;
      const updatedShots = currentShots.map(s =>
        s.id === shotId ? { ...s, [field]: resultUrl } : s
      );
      void updateRecord(currentRecord.id, { editedShots: updatedShots }).then(updated => {
        onRecordsChange(updated);
        onRecordUpdate({ ...currentRecord, editedShots: updatedShots });
      });
    });
    return () => sub.unsubscribe();
  }, [record.id, onRecordUpdate, onRecordsChange]);

  // --- 单镜头：打开图片生成弹窗 ---
  const handleShotGenerateFirstFrame = useCallback((shot: VideoShot) => {
    const prompt = shot.first_frame_prompt || shot.description || '';
    if (!prompt) return;
    const shotBatchId = `va_${record.id}_shot${shot.id}_first`;
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: prompt,
      batchId: shotBatchId,
      // 如果有提取的首帧图片，作为参考图传入
      ...(shot.generated_first_frame_url ? {
        initialImages: [{ url: shot.generated_first_frame_url, name: '首帧' }],
      } : {}),
    });
  }, [record.id, openDialog]);

  // 获取 shot 的尾帧 URL（优先使用已生成的，否则使用下一个 shot 的首帧）
  const getLastFrameUrl = useCallback((shot: VideoShot, index: number) => {
    if (shot.generated_last_frame_url) {
      return shot.generated_last_frame_url;
    }
    const nextShot = shots[index + 1];
    return nextShot?.generated_first_frame_url;
  }, [shots]);

  const handleShotGenerateLastFrame = useCallback((shot: VideoShot, index: number) => {
    const prompt = shot.last_frame_prompt || shot.description || '';
    if (!prompt) return;
    const shotBatchId = `va_${record.id}_shot${shot.id}_last`;
    const lastFrameUrl = getLastFrameUrl(shot, index);
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: prompt,
      batchId: shotBatchId,
      // 如果有尾帧图片（或下一个 shot 的首帧），作为参考图传入
      ...(lastFrameUrl ? {
        initialImages: [{ url: lastFrameUrl, name: '尾帧' }],
      } : {}),
    });
  }, [record.id, openDialog, getLastFrameUrl]);

  // --- 单镜头：打开视频生成弹窗 ---
  const handleShotGenerateVideo = useCallback((shot: VideoShot, index: number) => {
    const prompt = buildVideoPrompt(shot);
    if (!prompt) return;
    const size = aspectRatioToVideoSize(aspectRatio);
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
    });
  }, [aspectRatio, segmentDuration, openDialog, getLastFrameUrl]);

  // --- 删除帧图片 ---
  const handleDeleteFrame = useCallback((shotId: string, frameType: 'first' | 'last') => {
    const field = frameType === 'first' ? 'generated_first_frame_url' : 'generated_last_frame_url';
    const currentShots = record.editedShots || record.analysis.shots;
    const updatedShots = currentShots.map(s =>
      s.id === shotId ? { ...s, [field]: undefined } : s
    );
    void updateRecord(record.id, { editedShots: updatedShots }).then(updated => {
      onRecordsChange(updated);
      onRecordUpdate({ ...record, editedShots: updatedShots });
    });
  }, [record, onRecordUpdate, onRecordsChange]);

  // --- 批量生成（使用底部配置的参考图+模型） ---
  const enqueueImageGeneration = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;
    await mcpRegistry.executeTool(
      { name: 'generate_image', arguments: {
        prompt: prompt.trim(), count: 1, size: aspectRatio,
        referenceImages: refImageUrls.length > 0 ? refImageUrls : undefined,
        batchId,
        ...(imageModel ? { model: imageModel, modelRef: imageModelRef } : {}),
      }},
      { mode: 'queue' }
    );
  }, [aspectRatio, refImageUrls, batchId, imageModel, imageModelRef]);

  const handleGenerateAllFirstFrames = useCallback(async () => {
    await ensureBatchId();
    for (const shot of shots) {
      const prompt = getFirstFramePrompt(shot);
      if (!prompt) continue;
      await enqueueImageGeneration(prompt);
    }
  }, [shots, ensureBatchId, getFirstFramePrompt, enqueueImageGeneration]);

  const handleGenerateAllLastFrames = useCallback(async () => {
    await ensureBatchId();
    for (const shot of shots) {
      const prompt = getLastFramePrompt(shot);
      if (!prompt) continue;
      await enqueueImageGeneration(prompt);
    }
  }, [shots, ensureBatchId, getLastFramePrompt, enqueueImageGeneration]);

  const handleGenerateAllVideos = useCallback(async () => {
    await ensureBatchId();
    const size = aspectRatioToVideoSize(aspectRatio);
    const seconds = String(segmentDuration);
    for (const shot of shots) {
      const prompt = buildVideoPrompt(shot);
      if (!prompt) continue;
      await mcpRegistry.executeTool(
        { name: 'generate_video', arguments: {
          prompt, size, seconds, count: 1, batchId, model: videoModel,
          modelRef: videoModelRef,
          referenceImages: refImageUrls.length > 0 ? refImageUrls : undefined,
        }},
        { mode: 'queue' }
      );
    }
  }, [shots, aspectRatio, batchId, videoModel, videoModelRef, ensureBatchId, segmentDuration, refImageUrls]);

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
                  <button onClick={() => handleShotGenerateFirstFrame(shot)}>生成首帧图片</button>
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
                    return <button onClick={() => handleShotGenerateLastFrame(shot, i)}>生成尾帧图片</button>;
                  }
                  return null;
                })()}
                {/* 视频 */}
                {(shot.description || shot.narration || shot.dialogue || shot.camera_movement || shot.first_frame_prompt || shot.last_frame_prompt) && (
                  <button onClick={() => handleShotGenerateVideo(shot, i)}>生成视频</button>
                )}
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
    </div>
  );
};
