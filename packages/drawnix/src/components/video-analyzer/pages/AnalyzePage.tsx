/**
 * 分析页 - 视频输入 + AI 分析 + 结果摘要
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import type { AnalysisRecord, VideoAnalysisData } from '../types';
import { formatShotsMarkdown } from '../types';
import { videoAnalyzeTool } from '../../../mcp/tools/video-analyze';
import { quickInsert } from '../../../mcp/tools/canvas-insertion';
import { buildInlineDataPart } from '../../../utils/gemini-api/message-utils';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { ShotTimeline } from '../components/ShotTimeline';
import { ShotCard } from '../components/ShotCard';
import { addRecord } from '../storage';

type InputMode = 'upload' | 'youtube';

const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-flash';
const STORAGE_KEY_MODEL = 'video-analyzer:model';

interface AnalyzePageProps {
  existingRecord?: AnalysisRecord | null;
  onComplete: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
  onNext?: () => void;
}

export const AnalyzePage: React.FC<AnalyzePageProps> = ({
  existingRecord,
  onComplete,
  onRecordsChange,
  onNext,
}) => {
  const [inputMode, setInputMode] = useState<InputMode>('upload');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModelState] = useState(
    () => localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_ANALYSIS_MODEL
  );
  const setSelectedModel = useCallback((model: string) => {
    setSelectedModelState(model);
    localStorage.setItem(STORAGE_KEY_MODEL, model);
  }, []);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<VideoAnalysisData | null>(
    existingRecord?.analysis || null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allTextModels = useSelectableModels('text');
  const videoAnalysisModels = useMemo(
    () => allTextModels.filter(m => /^gemini/i.test(m.id)),
    [allTextModels]
  );

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setVideoFile(file); setError(''); setAnalysis(null); }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) { setVideoFile(file); setError(''); setAnalysis(null); }
  }, []);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setError('');
    setProgress('准备中...');
    try {
      let params: Record<string, unknown> = {};
      if (inputMode === 'upload' && videoFile) {
        setProgress('读取视频文件...');
        const part = await buildInlineDataPart(videoFile);
        if (part.type === 'inline_data') {
          params = { videoData: part.data, mimeType: part.mimeType, model: selectedModel };
        }
      } else if (inputMode === 'youtube' && youtubeUrl) {
        params = { youtubeUrl, model: selectedModel };
      } else {
        setError('请先选择视频文件或输入 YouTube URL');
        setAnalyzing(false);
        return;
      }

      setProgress('AI 分析中，请耐心等待...');
      const result = await videoAnalyzeTool.execute(params);

      if (result.success && result.data) {
        const analysisData = (result.data as { analysis: VideoAnalysisData }).analysis;
        setAnalysis(analysisData);

        // 保存到历史
        const record: AnalysisRecord = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          source: inputMode,
          sourceLabel: inputMode === 'upload' ? (videoFile?.name || '本地视频') : youtubeUrl,
          model: selectedModel,
          analysis: analysisData,
          starred: false,
        };
        const updated = await addRecord(record);
        onRecordsChange(updated);
        onComplete(record);
      } else {
        setError(result.error || '分析失败');
      }
    } catch (err: any) {
      setError(err.message || '分析失败');
    } finally {
      setAnalyzing(false);
      setProgress('');
    }
  }, [inputMode, videoFile, youtubeUrl, selectedModel, onComplete, onRecordsChange]);

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
            <div className="va-dropzone" onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} style={{ display: 'none' }} />
              {videoFile ? <span className="va-filename">{videoFile.name}</span> : <span className="va-placeholder">拖拽视频到此处 或 点击上传</span>}
            </div>
          ) : (
            <input className="va-url-input" type="text" placeholder="https://www.youtube.com/watch?v=..." value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} />
          )}
          <div className="va-model-select">
            <label className="va-model-label">分析模型</label>
            <ModelDropdown variant="form" selectedModel={selectedModel} onSelect={setSelectedModel} models={videoAnalysisModels} placement="down" disabled={analyzing} placeholder="选择多模态模型" />
          </div>
          <button className="va-analyze-btn" onClick={handleAnalyze} disabled={analyzing || (inputMode === 'upload' ? !videoFile : !youtubeUrl)}>
            {analyzing ? progress || '分析中...' : '开始分析'}
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
            <button onClick={handleInsertAnalysis}>插入画布</button>
            <button onClick={() => { setAnalysis(null); }}>重新分析</button>
            {onNext && <button className="va-btn-primary" onClick={onNext}>下一步: 编辑脚本 →</button>}
          </div>
        </div>
      )}
    </div>
  );
};
