/**
 * 镜头卡片组件
 */

import React from 'react';
import type { VideoShot } from '../types';
import { SHOT_TYPE_COLORS } from '../types';

/** 转场 icon */
const TRANSITION_ICONS: Record<string, string> = {
  cut: '✂️',
  dissolve: '🔀',
  match_cut: '🔗',
  fade_to_black: '⬛',
};

/** 转场中文标签 */
const TRANSITION_LABELS: Record<string, string> = {
  cut: '硬切',
  dissolve: '溶解',
  match_cut: '匹配切',
  fade_to_black: '淡出',
};

interface ShotCardProps {
  shot: VideoShot;
  index: number;
  /** 紧凑模式：隐藏描述/文案/运镜的只读展示（编辑表单会替代） */
  compact?: boolean;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export const ShotCard: React.FC<ShotCardProps> = ({ shot, index, compact, actions, children }) => (
  <div className="va-shot-card">
    {/* 仅在无 actions 且非紧凑模式（分析页只读模式）时显示顶部帧图片 */}
    {!actions && !compact && shot.generated_first_frame_url && (
      <div className="va-shot-frame-row">
        <img
          src={shot.generated_first_frame_url}
          alt="首帧"
          className="va-shot-frame-img"
          referrerPolicy="no-referrer"
        />
      </div>
    )}
    <div className="va-shot-header">
      <span
        className="va-shot-badge"
        style={{ backgroundColor: SHOT_TYPE_COLORS[shot.type] || SHOT_TYPE_COLORS.other }}
      >
        {shot.label}
      </span>
      <span className="va-shot-time">
        #{index + 1} · {shot.startTime}s - {shot.endTime}s
      </span>
      {shot.transition_hint && (
        <span className="va-shot-transition">
          {TRANSITION_ICONS[shot.transition_hint] || '→'} {TRANSITION_LABELS[shot.transition_hint] || shot.transition_hint}
        </span>
      )}
      {shot.character_ids && shot.character_ids.length > 0 && (
        <span className="va-shot-characters">
          {shot.character_ids.join(', ')}
        </span>
      )}
    </div>
    {!compact && (
      <>
        <p className="va-shot-desc">{shot.description}</p>
        {shot.narration && <p className="va-shot-script">旁白: "{shot.narration}"</p>}
        {shot.dialogue && <p className="va-shot-script">对白: "{shot.dialogue}"</p>}
        {shot.dialogue_speakers && (
          <p className="va-shot-camera">对白角色: {shot.dialogue_speakers}</p>
        )}
        {shot.speech_relation && (
          <p className="va-shot-camera">语音关系: {shot.speech_relation}</p>
        )}
        {shot.camera_movement && (
          <p className="va-shot-camera">运镜: {shot.camera_movement}</p>
        )}
        {shot.first_frame_prompt && (
          <p className="va-shot-prompt">首帧 Prompt: {shot.first_frame_prompt}</p>
        )}
        {shot.last_frame_prompt && (
          <p className="va-shot-prompt">尾帧 Prompt: {shot.last_frame_prompt}</p>
        )}
      </>
    )}
    {children}
    {actions && <div className="va-shot-actions">{actions}</div>}
  </div>
);
