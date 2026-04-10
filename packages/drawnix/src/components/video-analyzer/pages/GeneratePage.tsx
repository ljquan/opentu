/**
 * 素材生成页 - 商品图上传 + 批量图片/视频生成
 */

import React, { useState, useCallback, useRef } from 'react';
import type { AnalysisRecord, VideoShot } from '../types';
import { aspectRatioToVideoSize } from '../types';
import { mcpRegistry } from '../../../mcp/registry';
import { updateRecord } from '../storage';
import { ShotCard } from '../components/ShotCard';

interface GeneratePageProps {
  record: AnalysisRecord;
  onRecordUpdate: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
}

export const GeneratePage: React.FC<GeneratePageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
}) => {
  const shots = record.editedShots || record.analysis.shots;
  const aspectRatio = record.analysis.aspect_ratio || '16x9';
  const batchId = record.batchId || `va_${record.id}`;
  const videoModel = record.productInfo?.videoModel || 'veo3';

  const [productImages, setProductImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 确保 batchId 已保存
  const ensureBatchId = useCallback(async () => {
    if (!record.batchId) {
      const updated = await updateRecord(record.id, { batchId });
      onRecordsChange(updated);
      onRecordUpdate({ ...record, batchId });
    }
  }, [record, batchId, onRecordUpdate, onRecordsChange]);

  // 商品图上传
  const handleProductImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const url = URL.createObjectURL(file);
      setProductImages(prev => [...prev, url]);
    });
  }, []);

  // 单镜头生成图片
  const handleShotGenerateImage = useCallback(async (shot: VideoShot) => {
    if (!shot.visual_prompt) return;
    await ensureBatchId();
    await mcpRegistry.executeTool(
      { name: 'generate_image', arguments: {
        prompt: shot.visual_prompt, count: 1, size: aspectRatio,
        referenceImages: productImages.length > 0 ? productImages : undefined,
        batchId,
      }},
      { mode: 'queue' }
    );
  }, [aspectRatio, productImages, batchId, ensureBatchId]);

  // 单镜头生成视频
  const handleShotGenerateVideo = useCallback(async (shot: VideoShot) => {
    const prompt = shot.video_prompt || shot.visual_prompt;
    if (!prompt) return;
    await ensureBatchId();
    const size = aspectRatioToVideoSize(aspectRatio);
    const dur = shot.duration ?? Math.round(shot.endTime - shot.startTime);
    const seconds = String(Math.min(Math.max(dur, 5), 10));
    await mcpRegistry.executeTool(
      { name: 'generate_video', arguments: { prompt, size, seconds, count: 1, batchId, model: videoModel } },
      { mode: 'queue' }
    );
  }, [aspectRatio, batchId, videoModel, ensureBatchId]);

  // 批量生成
  const handleGenerateAllImages = useCallback(async () => {
    await ensureBatchId();
    for (const shot of shots.filter(s => s.visual_prompt)) {
      await mcpRegistry.executeTool(
        { name: 'generate_image', arguments: {
          prompt: shot.visual_prompt, count: 1, size: aspectRatio,
          referenceImages: productImages.length > 0 ? productImages : undefined,
          batchId,
        }},
        { mode: 'queue' }
      );
    }
  }, [shots, aspectRatio, productImages, batchId, ensureBatchId]);

  const handleGenerateAllVideos = useCallback(async () => {
    await ensureBatchId();
    const size = aspectRatioToVideoSize(aspectRatio);
    for (const shot of shots) {
      const prompt = shot.video_prompt || shot.visual_prompt;
      if (!prompt) continue;
      const dur = shot.duration ?? Math.round(shot.endTime - shot.startTime);
      const seconds = String(Math.min(Math.max(dur, 5), 10));
      await mcpRegistry.executeTool(
        { name: 'generate_video', arguments: { prompt, size, seconds, count: 1, batchId, model: videoModel } },
        { mode: 'queue' }
      );
    }
  }, [shots, aspectRatio, batchId, videoModel, ensureBatchId]);

  return (
    <div className="va-page">
      {/* 商品图上传 */}
      <div className="va-product-images">
        <div className="va-section-title">商品参考图（可选）</div>
        <div className="va-image-row">
          {productImages.map((url, i) => (
            <div key={i} className="va-thumb">
              <img src={url} alt={`商品图${i + 1}`} />
              <button className="va-thumb-remove" onClick={() => setProductImages(prev => prev.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button className="va-thumb-add" onClick={() => fileInputRef.current?.click()}>+</button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleProductImageUpload} style={{ display: 'none' }} />
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
                {shot.visual_prompt && (
                  <button onClick={() => handleShotGenerateImage(shot)}>生成图片</button>
                )}
                {(shot.video_prompt || shot.visual_prompt) && (
                  <button onClick={() => handleShotGenerateVideo(shot)}>生成视频</button>
                )}
              </>
            }
          />
        ))}
      </div>

      {/* 批量操作 */}
      <div className="va-page-actions">
        <button onClick={handleGenerateAllImages}>全部→生成图片</button>
        <button onClick={handleGenerateAllVideos}>全部→生成视频</button>
      </div>
    </div>
  );
};
