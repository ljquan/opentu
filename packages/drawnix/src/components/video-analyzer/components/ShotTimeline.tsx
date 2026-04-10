/**
 * 镜头时间线组件
 */

import React from 'react';
import type { VideoShot } from '../types';
import { SHOT_TYPE_COLORS } from '../types';

interface ShotTimelineProps {
  shots: VideoShot[];
  totalDuration: number;
}

export const ShotTimeline: React.FC<ShotTimelineProps> = ({ shots, totalDuration }) => (
  <div className="va-timeline">
    {shots.map(shot => (
      <div
        key={shot.id}
        className="va-timeline-segment"
        style={{
          flex: (shot.endTime - shot.startTime) / totalDuration,
          backgroundColor: SHOT_TYPE_COLORS[shot.type] || SHOT_TYPE_COLORS.other,
        }}
        title={`${shot.label} ${shot.startTime}s-${shot.endTime}s`}
      />
    ))}
  </div>
);
