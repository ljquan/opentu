/**
 * MV 批量视频生成页
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ImageIcon, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import type { MVRecord, VideoShot } from '../types';
import { updateRecord } from '../storage';
import { updateActiveShotsInRecord } from '../utils';
import { getVideoModelConfig } from '../../../constants/video-model-config';
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
import { MediaLibraryModal } from '../../media-library';
import { SelectionMode, AssetType } from '../../../types/asset.types';
import type { Asset } from '../../../types/asset.types';

const STORAGE_KEY_IMAGE_MODEL = 'mv-creator:image-model';
const STORAGE_KEY_VIDEO_MODEL = 'mv-creator:gen-video-model';

function aspectRatioToVideoSize(ratio?: string): string {
  switch (ratio) {
    case '9x16': return '720x1280';
    case '1x1': return '1024x1024';
    default: return '1280x720';
  }
}

/** 加载图片检测宽高比，返回对应的 video size，超时 3s */
function detectImageOrientation(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(null); }, 3000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalHeight > img.naturalWidth ? '720x1280' : '1280x720');
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

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
  const shots = record.editedShots || [];
  const aspectRatio = record.aspectRatio || '16x9';
  const batchId = record.batchId || `mv_${record.id}`;
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
    () => record.videoModel || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelId
  );
  const [videoModelRef, setVideoModelRef] = useState<ModelRef | null>(
    () => record.videoModelRef || readStoredModelSelection(STORAGE_KEY_VIDEO_MODEL, 'veo3').modelRef
  );
  const [segmentDuration, setSegmentDuration] = useState<number>(
    () => record.segmentDuration || parseInt(getVideoModelConfig(record.videoModel || 'veo3').defaultDuration, 10) || 8
  );

  const durationOptions = useMemo(
    () => getVideoModelConfig(videoModel).durationOptions,
    [videoModel]
  );

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
    setSegmentDuration(parseInt(cfg.defaultDuration, 10) || 8);
  }, []);

  const refImageUrls = useMemo(() => refImages.map(img => img.url).filter(Boolean), [refImages]);

  const ensureBatchId = useCallback(async () => {
    if (!record.batchId) {
      const updated = await updateRecord(record.id, { batchId });
      onRecordsChange(updated);
      onRecordUpdate({ ...record, batchId });
    }
  }, [record, batchId, onRecordUpdate, onRecordsChange]);

  // 任务状态回填
  const { tasks: allTasks } = useSharedTaskState();
  const processedTaskIdsRef = useRef(new Set<string>());
  const extractingRef = useRef(new Set<string>());

  useEffect(() => {
    const prefix = `mv_${record.id}_shot`;
    let hasUpdate = false;
    const currentRecord = record;
    let currentShots = currentRecord.editedShots || [];
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
      if (!shot || shot[field] === resultUrl) {
        processedTaskIdsRef.current.add(task.id);
        continue;
      }

      currentShots = currentShots.map(s =>
        s.id === shotId ? { ...s, [field]: resultUrl } : s
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
  }, [allTasks, record, onRecordUpdate, onRecordsChange]);

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

  // 素材库选择
  const [libraryTarget, setLibraryTarget] = useState<{ shotId: string; frame: 'first' | 'last' } | null>(null);

  const handleLibrarySelect = useCallback(async (asset: Asset) => {
    if (!libraryTarget) return;
    setLibraryTarget(null);
    const { shotId, frame } = libraryTarget;
    const field = frame === 'first' ? 'generated_first_frame_url' : 'generated_last_frame_url';
    const updatedShots = shots.map(s =>
      s.id === shotId ? { ...s, [field]: asset.url } : s
    );
    const updated = await updateRecord(record.id, updateActiveShotsInRecord(record, updatedShots));
    onRecordsChange(updated);
    onRecordUpdate({ ...record, editedShots: updatedShots });
  }, [libraryTarget, record, shots, onRecordsChange, onRecordUpdate]);

  const imageAspectRatio = aspectRatio.replace('x', ':');

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
    const shotBatchId = `mv_${record.id}_shot${shot.id}_first`;
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: prompt,
      batchId: shotBatchId,
      initialAspectRatio: imageAspectRatio,
      ...(shot.generated_first_frame_url ? {
        initialImages: [{ url: shot.generated_first_frame_url, name: '首帧' }],
      } : {}),
    });
  }, [record.id, pseudoAnalysis, pseudoProductInfo, openDialog, imageAspectRatio]);

  const getLastFrameUrl = useCallback((shot: VideoShot, index: number) => {
    if (shot.generated_last_frame_url) return shot.generated_last_frame_url;
    return shots[index + 1]?.generated_first_frame_url;
  }, [shots]);

  const handleShotGenerateLastFrame = useCallback((shot: VideoShot, index: number) => {
    const rawPrompt = shot.last_frame_prompt || shot.description || '';
    if (!rawPrompt) return;
    const prompt = buildFramePrompt(rawPrompt, pseudoAnalysis, pseudoProductInfo);
    const shotBatchId = `mv_${record.id}_shot${shot.id}_last`;
    const lastFrameUrl = getLastFrameUrl(shot, index);
    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: prompt,
      batchId: shotBatchId,
      initialAspectRatio: imageAspectRatio,
      ...(lastFrameUrl ? { initialImages: [{ url: lastFrameUrl, name: '尾帧' }] } : {}),
    });
  }, [record.id, pseudoAnalysis, pseudoProductInfo, openDialog, getLastFrameUrl, imageAspectRatio]);

  const handleShotGenerateVideo = useCallback(async (shot: VideoShot, index: number) => {
    const prompt = buildVideoPrompt(shot, pseudoAnalysis, pseudoProductInfo);
    if (!prompt) return;
    const shotBatchId = `mv_${record.id}_shot${shot.id}_video`;
    const initialImages: ReferenceImage[] = [];
    if (shot.generated_first_frame_url) {
      initialImages.push({ url: shot.generated_first_frame_url, name: '首帧' });
    }
    const lastFrameUrl = getLastFrameUrl(shot, index);
    if (lastFrameUrl) {
      initialImages.push({ url: lastFrameUrl, name: '尾帧' });
    }

    // 根据首帧/尾帧图片实际宽高比推断 size
    let size = aspectRatioToVideoSize(aspectRatio);
    const frameUrl = shot.generated_first_frame_url || lastFrameUrl;
    if (frameUrl) {
      try {
        const detected = await detectImageOrientation(frameUrl);
        if (detected) size = detected;
      } catch { /* 检测失败用默认值 */ }
    }

    openDialog(DialogType.aiVideoGeneration, {
      initialPrompt: prompt,
      initialImages: initialImages.length > 0 ? initialImages : undefined,
      initialDuration: segmentDuration,
      initialSize: size,
      batchId: shotBatchId,
    });
  }, [record.id, pseudoAnalysis, pseudoProductInfo, aspectRatio, segmentDuration, openDialog, getLastFrameUrl]);

  const handleDeleteFrame = useCallback((shotId: string, frameType: 'first' | 'last' | 'video') => {
    const field = frameType === 'first' ? 'generated_first_frame_url'
      : frameType === 'last' ? 'generated_last_frame_url'
      : 'generated_video_url';
    const updatedShots = shots.map(s =>
      s.id === shotId ? { ...s, [field]: undefined } : s
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
  const handleGenerateAllFirstFrames = useCallback(async () => {
    await ensureBatchId();
    for (const shot of shots) {
      const rawPrompt = shot.first_frame_prompt || shot.description || '';
      if (!rawPrompt) continue;
      const prompt = buildFramePrompt(rawPrompt, pseudoAnalysis, pseudoProductInfo);
      const shotBatchId = `mv_${record.id}_shot${shot.id}_first`;
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
  }, [shots, record.id, ensureBatchId, pseudoAnalysis, pseudoProductInfo, aspectRatio, refImageUrls, imageModel, imageModelRef]);

  const handleGenerateAllLastFrames = useCallback(async () => {
    await ensureBatchId();
    for (const shot of shots) {
      const rawPrompt = shot.last_frame_prompt || shot.description || '';
      if (!rawPrompt) continue;
      const prompt = buildFramePrompt(rawPrompt, pseudoAnalysis, pseudoProductInfo);
      const shotBatchId = `mv_${record.id}_shot${shot.id}_last`;
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
  }, [shots, record.id, ensureBatchId, pseudoAnalysis, pseudoProductInfo, aspectRatio, refImageUrls, imageModel, imageModelRef]);

  const handleGenerateAllVideos = useCallback(async () => {
    await ensureBatchId();
    const size = aspectRatioToVideoSize(aspectRatio);
    const seconds = String(segmentDuration);
    for (const shot of shots) {
      const prompt = buildVideoPrompt(shot, pseudoAnalysis, pseudoProductInfo);
      if (!prompt) continue;
      const shotBatchId = `mv_${record.id}_shot${shot.id}_video`;
      await mcpRegistry.executeTool(
        { name: 'generate_video', arguments: {
          prompt, size, seconds, count: 1, batchId: shotBatchId,
          model: videoModel, modelRef: videoModelRef,
          referenceImages: refImageUrls.length > 0 ? refImageUrls : undefined,
        }},
        { mode: 'queue' }
      );
    }
  }, [shots, record.id, aspectRatio, segmentDuration, videoModel, videoModelRef, ensureBatchId, refImageUrls, pseudoAnalysis, pseudoProductInfo]);

  return (
    <div className="va-page">
      <div className="va-shots">
        {shots.map((shot, i) => (
          <ShotCard key={shot.id} shot={shot} index={i} actions={
            <>
              {shot.generated_first_frame_url ? (
                <div className="va-shot-frame-thumb">
                  <img src={shot.generated_first_frame_url} alt="首帧" referrerPolicy="no-referrer"
                    onClick={() => handleShotGenerateFirstFrame(shot)} title="重新生成首帧" />
                  <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'first')}>×</button>
                  <button className="va-shot-frame-regen" onClick={() => handleShotGenerateFirstFrame(shot)}>↻</button>
                </div>
              ) : (shot.first_frame_prompt || shot.description) ? (
                <span className="va-shot-frame-btn-group">
                  <button onClick={() => handleShotGenerateFirstFrame(shot)}>生成首帧</button>
                  <button className="va-shot-frame-library-btn"
                    onClick={() => setLibraryTarget({ shotId: shot.id, frame: 'first' })} title="从素材库选择">
                    <ImageIcon size={14} />
                  </button>
                </span>
              ) : null}
              {(() => {
                const lastFrameUrl = getLastFrameUrl(shot, i);
                if (shot.generated_last_frame_url) {
                  return (
                    <div className="va-shot-frame-thumb">
                      <img src={shot.generated_last_frame_url} alt="尾帧" referrerPolicy="no-referrer"
                        onClick={() => handleShotGenerateLastFrame(shot, i)} title="重新生成尾帧" />
                      <button className="va-shot-frame-delete" onClick={() => handleDeleteFrame(shot.id, 'last')}>×</button>
                      <button className="va-shot-frame-regen" onClick={() => handleShotGenerateLastFrame(shot, i)}>↻</button>
                    </div>
                  );
                }
                if (!shot.generated_last_frame_url && lastFrameUrl) {
                  return (
                    <div className="va-shot-frame-thumb va-shot-frame-thumb--borrowed">
                      <img src={lastFrameUrl} alt="尾帧(下一镜头首帧)" referrerPolicy="no-referrer"
                        onClick={() => handleShotGenerateLastFrame(shot, i)} title="下一镜头首帧" />
                      <span className="va-shot-frame-label">下一镜头首帧</span>
                    </div>
                  );
                }
                if (shot.last_frame_prompt || shot.description) {
                  return (
                    <span className="va-shot-frame-btn-group">
                      <button onClick={() => handleShotGenerateLastFrame(shot, i)}>生成尾帧</button>
                      <button className="va-shot-frame-library-btn"
                        onClick={() => setLibraryTarget({ shotId: shot.id, frame: 'last' })} title="从素材库选择">
                        <ImageIcon size={14} />
                      </button>
                    </span>
                  );
                }
                return null;
              })()}
              {shot.generated_video_url ? (
                <div className="va-shot-video-wrap">
                  <div className="va-shot-frame-thumb">
                    <video src={shot.generated_video_url} muted preload="metadata"
                      onClick={() => handleShotGenerateVideo(shot, i)} title="重新生成视频" />
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
                <button onClick={() => handleShotGenerateVideo(shot, i)}>生成视频</button>
              ) : null}
            </>
          } />
        ))}
      </div>

      <div className="va-batch-config">
        <div className="va-batch-config-title">批量生成配置</div>
        <ReferenceImageUpload images={refImages} onImagesChange={setRefImages} multiple label="参考图 (可选)" />
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
                onChange={e => setSegmentDuration(parseInt(e.target.value, 10))}
                disabled={durationOptions.length <= 1}>
                {durationOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="va-page-actions">
          {onRestart && <button onClick={onRestart}>重新开始</button>}
          <button onClick={handleGenerateAllFirstFrames}>全部→生成首帧</button>
          <button onClick={handleGenerateAllLastFrames}>全部→生成尾帧</button>
          <button onClick={handleGenerateAllVideos}>全部→生成视频</button>
        </div>
      </div>

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
