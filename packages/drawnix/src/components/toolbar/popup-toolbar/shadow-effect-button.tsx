/**
 * 光影效果按钮组件
 * Shadow Effect Button Component
 */

import React, { useState, useCallback } from 'react';
import classNames from 'classnames';
import { HoverTip } from '../../shared/hover';
import { ToolButton } from '../../tool-button';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { Island } from '../../island';
import { ATTACHED_ELEMENT_CLASS_NAME, PlaitBoard } from '@plait/core';
import { useI18n } from '../../../i18n';
import { SHADOW_PRESETS, DEFAULT_TEXT_SHADOW, DEFAULT_GLOW } from '../../../constants/text-effects';
import type { TextShadowConfig, GlowConfig, ShadowEffectConfig } from '../../../types/text-effects.types';
import { generateTextShadowCSS, generateGlowCSS } from '../../../utils/text-effects-utils';
import { setTextShadow as applyTextShadow } from '../../../transforms/property';
import { ShadowEffectIcon } from '../../icons';
import './shadow-effect-button.scss';

export interface PopupShadowEffectButtonProps {
  board: PlaitBoard;
  currentShadow?: ShadowEffectConfig;
  title: string;
  onShadowChange?: (shadow: ShadowEffectConfig) => void;
}

type ShadowTab = 'text' | 'glow';

