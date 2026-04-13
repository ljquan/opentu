/**
 * VideoModelOptions Component
 *
 * Dynamic parameter selection for video generation based on model configuration.
 * Renders duration, size options and handles model-specific constraints.
 */

import React, { useEffect } from 'react';
import { Select, Radio } from 'tdesign-react';
import type { VideoModel, VideoModelConfig } from '../../../types/video.types';
import { getVideoModelConfig } from '../../../constants/video-model-config';
import './VideoModelOptions.scss';

interface VideoModelOptionsProps {
  model: VideoModel;
  configOverride?: VideoModelConfig;
  duration: string;
  size: string;
  onDurationChange: (duration: string) => void;
  onSizeChange: (size: string) => void;
  disabled?: boolean;
}

export const VideoModelOptions: React.FC<VideoModelOptionsProps> = ({
  model,
  configOverride,
  duration,
  size,
  onDurationChange,
  onSizeChange,
  disabled = false,
}) => {
  const config = configOverride || getVideoModelConfig(model);
  const durationOptions = config.durationOptions;
  const sizeOptions = config.sizeOptions;
  const isDurationValid = durationOptions.some((opt) => opt.value === duration);
  const isSizeValid = sizeOptions.some((opt) => opt.value === size);
  const normalizedDuration = isDurationValid ? duration : config.defaultDuration;
  const normalizedSize = isSizeValid ? size : config.defaultSize;

  useEffect(() => {
    if (duration !== normalizedDuration) {
      onDurationChange(normalizedDuration);
    }

    if (size !== normalizedSize) {
      onSizeChange(normalizedSize);
    }
  }, [
    duration,
    normalizedDuration,
    normalizedSize,
    onDurationChange,
    onSizeChange,
    size,
  ]);

  // Convert duration options to RadioGroup format
  const durationRadioOptions = durationOptions.map(opt => ({
    label: opt.label,
    value: opt.value,
  }));

  // Convert size options to Select format
  const sizeSelectOptions = sizeOptions.map(opt => ({
    label: `${opt.label} (${opt.value})`,
    value: opt.value,
  }));

  return (
    <div className="video-model-options">
      {/* Duration selection */}
      <div className="video-model-options__row">
        <label className="video-model-options__label">时长</label>
        <div className="video-model-options__control">
          {durationOptions.length === 1 ? (
            // Single option - show as text
            <span className="video-model-options__fixed-value">
              {durationOptions[0].label}
            </span>
          ) : (
            // Multiple options - show as radio group
            <Radio.Group
              value={normalizedDuration}
              onChange={(value) => onDurationChange(value as string)}
              disabled={disabled}
              variant="default-filled"
              size="small"
            >
              {durationRadioOptions.map(opt => (
                <Radio.Button key={opt.value} value={opt.value}>
                  {opt.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          )}
        </div>
      </div>

      {/* Size selection */}
      <div className="video-model-options__row">
        <label className="video-model-options__label">尺寸</label>
        <div className="video-model-options__control">
          <Select
            value={normalizedSize}
            onChange={(value) => onSizeChange(value as string)}
            disabled={disabled}
            size="small"
            options={sizeSelectOptions}
            style={{ width: '200px' }}
          />
        </div>
      </div>
    </div>
  );
};

export default VideoModelOptions;
