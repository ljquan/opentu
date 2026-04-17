/**
 * MV 创意输入 + 音频选择页
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { MVRecord, GeneratedClip } from '../types';
import { TaskType } from '../../../types/task.types';
import { addRecord, updateRecord } from '../storage';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import { extractClipsFromTask } from '../../music-analyzer/task-sync';
import { toolWindowService } from '../../../services/tool-window-service';
import { musicAnalyzerTool } from '../../../tools/tools/music-analyzer';

const STORAGE_KEY_PROMPT = 'mv-creator:creation-prompt';

function readSessionPrompt(): string {
  try { return sessionStorage.getItem(STORAGE_KEY_PROMPT) || ''; } catch { return ''; }
}

function writeSessionPrompt(value: string): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY_PROMPT, value);
    else sessionStorage.removeItem(STORAGE_KEY_PROMPT);
  } catch { /* noop */ }
}

interface CreatePageProps {
  existingRecord?: MVRecord | null;
  onComplete: (record: MVRecord) => void;
  onRecordsChange: (records: MVRecord[]) => void;
  onCreateNew?: () => void;
  onNext?: () => void;
}

export const CreatePage: React.FC<CreatePageProps> = ({
  existingRecord,
  onComplete,
  onRecordsChange,
  onNext,
}) => {
  const [creationPrompt, setCreationPrompt] = useState(
    () => existingRecord?.creationPrompt || readSessionPrompt()
  );
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    existingRecord?.selectedClipId || null
  );

  // 回填已有 record
  useEffect(() => {
    if (!existingRecord) return;
    setCreationPrompt(existingRecord.creationPrompt || '');
    setSelectedClipId(existingRecord.selectedClipId || null);
  }, [existingRecord]);

  useEffect(() => {
    if (!existingRecord) writeSessionPrompt(creationPrompt);
  }, [creationPrompt, existingRecord]);

  // 获取项目中已有的音频
  const { tasks: allTasks } = useSharedTaskState();
  const existingAudioClips = useMemo(() => {
    const result: (GeneratedClip & { prompt?: string })[] = [];
    for (const task of allTasks) {
      if (task.type !== TaskType.AUDIO || task.status !== 'completed') continue;
      const extracted = extractClipsFromTask(task);
      for (const clip of extracted) {
        result.push({
          ...clip,
          prompt: String(task.params.prompt || ''),
        });
      }
    }
    return result;
  }, [allTasks]);

  const handleOpenMusicTool = useCallback(() => {
    // 获取 MV Creator 窗口位置，向右偏移避免重叠
    const mvState = toolWindowService.getPrimaryToolState('mv-creator');
    const mvPos = mvState?.position;
    const offsetPos = mvPos
      ? { x: mvPos.x + (mvState?.tool.defaultWidth || 520) + 16, y: mvPos.y }
      : undefined;
    toolWindowService.openTool(musicAnalyzerTool.manifest, {
      launchMode: 'reuse',
      position: offsetPos,
    });
  }, []);

  // 选择已有音频 → 创建 record 并设为 selectedClip
  const handleSelectExistingClip = useCallback(async (clip: GeneratedClip & { prompt?: string }) => {
    // 选择配乐时，用配乐的生成 prompt 填充创意描述
    if (clip.prompt && !creationPrompt.trim()) {
      setCreationPrompt(clip.prompt);
    }

    let record = existingRecord;
    if (!record) {
      const sourceLabel = clip.title || clip.prompt?.slice(0, 20) || '已有音频';
      record = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        creationPrompt: creationPrompt.trim() || clip.prompt || '',
        sourceLabel,
        starred: false,
        musicTitle: clip.title || '',
        generatedClips: [clip],
        selectedClipId: clip.clipId,
        selectedClipDuration: clip.duration ?? null,
        selectedClipAudioUrl: clip.audioUrl,
      };
      const records = await addRecord(record);
      onRecordsChange(records);
      onComplete(record);
    } else {
      const existingClips = record.generatedClips || [];
      const alreadyExists = existingClips.some(c => c.clipId === clip.clipId);
      const nextClips = alreadyExists ? existingClips : [...existingClips, clip];
      const patch: Partial<MVRecord> = {
        generatedClips: nextClips,
        selectedClipId: clip.clipId,
        selectedClipDuration: clip.duration ?? null,
        selectedClipAudioUrl: clip.audioUrl,
        musicTitle: record.musicTitle || clip.title || '',
      };
      const updated = await updateRecord(record.id, patch);
      onRecordsChange(updated);
      onComplete({ ...record, ...patch });
    }
    setSelectedClipId(clip.clipId);
  }, [existingRecord, creationPrompt, onComplete, onRecordsChange]);

  return (
    <div className="va-page">
      {/* 已有音频列表 */}
      <div className="ma-card ma-card--grow">
        <div className="ma-card-header">
          <span>选择配乐 ({existingAudioClips.length})</span>
          <button
            className="ma-chip ma-chip--accent"
            style={{ cursor: 'pointer', fontSize: '11px', padding: '2px 8px' }}
            onClick={handleOpenMusicTool}
          >
            + 生成新音乐
          </button>
        </div>
        {existingAudioClips.length === 0 ? (
          <div className="ma-hint">
            暂无已完成的音频，
            <button
              onClick={handleOpenMusicTool}
              style={{
                background: 'none', border: 'none', color: '#E67E22',
                cursor: 'pointer', textDecoration: 'underline',
                padding: 0, font: 'inherit',
              }}
            >
              去生成音乐
            </button>
          </div>
        ) : (
          <div className="ma-clips-gallery">
            {existingAudioClips.map((clip, i) => (
              <div
                key={`${clip.clipId || i}`}
                className={`ma-clip-row ${selectedClipId === clip.clipId ? 'is-selected' : ''}`}
                onClick={() => handleSelectExistingClip(clip)}
                style={{ cursor: 'pointer' }}
              >
                {clip.imageUrl ? (
                  <img src={clip.imageUrl} alt="" className="ma-clip-thumb" referrerPolicy="no-referrer" />
                ) : (
                  <div className="ma-clip-thumb ma-clip-thumb--placeholder">♪</div>
                )}
                <div className="ma-clip-meta">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="ma-clip-title">{clip.title || clip.prompt?.slice(0, 30) || clip.clipId}</span>
                    {selectedClipId === clip.clipId && (
                      <span className="ma-chip ma-chip--accent" style={{ flexShrink: 0, padding: '0 4px', fontSize: '10px', height: '16px', lineHeight: '14px' }}>已选</span>
                    )}
                  </div>
                  {clip.duration != null && (
                    <span className="ma-clip-duration">{Math.round(clip.duration)}s</span>
                  )}
                </div>
                <audio
                  controls
                  src={clip.audioUrl}
                  preload="metadata"
                  className="ma-clip-player"
                  onClick={e => e.stopPropagation()}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MV 创意描述 */}
      <div className="ma-card">
        <div className="ma-card-header">
          <span>MV 创意描述</span>
        </div>
        <textarea
          className="ma-textarea"
          rows={3}
          placeholder="描述你想要的 MV 主题、风格、情绪、画面..."
          value={creationPrompt}
          onChange={e => setCreationPrompt(e.target.value)}
        />
      </div>

      {/* 下一步 */}
      {onNext && selectedClipId && (
        <div className="va-page-actions">
          <button className="va-btn-primary" onClick={onNext}>
            下一步：AI 分镜 →
          </button>
        </div>
      )}
    </div>
  );
};