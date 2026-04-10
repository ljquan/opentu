/**
 * 镜头卡片组件
 */

import React from 'react';
import type { VideoShot } from '../types';
import { SHOT_TYPE_COLORS } from '../types';

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
    </div>
    {!compact && (
      <>
        <p className="va-shot-desc">{shot.description}</p>
        {shot.script && <p className="va-shot-script">"{shot.script}"</p>}
        {shot.camera_movement && (
          <span className="va-shot-camera">运镜: {shot.camera_movement}</span>
        )}
      </>
    )}
    {children}
    {actions && <div className="va-shot-actions">{actions}</div>}
  </div>
);
