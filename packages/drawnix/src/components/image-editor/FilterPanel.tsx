/**
 * 滤镜面板组件
 */

import React from 'react';
import { Slider } from 'tdesign-react';
import { FilterType, FilterParams, FilterPreset } from './types';
import { DecodedImagePreview } from './DecodedImagePreview';

interface FilterPanelProps {
  filterType: FilterType;
  filterParams: FilterParams;
  presets: FilterPreset[];
  image: HTMLImageElement | null;
  onPresetSelect: (type: FilterType) => void;
  onParamChange: (param: keyof FilterParams, value: number) => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filterType,
  filterParams,
  presets,
  image,
  onPresetSelect,
  onParamChange,
}) => {
  return (
    <div className="filter-panel">
      {/* 滤镜预设 */}
      <div className="filter-panel__section">
        <div className="filter-panel__section-title">滤镜预设</div>
        <div className="filter-panel__preset-grid">
          {presets.map((preset) => (
            <button
              key={preset.type}
              type="button"
              className={`filter-panel__preset-btn ${
                filterType === preset.type ? 'active' : ''
              }`}
              onClick={() => onPresetSelect(preset.type)}
            >
              <div
                className="filter-panel__preset-preview"
                style={{
                  filter: preset.filter,
                }}
              >
                {image && (
                  <DecodedImagePreview
                    image={image}
                    maxSize={96}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                )}
              </div>
              <span className="filter-panel__preset-label">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 滤镜参数调节 */}
      <div className="filter-panel__section">
        <div className="filter-panel__section-title">参数调节</div>
        <div className="filter-panel__sliders">
          <FilterSlider
            label="亮度"
            value={filterParams.brightness}
            min={0}
            max={200}
            defaultValue={100}
            onChange={(v) => onParamChange('brightness', v)}
          />
          <FilterSlider
            label="对比度"
            value={filterParams.contrast}
            min={0}
            max={200}
            defaultValue={100}
            onChange={(v) => onParamChange('contrast', v)}
          />
          <FilterSlider
            label="饱和度"
            value={filterParams.saturate}
            min={0}
            max={200}
            defaultValue={100}
            onChange={(v) => onParamChange('saturate', v)}
          />
          <FilterSlider
            label="灰度"
            value={filterParams.grayscale}
            min={0}
            max={100}
            defaultValue={0}
            onChange={(v) => onParamChange('grayscale', v)}
          />
          <FilterSlider
            label="复古"
            value={filterParams.sepia}
            min={0}
            max={100}
            defaultValue={0}
            onChange={(v) => onParamChange('sepia', v)}
          />
          <FilterSlider
            label="色相"
            value={filterParams.hueRotate}
            min={0}
            max={360}
            defaultValue={0}
            onChange={(v) => onParamChange('hueRotate', v)}
          />
          <FilterSlider
            label="模糊"
            value={filterParams.blur}
            min={0}
            max={10}
            defaultValue={0}
            step={0.5}
            onChange={(v) => onParamChange('blur', v)}
          />
        </div>
      </div>
    </div>
  );
};

interface FilterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  onChange: (value: number) => void;
}

const FilterSlider: React.FC<FilterSliderProps> = ({
  label,
  value,
  min,
  max,
  defaultValue,
  step = 1,
  onChange,
}) => {
  const isDefault = value === defaultValue;

  return (
    <div className="filter-slider">
      <div className="filter-slider__header">
        <span className="filter-slider__label">{label}</span>
        <span
          className={`filter-slider__value ${!isDefault ? 'modified' : ''}`}
        >
          {value}
        </span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(val) => onChange(val as number)}
      />
    </div>
  );
};

export default FilterPanel;