export const PopupShadowEffectButton: React.FC<PopupShadowEffectButtonProps> = ({
  board,
  currentShadow,
  title,
  onShadowChange,
}) => {
  const { language } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ShadowTab>('text');
  
  // 文字阴影状态
  const [textShadow, setTextShadow] = useState<TextShadowConfig>(
    currentShadow?.textShadows[0] || { ...DEFAULT_TEXT_SHADOW, enabled: true }
  );
  
  // 发光效果状态
  const [glow, setGlow] = useState<GlowConfig>(
    currentShadow?.glow || { ...DEFAULT_GLOW }
  );

  const container = PlaitBoard.getBoardContainer(board);

  // 更新阴影配置
  const updateShadow = useCallback((updates: Partial<ShadowEffectConfig>) => {
    const newConfig: ShadowEffectConfig = {
      boxShadows: currentShadow?.boxShadows || [],
      textShadows: updates.textShadows || [textShadow],
      glow: updates.glow || glow,
    };
    
    // 应用阴影到选中的文本
    const shadowCSS = updates.textShadows?.[0] 
      ? generateTextShadowCSS(updates.textShadows[0])
      : updates.glow 
        ? generateGlowCSS(updates.glow)
        : null;
    applyTextShadow(board, shadowCSS);
    
    onShadowChange?.(newConfig);
  }, [board, currentShadow, textShadow, glow, onShadowChange]);

  // 处理文字阴影变化
  const handleTextShadowChange = useCallback((key: keyof TextShadowConfig, value: any) => {
    const newShadow = { ...textShadow, [key]: value };
    setTextShadow(newShadow);
    updateShadow({ textShadows: [newShadow] });
  }, [textShadow, updateShadow]);

  // 处理发光效果变化
  const handleGlowChange = useCallback((key: keyof GlowConfig, value: any) => {
    const newGlow = { ...glow, [key]: value };
    setGlow(newGlow);
    updateShadow({ glow: newGlow });
  }, [glow, updateShadow]);

  // 应用预设
  const applyTextShadowPreset = useCallback((preset: TextShadowConfig) => {
    setTextShadow(preset);
    updateShadow({ textShadows: [preset] });
  }, [updateShadow]);

  const applyGlowPreset = useCallback((preset: GlowConfig) => {
    setGlow(preset);
    updateShadow({ glow: preset });
  }, [updateShadow]);

  // 渲染滑块控件
  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    unit: string = 'px'
  ) => (
    <div className="slider-control">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-input"
      />
    </div>
  );

  // 将 rgba 转换为 hex
  const rgbaToHex = (rgba: string): string => {
    if (!rgba) return '#000000';
    if (rgba.startsWith('#')) return rgba;
    
    const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return '#000000';
  };

  // 渲染颜色选择器
  const renderColorPicker = (
    label: string,
    value: string | undefined,
    onChange: (value: string) => void
  ) => {
    const hexValue = rgbaToHex(value || '#000000');
    return (
      <div className="color-control">
        <span className="color-label">{label}</span>
        <div className="color-input-wrapper">
          <input
            type="color"
            value={hexValue}
            onChange={(e) => onChange(e.target.value)}
            className="color-input"
          />
          <span className="color-value">{hexValue}</span>
        </div>
      </div>
    );
  };

  // 渲染文字阴影面板
  const renderTextShadowPanel = () => (
    <div className="shadow-panel">
      {/* 启用开关 */}
      <div className="toggle-control">
        <span>{language === 'zh' ? '启用文字阴影' : 'Enable Text Shadow'}</span>
        <button
          className={classNames('toggle-btn', { active: textShadow.enabled })}
          onClick={() => handleTextShadowChange('enabled', !textShadow.enabled)}
        >
          <span className="toggle-slider" />
        </button>
      </div>

      {/* 预设 */}
      <div className="presets-section">
        <div className="section-title">{language === 'zh' ? '预设' : 'Presets'}</div>
        <div className="presets-grid">
          {Object.entries(SHADOW_PRESETS.textShadow).map(([key, preset]) => (
            <HoverTip key={key} content={key} showArrow={false}>
              <button
                className="preset-item"
                onClick={() => applyTextShadowPreset(preset)}
              >
                <span
                  className="preset-preview"
                  style={{ textShadow: generateTextShadowCSS(preset) }}
                >
                  Aa
                </span>
              </button>
            </HoverTip>
          ))}
        </div>
      </div>

      {/* 自定义控制 */}
      <div className="custom-controls">
        {renderColorPicker(
          language === 'zh' ? '颜色' : 'Color',
          textShadow.color,
          (v) => handleTextShadowChange('color', v)
        )}
        {renderSlider(
          language === 'zh' ? '水平偏移' : 'Offset X',
          textShadow.offsetX,
          -20,
          20,
          (v) => handleTextShadowChange('offsetX', v)
        )}
        {renderSlider(
          language === 'zh' ? '垂直偏移' : 'Offset Y',
          textShadow.offsetY,
          -20,
          20,
          (v) => handleTextShadowChange('offsetY', v)
        )}
        {renderSlider(
          language === 'zh' ? '模糊半径' : 'Blur',
          textShadow.blur,
          0,
          30,
          (v) => handleTextShadowChange('blur', v)
        )}
      </div>
    </div>
  );

  // 渲染发光效果面板
  const renderGlowPanel = () => (
    <div className="shadow-panel">
      {/* 启用开关 */}
      <div className="toggle-control">
        <span>{language === 'zh' ? '启用发光效果' : 'Enable Glow'}</span>
        <button
          className={classNames('toggle-btn', { active: glow.enabled })}
          onClick={() => handleGlowChange('enabled', !glow.enabled)}
        >
          <span className="toggle-slider" />
        </button>
      </div>

      {/* 发光类型 */}
      <div className="glow-type-section">
        <div className="section-title">{language === 'zh' ? '发光类型' : 'Glow Type'}</div>
        <div className="glow-type-buttons">
          {(['outer', 'inner', 'neon'] as const).map((type) => (
            <button
              key={type}
              className={classNames('glow-type-btn', { active: glow.glowType === type })}
              onClick={() => handleGlowChange('glowType', type)}
            >
              {type === 'outer' && (language === 'zh' ? '外发光' : 'Outer')}
              {type === 'inner' && (language === 'zh' ? '内发光' : 'Inner')}
              {type === 'neon' && (language === 'zh' ? '霓虹灯' : 'Neon')}
            </button>
          ))}
        </div>
      </div>

      {/* 预设 */}
      <div className="presets-section">
        <div className="section-title">{language === 'zh' ? '预设' : 'Presets'}</div>
        <div className="presets-grid">
          {Object.entries(SHADOW_PRESETS.glow).map(([key, preset]) => (
            <HoverTip key={key} content={key} showArrow={false}>
              <button
                className="preset-item glow-preset"
                onClick={() => applyGlowPreset(preset)}
                style={{ '--glow-color': preset.color } as React.CSSProperties}
              >
                <span
                  className="preset-preview"
                  style={{ textShadow: generateGlowCSS(preset) }}
                >
                  ✨
                </span>
              </button>
            </HoverTip>
          ))}
        </div>
      </div>

      {/* 自定义控制 */}
      <div className="custom-controls">
        {renderColorPicker(
          language === 'zh' ? '颜色' : 'Color',
          glow.color,
          (v) => handleGlowChange('color', v)
        )}
        {renderSlider(
          language === 'zh' ? '强度' : 'Intensity',
          glow.intensity,
          0,
          100,
          (v) => handleGlowChange('intensity', v),
          '%'
        )}
        {renderSlider(
          language === 'zh' ? '半径' : 'Radius',
          glow.radius,
          0,
          50,
          (v) => handleGlowChange('radius', v)
        )}
      </div>
    </div>
  );

  return (
    <Popover
      sideOffset={12}
      open={isOpen}
      onOpenChange={setIsOpen}
      placement="top"
    >
      <PopoverTrigger asChild>
        <ToolButton
          className={classNames('property-button', 'shadow-effect-button')}
          selected={isOpen}
          visible={true}
          icon={<ShadowEffectIcon />}
          type="button"
          tooltip={title}
          aria-label={title}
          onPointerUp={() => setIsOpen(!isOpen)}
        />
      </PopoverTrigger>
      <PopoverContent container={container}>
        <Island padding={4} className={classNames(ATTACHED_ELEMENT_CLASS_NAME, 'shadow-effect-panel')}>
          <div className="shadow-tabs">
            <button
              className={classNames('shadow-tab', { active: activeTab === 'text' })}
              onClick={() => setActiveTab('text')}
            >
              {language === 'zh' ? '文字阴影' : 'Text Shadow'}
            </button>
            <button
              className={classNames('shadow-tab', { active: activeTab === 'glow' })}
              onClick={() => setActiveTab('glow')}
            >
              {language === 'zh' ? '发光效果' : 'Glow'}
            </button>
          </div>
          <div className="shadow-content">
            {activeTab === 'text' && renderTextShadowPanel()}
            {activeTab === 'glow' && renderGlowPanel()}
          </div>
        </Island>
      </PopoverContent>
    </Popover>
  );
};

export default PopupShadowEffectButton;
