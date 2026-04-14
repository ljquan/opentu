/**
 * 文本属性面板组件
 * Text Property Panel Component
 * 
 * 从选中元素右侧滑出的属性设置面板，整合字体、字号、颜色、阴影、渐变等设置
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import classNames from 'classnames';
import { PlaitBoard } from '@plait/core';
import { FontSizes, TextTransforms } from '@plait/text-plugins';
import { useI18n } from '../../../i18n';
import { UnifiedColorPicker } from '../../unified-color-picker';
import { useConfirmDialog } from '../../dialog/ConfirmDialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { Island } from '../../island';
import { GradientEditor, generateGradientCSS as generateFillGradientCSS } from '../../gradient-editor';
import type { GradientFillConfig } from '../../../types/fill.types';
import {
  setTextFontSize,
  setTextFontFamily,
  setTextShadow,
  setTextGradient,
  setTextFontWeight,
  setTextAlign,
  setTextLineHeight,
  setTextLetterSpacing,
  getTextCustomMarks,
  getTextAlign,
  toggleTextBold,
  toggleTextItalic,
  toggleTextUnderline,
  toggleTextStrikethrough,
  toggleTextSuperscript,
  toggleTextSubscript,
  setTextBackgroundColor,
  setTextTransform,
  setTextStroke,
  setTextDecorationStyle,
  setTextDecorationColor,
} from '../../../transforms/property';
import {
  SYSTEM_FONTS,
  GOOGLE_FONTS,
  SHADOW_PRESETS,
  GRADIENT_PRESETS,
} from '../../../constants/text-effects';
import type { FontConfig, TextShadowConfig, GradientConfig } from '../../../types/text-effects.types';
import { generateTextShadowCSS, generateGradientCSS } from '../../../utils/text-effects-utils';
import { fontManagerService } from '../../../services/font-manager-service';
import { LS_KEYS_TO_MIGRATE } from '../../../constants/storage-keys';
import { kvStorageService } from '../../../services/kv-storage-service';
import './text-property-panel.scss';

const CUSTOM_GRADIENTS_KEY = LS_KEYS_TO_MIGRATE.CUSTOM_GRADIENTS;

export interface TextPropertyPanelProps {
  board: PlaitBoard;
  isOpen: boolean;
  onClose: () => void;
  currentFontSize?: string;
  currentFontFamily?: string;
  currentColor?: string;
  /** popup-toolbar 的位置信息，用于定位属性面板 */
  toolbarRect?: { top: number; left: number; width: number; height: number };
  /** 选中元素的位置信息，用于定位属性面板 */
  selectionRect?: { top: number; left: number; right: number; bottom: number; width: number; height: number };
}

const fontSizePresets = ['12', '14', '16', '18', '20', '24', '28', '32', '40', '48', '64', '72'];

export const TextPropertyPanel: React.FC<TextPropertyPanelProps> = ({
  board,
  isOpen,
  onClose,
  currentFontSize,
  currentFontFamily,
  currentColor,
  toolbarRect,
  selectionRect,
}) => {
  const { t, language } = useI18n();
  const { confirm, confirmDialog } = useConfirmDialog({
    container: PlaitBoard.getBoardContainer(board),
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [fontSizeInput, setFontSizeInput] = useState(currentFontSize || '16');
  const [isFontDropdownOpen, setIsFontDropdownOpen] = useState(false);
  const [selectedFont, setSelectedFont] = useState(currentFontFamily || 'PingFang SC');
  const [loadingFonts, setLoadingFonts] = useState<Set<string>>(new Set());
  
  // 新增文本属性状态
  const [fontWeight, setFontWeight] = useState<number>(400);
  const [textAlignState, setTextAlignState] = useState<'left' | 'center' | 'right'>('left');
  const [lineHeight, setLineHeight] = useState<number>(1.5);
  const [letterSpacing, setLetterSpacing] = useState<number>(0);

  // 文本样式状态
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isSuperscript, setIsSuperscript] = useState(false);
  const [isSubscript, setIsSubscript] = useState(false);

  // 扩展样式状态
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [textTransform, setTextTransformState] = useState<string | null>(null);
  const [strokeWidth, setStrokeWidth] = useState<number>(0);
  const [strokeColor, setStrokeColor] = useState<string>('#000000');
  const [decorationStyle, setDecorationStyle] = useState<string | null>(null);
  const [decorationColor, setDecorationColor] = useState<string | null>(null);

  // 阴影状态
  const [shadowEnabled, setShadowEnabled] = useState(false);
  const [selectedShadowPreset, setSelectedShadowPreset] = useState<string | null>(null);
  const [shadowConfig, setShadowConfig] = useState({
    color: 'rgba(0, 0, 0, 0.5)',
    offsetX: 2,
    offsetY: 2,
    blur: 4,
  });
  
  // 渐变状态
  const [gradientEnabled, setGradientEnabled] = useState(false);
  const [selectedGradientPreset, setSelectedGradientPreset] = useState<string | null>(null);
  const [gradientConfig, setGradientConfig] = useState<GradientFillConfig>({
    type: 'linear',
    angle: 135,
    stops: [
      { color: '#FF6B6B', offset: 0 },
      { color: '#4ECDC4', offset: 1 },
    ],
  });
  
  // 自定义渐变预设
  const [customGradients, setCustomGradients] = useState<Array<{ id: string; css: string }>>([]);
  
  // 颜色状态 - 用于受控的 UnifiedColorPicker
  const [colorValue, setColorValue] = useState(currentColor || '#000000');

  // 阴影颜色选择器 Popover 状态
  const [shadowColorPickerOpen, setShadowColorPickerOpen] = useState(false);

  // 从 IndexedDB 加载渐变数据
  useEffect(() => {
    let mounted = true;
    kvStorageService.get<Array<{ id: string; css: string }>>(CUSTOM_GRADIENTS_KEY)
      .then((gradients) => {
        if (!mounted) return;
        if (gradients) setCustomGradients(gradients);
      })
      .catch((e) => {
        console.warn('Failed to load gradient data:', e);
      });
    return () => { mounted = false; };
  }, []);

  // 面板打开时,从文本 marks 中读取当前样式进行反显
  useEffect(() => {
    if (isOpen) {
      const marks = getTextCustomMarks(board);

      // 反显渐变
      if (marks['text-gradient']) {
        setGradientEnabled(true);
        const matchedPreset = GRADIENT_PRESETS.find(preset => {
          const presetCSS = generateGradientCSS(preset.config);
          return presetCSS === marks['text-gradient'];
        });
        if (matchedPreset) {
          setSelectedGradientPreset(matchedPreset.id);
        } else {
          setSelectedGradientPreset(null);
        }
      } else {
        setGradientEnabled(false);
        setSelectedGradientPreset(null);
      }

      // 反显阴影
      if (marks['text-shadow']) {
        setShadowEnabled(true);
        const shadowValue = marks['text-shadow'];
        let matchedKey: string | null = null;
        for (const [key, preset] of Object.entries(SHADOW_PRESETS.textShadow)) {
          const presetCSS = generateTextShadowCSS(preset);
          if (presetCSS === shadowValue) {
            matchedKey = key;
            break;
          }
        }
        if (matchedKey) {
          setSelectedShadowPreset(matchedKey);
        } else {
          setSelectedShadowPreset(null);
        }
      } else {
        setShadowEnabled(false);
        setSelectedShadowPreset(null);
      }

      // 反显字体
      if (marks['font-family']) {
        setSelectedFont(marks['font-family']);
      }

      // 反显字重
      if (marks['font-weight']) {
        setFontWeight(Number(marks['font-weight']));
      }

      // 反显行高
      if (marks['line-height']) {
        setLineHeight(Number(marks['line-height']));
      }

      // 反显字间距
      if (marks['letter-spacing']) {
        const value = String(marks['letter-spacing']).replace('px', '');
        setLetterSpacing(Number(value));
      }

      // 反显文本对齐
      const align = getTextAlign(board);
      setTextAlignState(align);

      // 反显文本样式
      setIsBold(!!marks.bold);
      setIsItalic(!!marks.italic);
      setIsUnderline(!!marks.underlined);
      setIsStrikethrough(!!marks.strikethrough);
      setIsSuperscript(!!marks.superscript);
      setIsSubscript(!!marks.subscript);

      // 反显扩展样式
      setBgColor(marks['background-color'] || null);
      setTextTransformState(marks['text-transform'] || null);
      setStrokeWidth(marks['text-stroke'] || 0);
      setStrokeColor(marks['text-stroke-color'] || '#000000');
      setDecorationStyle(marks['text-decoration-style'] || null);
      setDecorationColor(marks['text-decoration-color'] || null);
    }
  }, [isOpen, board]);

  // 预加载 Google Fonts（当面板打开时）
  useEffect(() => {
    if (isOpen && !isFontDropdownOpen) {
      // 延迟预加载，避免阻塞 UI
      const timer = setTimeout(() => {
        GOOGLE_FONTS.forEach(font => {
          if (!fontManagerService.isFontLoaded(font.family)) {
            fontManagerService.loadGoogleFont(font.family).catch(err => {
              console.warn(`Failed to preload font ${font.family}:`, err);
            });
          }
        });
      }, 500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, isFontDropdownOpen]);

  // 计算面板位置 - 在选中元素右侧，且在 popup-toolbar 下方
  useEffect(() => {
    if (isOpen && toolbarRect && selectionRect) {
      const panelWidth = 320;
      const panelHeight = 520;
      const gap = 12; // 与选中元素的间距

      // 面板位置：选中元素右侧 + gap
      let panelLeft = selectionRect.right + gap;

      // 面板顶部：与 toolbar 底部对齐（toolbar 下方）
      let panelTop = toolbarRect.top + toolbarRect.height + 8;

      // 确保面板不超出视口右侧
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // 如果右侧空间不足，尝试放在左侧
      if (panelLeft + panelWidth > viewportWidth - 16) {
        panelLeft = selectionRect.left - panelWidth - gap;
        // 如果左侧也不够，强制放在右侧并调整到视口内
        if (panelLeft < 16) {
          panelLeft = viewportWidth - panelWidth - 16;
        }
      }

      // 确保面板不超出视口底部
      if (panelTop + panelHeight > viewportHeight - 16) {
        panelTop = Math.max(16, viewportHeight - panelHeight - 16);
      }

      setPosition({
        left: Math.max(16, panelLeft),
        top: Math.max(16, panelTop),
      });
    }
  }, [isOpen, toolbarRect, selectionRect]);

  // 处理字号变更
  const handleFontSizeChange = useCallback((size: string) => {
    const num = parseInt(size, 10);
    if (!isNaN(num) && num >= 8 && num <= 100) {
      setFontSizeInput(size);
      setTextFontSize(board, size as FontSizes);
    }
  }, [board]);

  // 处理字体选择
  const handleFontSelect = useCallback(async (font: FontConfig) => {
    setSelectedFont(font.family);
    setIsFontDropdownOpen(false);

    // 如果是 Google Font，使用字体管理服务加载
    if (font.source === 'google' && !fontManagerService.isFontLoaded(font.family)) {
      setLoadingFonts(prev => new Set(prev).add(font.family));
      try {
        await fontManagerService.loadGoogleFont(font.family);
      } catch (error) {
        console.error('Failed to load Google font:', error);
      } finally {
        setLoadingFonts(prev => {
          const next = new Set(prev);
          next.delete(font.family);
          return next;
        });
      }
    }

    setTextFontFamily(board, font.family);
  }, [board]);

  // 当 currentColor prop 变化时，同步更新本地状态
  useEffect(() => {
    if (currentColor) {
      setColorValue(currentColor);
    }
  }, [currentColor]);

  // 处理颜色变更
  const handleColorChange = useCallback((color: string) => {
    setColorValue(color);
    TextTransforms.setTextColor(board, color);
  }, [board]);

  // 处理阴影预设选择
  const handleShadowPresetSelect = useCallback((presetKey: string, preset: TextShadowConfig) => {
    setSelectedShadowPreset(presetKey);
    setShadowEnabled(true);
    setShadowConfig({
      color: preset.color,
      offsetX: preset.offsetX,
      offsetY: preset.offsetY,
      blur: preset.blur,
    });
    const shadowCSS = generateTextShadowCSS(preset);
    setTextShadow(board, shadowCSS);
  }, [board]);

  // 处理阴影配置变更
  const handleShadowConfigChange = useCallback((key: keyof typeof shadowConfig, value: number | string) => {
    const newConfig = { ...shadowConfig, [key]: value };
    setShadowConfig(newConfig);
    setSelectedShadowPreset(null);
    const shadowCSS = `${newConfig.offsetX}px ${newConfig.offsetY}px ${newConfig.blur}px ${newConfig.color}`;
    setTextShadow(board, shadowCSS);
  }, [board, shadowConfig]);

  // 应用当前渐变配置（来自 GradientEditor 的变更）
  const handleGradientConfigChange = useCallback((config: GradientFillConfig) => {
    setGradientConfig(config);
    setSelectedGradientPreset(null);
    // 生成 CSS 并应用
    const gradientCSS = generateFillGradientCSS(config);
    setTextGradient(board, gradientCSS);
  }, [board]);

  // 保存当前渐变到快捷选择
  const saveCurrentGradient = useCallback(() => {
    const gradientCSS = generateFillGradientCSS(gradientConfig);
    const newGradient = {
      id: `custom-${Date.now()}`,
      css: gradientCSS,
    };
    const updated = [newGradient, ...customGradients].slice(0, 8);
    setCustomGradients(updated);
    kvStorageService.set(CUSTOM_GRADIENTS_KEY, updated).catch((e) => {
      console.warn('Failed to save custom gradients:', e);
    });
  }, [gradientConfig, customGradients]);

  // 删除自定义渐变
  const deleteCustomGradient = useCallback(async (id: string) => {
    const confirmed = await confirm({
      title: language === 'zh' ? '确认删除渐变预设' : 'Delete Gradient Preset',
      description:
        language === 'zh'
          ? '确定要删除这个自定义渐变预设吗？'
          : 'Are you sure you want to delete this custom gradient preset?',
      confirmText: language === 'zh' ? '删除' : 'Delete',
      cancelText: language === 'zh' ? '取消' : 'Cancel',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    const updated = customGradients.filter(g => g.id !== id);
    setCustomGradients(updated);
    kvStorageService.set(CUSTOM_GRADIENTS_KEY, updated).catch((e) => {
      console.warn('Failed to save custom gradients:', e);
    });
  }, [confirm, customGradients, language]);

  // 切换阴影开关
  const toggleShadow = useCallback(() => {
    const newEnabled = !shadowEnabled;
    setShadowEnabled(newEnabled);
    if (!newEnabled) {
      setTextShadow(board, null);
      setSelectedShadowPreset(null);
    }
  }, [board, shadowEnabled]);

  // 切换渐变开关
  const toggleGradient = useCallback(() => {
    const newEnabled = !gradientEnabled;
    setGradientEnabled(newEnabled);
    if (!newEnabled) {
      setTextGradient(board, null);
      setSelectedGradientPreset(null);
    }
  }, [board, gradientEnabled]);

  // 处理字重变更
  const handleFontWeightChange = useCallback((weight: number) => {
    setFontWeight(weight);
    setTextFontWeight(board, weight);
  }, [board]);

  // 处理文本对齐变更
  const handleTextAlignChange = useCallback((align: 'left' | 'center' | 'right') => {
    setTextAlignState(align);
    setTextAlign(board, align);
  }, [board]);

  // 处理行高变更
  const handleLineHeightChange = useCallback((height: number) => {
    setLineHeight(height);
    setTextLineHeight(board, height);
  }, [board]);

  // 处理字间距变更
  const handleLetterSpacingChange = useCallback((spacing: number) => {
    setLetterSpacing(spacing);
    setTextLetterSpacing(board, spacing);
  }, [board]);

  // 处理加粗切换
  const handleBoldToggle = useCallback(() => {
    setIsBold(!isBold);
    toggleTextBold(board);
  }, [board, isBold]);

  // 处理斜体切换
  const handleItalicToggle = useCallback(() => {
    setIsItalic(!isItalic);
    toggleTextItalic(board);
  }, [board, isItalic]);

  // 处理下划线切换
  const handleUnderlineToggle = useCallback(() => {
    setIsUnderline(!isUnderline);
    toggleTextUnderline(board);
  }, [board, isUnderline]);

  // 处理删除线切换
  const handleStrikethroughToggle = useCallback(() => {
    setIsStrikethrough(!isStrikethrough);
    toggleTextStrikethrough(board);
  }, [board, isStrikethrough]);

  // 处理上标切换
  const handleSuperscriptToggle = useCallback(() => {
    const newValue = !isSuperscript;
    setIsSuperscript(newValue);
    if (newValue) setIsSubscript(false);
    toggleTextSuperscript(board);
  }, [board, isSuperscript]);

  // 处理下标切换
  const handleSubscriptToggle = useCallback(() => {
    const newValue = !isSubscript;
    setIsSubscript(newValue);
    if (newValue) setIsSuperscript(false);
    toggleTextSubscript(board);
  }, [board, isSubscript]);

  // 处理背景色变更
  const handleBgColorChange = useCallback((color: string | null) => {
    setBgColor(color);
    setTextBackgroundColor(board, color);
  }, [board]);

  // 处理大小写转换
  const handleTextTransformChange = useCallback((transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize') => {
    const newValue = transform === textTransform ? null : transform;
    setTextTransformState(newValue);
    setTextTransform(board, newValue as any);
  }, [board, textTransform]);

  // 处理描边变更
  const handleStrokeChange = useCallback((width: number, color?: string) => {
    setStrokeWidth(width);
    if (color) setStrokeColor(color);
    setTextStroke(board, width > 0 ? width : null, color || strokeColor);
  }, [board, strokeColor]);

  // 处理装饰线样式变更
  const handleDecorationStyleChange = useCallback((style: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy' | null) => {
    setDecorationStyle(style);
    setTextDecorationStyle(board, style);
  }, [board]);

  // 处理装饰线颜色变更
  const handleDecorationColorChange = useCallback((color: string | null) => {
    setDecorationColor(color);
    setTextDecorationColor(board, color);
  }, [board]);

  // 点击外部关闭 - 使用全局点击监听
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // 检查是否点击在面板内部
      if (panelRef.current && panelRef.current.contains(target)) {
        return;
      }

      // 检查是否点击在 popup-toolbar 上（通过 class 判断）
      const isToolbarClick = target.closest('.popup-toolbar') !== null;
      if (isToolbarClick) {
        return; // 不关闭面板，让 toolbar 按钮正常工作
      }

      // 点击在外部，关闭面板
      onClose();
    };

    // 延迟添加监听器，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // 点击外部关闭（遮罩层）- 已废弃，使用全局监听代替
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // 遮罩层现在是 pointer-events: none，这个函数不会被调用
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // 字重下拉状态
  const [isWeightDropdownOpen, setIsWeightDropdownOpen] = useState(false);

  // 字重选项
  const fontWeightOptions = [
    { value: 100, label: 'Thin', labelZh: '极细' },
    { value: 200, label: 'Extra Light', labelZh: '特细' },
    { value: 300, label: 'Light', labelZh: '细体' },
    { value: 400, label: 'Regular', labelZh: '常规' },
    { value: 500, label: 'Medium', labelZh: '中等' },
    { value: 600, label: 'Semi Bold', labelZh: '半粗' },
    { value: 700, label: 'Bold', labelZh: '粗体' },
    { value: 800, label: 'Extra Bold', labelZh: '特粗' },
    { value: 900, label: 'Black', labelZh: '黑体' },
  ];

  // 获取当前字重的显示名称
  const getWeightDisplayName = useCallback((weight: number) => {
    const option = fontWeightOptions.find(o => o.value === weight);
    return option ? (language === 'zh' ? option.labelZh : option.label) : String(weight);
  }, [language]);

  // 合并字体列表
  const allFonts = [...SYSTEM_FONTS, ...GOOGLE_FONTS];

  // 根据 font family 获取显示名称
  const getDisplayName = useCallback((fontFamily: string) => {
    const font = allFonts.find(f => f.family === fontFamily);
    return font?.displayName || fontFamily;
  }, [allFonts]);

  if (!isOpen) return null;

  return (
    <>
      {/* 遮罩层 - 用于点击外部关闭 */}
      <div 
        className="text-property-panel-overlay" 
        onClick={handleOverlayClick}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
      
      {/* 属性面板 */}
      <div
        ref={panelRef}
        className={classNames('text-property-panel', { 'is-open': isOpen })}
        style={{ top: position.top, left: position.left }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="text-property-panel__header">
          <span className="text-property-panel__header-title">
            {t('propertyPanel.title')}
          </span>
          <button className="text-property-panel__header-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="text-property-panel__content">
          {/* 基础文字属性 - 紧凑行内布局 */}
          <div className="text-property-panel__section">
            <div className="text-property-panel__section-content">
              {/* 字号 - 滑条 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '字号' : 'Size'}</label>
                <div className="inline-control__slider-group">
                  <input
                    type="range"
                    className="inline-control__slider"
                    value={fontSizeInput}
                    min={8}
                    max={100}
                    step={1}
                    onChange={(e) => {
                      setFontSizeInput(e.target.value);
                      handleFontSizeChange(e.target.value);
                    }}
                  />
                  <span className="inline-control__value">{fontSizeInput}</span>
                </div>
              </div>

              {/* 字体 - 自定义下拉 */}
              <div className="inline-control inline-control--dropdown">
                <label className="inline-control__label">{language === 'zh' ? '字体' : 'Font'}</label>
                <div className="custom-dropdown">
                  <div
                    className={classNames('custom-dropdown__trigger', { 'is-expanded': isFontDropdownOpen })}
                    onClick={() => {
                      setIsFontDropdownOpen(!isFontDropdownOpen);
                      setIsWeightDropdownOpen(false);
                    }}
                  >
                    <span
                      className="custom-dropdown__value"
                      style={{ fontFamily: `'${selectedFont}', sans-serif` }}
                    >
                      {getDisplayName(selectedFont)}
                    </span>
                    <svg className="custom-dropdown__arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className={classNames('custom-dropdown__menu custom-dropdown__menu--font', { 'is-open': isFontDropdownOpen })}>
                    {allFonts.map((font) => (
                      <div
                        key={font.family}
                        className={classNames('custom-dropdown__item custom-dropdown__item--font', {
                          'is-active': selectedFont === font.family,
                        })}
                        onClick={() => {
                          handleFontSelect(font);
                          setIsFontDropdownOpen(false);
                        }}
                      >
                        <span className="custom-dropdown__item-label">{font.displayName}</span>
                        <span
                          className="custom-dropdown__item-preview"
                          style={{ fontFamily: `'${font.family}', sans-serif` }}
                        >
                          {font.previewText}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 字重 - 自定义下拉 */}
              <div className="inline-control inline-control--dropdown">
                <label className="inline-control__label">{language === 'zh' ? '字重' : 'Weight'}</label>
                <div className="custom-dropdown">
                  <div
                    className={classNames('custom-dropdown__trigger', { 'is-expanded': isWeightDropdownOpen })}
                    onClick={() => {
                      setIsWeightDropdownOpen(!isWeightDropdownOpen);
                      setIsFontDropdownOpen(false);
                    }}
                  >
                    <span className="custom-dropdown__value" style={{ fontWeight: fontWeight }}>
                      {getWeightDisplayName(fontWeight)}
                    </span>
                    <svg className="custom-dropdown__arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className={classNames('custom-dropdown__menu', { 'is-open': isWeightDropdownOpen })}>
                    {fontWeightOptions.map((option) => (
                      <div
                        key={option.value}
                        className={classNames('custom-dropdown__item', {
                          'is-active': fontWeight === option.value,
                        })}
                        onClick={() => {
                          handleFontWeightChange(option.value);
                          setIsWeightDropdownOpen(false);
                        }}
                      >
                        <span
                          className="custom-dropdown__item-label"
                          style={{ fontWeight: option.value }}
                        >
                          {language === 'zh' ? option.labelZh : option.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 对齐 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '对齐' : 'Align'}</label>
                <div className="align-buttons align-buttons--compact">
                  <button
                    className={classNames('align-buttons__btn', { 'is-active': textAlignState === 'left' })}
                    onClick={() => handleTextAlignChange('left')}
                    title={language === 'zh' ? '左对齐' : 'Align Left'}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 3h12v2H2V3zm0 4h8v2H2V7zm0 4h12v2H2v-2z"/>
                    </svg>
                  </button>
                  <button
                    className={classNames('align-buttons__btn', { 'is-active': textAlignState === 'center' })}
                    onClick={() => handleTextAlignChange('center')}
                    title={language === 'zh' ? '居中对齐' : 'Align Center'}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 3h12v2H2V3zm2 4h8v2H4V7zm-2 4h12v2H2v-2z"/>
                    </svg>
                  </button>
                  <button
                    className={classNames('align-buttons__btn', { 'is-active': textAlignState === 'right' })}
                    onClick={() => handleTextAlignChange('right')}
                    title={language === 'zh' ? '右对齐' : 'Align Right'}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 3h12v2H2V3zm4 4h8v2H6V7zm-4 4h12v2H2v-2z"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* 样式 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '样式' : 'Style'}</label>
                <div className="style-buttons">
                  <button
                    className={classNames('style-buttons__btn', { 'is-active': isBold })}
                    onClick={handleBoldToggle}
                    title={language === 'zh' ? '加粗' : 'Bold'}
                  >
                    <span className="style-buttons__icon style-buttons__icon--bold">B</span>
                  </button>
                  <button
                    className={classNames('style-buttons__btn', { 'is-active': isItalic })}
                    onClick={handleItalicToggle}
                    title={language === 'zh' ? '斜体' : 'Italic'}
                  >
                    <span className="style-buttons__icon style-buttons__icon--italic">I</span>
                  </button>
                  <button
                    className={classNames('style-buttons__btn', { 'is-active': isUnderline })}
                    onClick={handleUnderlineToggle}
                    title={language === 'zh' ? '下划线' : 'Underline'}
                  >
                    <span className="style-buttons__icon style-buttons__icon--underline">U</span>
                  </button>
                  <button
                    className={classNames('style-buttons__btn', { 'is-active': isStrikethrough })}
                    onClick={handleStrikethroughToggle}
                    title={language === 'zh' ? '删除线' : 'Strikethrough'}
                  >
                    <span className="style-buttons__icon style-buttons__icon--strikethrough">S</span>
                  </button>
                  <button
                    className={classNames('style-buttons__btn', { 'is-active': isSuperscript })}
                    onClick={handleSuperscriptToggle}
                    title={language === 'zh' ? '上标' : 'Superscript'}
                  >
                    <span className="style-buttons__icon style-buttons__icon--superscript">X<sup>2</sup></span>
                  </button>
                  <button
                    className={classNames('style-buttons__btn', { 'is-active': isSubscript })}
                    onClick={handleSubscriptToggle}
                    title={language === 'zh' ? '下标' : 'Subscript'}
                  >
                    <span className="style-buttons__icon style-buttons__icon--subscript">X<sub>2</sub></span>
                  </button>
                </div>
              </div>

              {/* 大小写 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '大小写' : 'Case'}</label>
                <div className="case-buttons">
                  <button
                    className={classNames('case-buttons__btn', { 'is-active': textTransform === 'uppercase' })}
                    onClick={() => handleTextTransformChange('uppercase')}
                    title={language === 'zh' ? '全大写' : 'Uppercase'}
                  >
                    AA
                  </button>
                  <button
                    className={classNames('case-buttons__btn', { 'is-active': textTransform === 'lowercase' })}
                    onClick={() => handleTextTransformChange('lowercase')}
                    title={language === 'zh' ? '全小写' : 'Lowercase'}
                  >
                    aa
                  </button>
                  <button
                    className={classNames('case-buttons__btn', { 'is-active': textTransform === 'capitalize' })}
                    onClick={() => handleTextTransformChange('capitalize')}
                    title={language === 'zh' ? '首字母大写' : 'Capitalize'}
                  >
                    Aa
                  </button>
                </div>
              </div>

              {/* 行高 - 滑条 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '行高' : 'Line'}</label>
                <div className="inline-control__slider-group">
                  <input
                    type="range"
                    className="inline-control__slider"
                    value={lineHeight}
                    min={0.8}
                    max={3}
                    step={0.1}
                    onChange={(e) => handleLineHeightChange(Number(e.target.value))}
                  />
                  <span className="inline-control__value">{lineHeight.toFixed(1)}</span>
                </div>
              </div>

              {/* 字间距 - 滑条 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '字距' : 'Spacing'}</label>
                <div className="inline-control__slider-group">
                  <input
                    type="range"
                    className="inline-control__slider"
                    value={letterSpacing}
                    min={-2}
                    max={10}
                    step={0.5}
                    onChange={(e) => handleLetterSpacingChange(Number(e.target.value))}
                  />
                  <span className="inline-control__value">{letterSpacing}px</span>
                </div>
              </div>
            </div>
          </div>

          {/* 颜色设置 */}
          <div className="text-property-panel__section">
            <div className="text-property-panel__section-title">
              {t('propertyPanel.textColor')}
            </div>
            <div className="text-property-panel__section-content text-color-picker">
              <UnifiedColorPicker
                value={colorValue}
                onChange={handleColorChange}
                showAlpha={true}
                showEyeDropper={true}
                showPresets={true}
                showRecentColors={true}
                showHexInput={true}
              />
            </div>
          </div>

          {/* 扩展效果 */}
          <div className="text-property-panel__section">
            <div className="text-property-panel__section-content">
              {/* 背景高亮 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '高亮' : 'Highlight'}</label>
                <div className="highlight-colors">
                  <button
                    className={classNames('highlight-colors__btn highlight-colors__btn--none', { 'is-active': !bgColor })}
                    onClick={() => handleBgColorChange(null)}
                    title={language === 'zh' ? '无' : 'None'}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16">
                      <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </button>
                  {['#FFEB3B', '#4CAF50', '#2196F3', '#E91E63', '#FF9800', '#9C27B0'].map(color => (
                    <button
                      key={color}
                      className={classNames('highlight-colors__btn', { 'is-active': bgColor === color })}
                      style={{ backgroundColor: color }}
                      onClick={() => handleBgColorChange(color)}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {/* 描边 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '描边' : 'Stroke'}</label>
                <div className="inline-control__slider-group">
                  <input
                    type="range"
                    className="inline-control__slider"
                    value={strokeWidth}
                    min={0}
                    max={3}
                    step={0.5}
                    onChange={(e) => handleStrokeChange(Number(e.target.value))}
                  />
                  <span className="inline-control__value">{strokeWidth}px</span>
                  {strokeWidth > 0 && (
                    <input
                      type="color"
                      className="inline-control__color-input"
                      value={strokeColor}
                      onChange={(e) => handleStrokeChange(strokeWidth, e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* 装饰线样式 - 仅在有下划线或删除线时显示 */}
              {(isUnderline || isStrikethrough) && (
                <>
                  <div className="inline-control">
                    <label className="inline-control__label">{language === 'zh' ? '线型' : 'Line Style'}</label>
                    <div className="decoration-style-buttons">
                      {(['solid', 'double', 'dotted', 'dashed', 'wavy'] as const).map(style => (
                        <button
                          key={style}
                          className={classNames('decoration-style-buttons__btn', { 'is-active': decorationStyle === style })}
                          onClick={() => handleDecorationStyleChange(decorationStyle === style ? null : style)}
                          title={style}
                        >
                          <span className={`decoration-preview decoration-preview--${style}`}>Ab</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="inline-control">
                    <label className="inline-control__label">{language === 'zh' ? '线色' : 'Line Color'}</label>
                    <div className="highlight-colors">
                      <button
                        className={classNames('highlight-colors__btn highlight-colors__btn--none', { 'is-active': !decorationColor })}
                        onClick={() => handleDecorationColorChange(null)}
                        title={language === 'zh' ? '默认' : 'Default'}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16">
                          <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      </button>
                      {['#E91E63', '#FF5722', '#4CAF50', '#2196F3', '#9C27B0', '#000000'].map(color => (
                        <button
                          key={color}
                          className={classNames('highlight-colors__btn', { 'is-active': decorationColor === color })}
                          style={{ backgroundColor: color }}
                          onClick={() => handleDecorationColorChange(color)}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 阴影效果 */}
          <div className="text-property-panel__section">
            <div className="text-property-panel__section-content">
              {/* 阴影开关 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '阴影' : 'Shadow'}</label>
                <div
                  className={classNames('toggle-switch__control toggle-switch__control--inline', { 'is-active': shadowEnabled })}
                  onClick={toggleShadow}
                />
              </div>
              
              {shadowEnabled && (
                <>
                  {/* 阴影预设 */}
                  <div className="effect-presets">
                    {Object.entries(SHADOW_PRESETS.textShadow).map(([key, preset]) => (
                      <div
                        key={key}
                        className={classNames('effect-presets__item', {
                          'is-active': selectedShadowPreset === key,
                        })}
                        onClick={() => handleShadowPresetSelect(key, preset)}
                        title={key}
                      >
                        <span style={{ textShadow: generateTextShadowCSS(preset) }}>Aa</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* 阴影细节配置 */}
                  <div className="effect-config">
                    {/* 阴影颜色 */}
                    <div className="inline-control">
                      <label className="inline-control__label">{language === 'zh' ? '颜色' : 'Color'}</label>
                      <div className="inline-control__color-group">
                        <Popover
                          open={shadowColorPickerOpen}
                          onOpenChange={setShadowColorPickerOpen}
                          placement="bottom"
                          sideOffset={8}
                        >
                          <PopoverTrigger asChild>
                            <button
                              className="inline-control__color-trigger"
                              style={{
                                backgroundColor: shadowConfig.color.startsWith('rgba') 
                                  ? `#${shadowConfig.color.match(/\d+/g)?.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('') || '000000'}`
                                  : shadowConfig.color
                              }}
                              onClick={() => setShadowColorPickerOpen(!shadowColorPickerOpen)}
                            />
                          </PopoverTrigger>
                          <PopoverContent>
                            <Island padding={4} className="color-picker-popover">
                              <UnifiedColorPicker
                                value={shadowConfig.color.startsWith('rgba') 
                                  ? `#${shadowConfig.color.match(/\d+/g)?.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('') || '000000'}`
                                  : shadowConfig.color}
                                onChange={(hex) => {
                                  const r = parseInt(hex.slice(1, 3), 16);
                                  const g = parseInt(hex.slice(3, 5), 16);
                                  const b = parseInt(hex.slice(5, 7), 16);
                                  const alphaMatch = shadowConfig.color.match(/[\d.]+\)$/);
                                  const alpha = alphaMatch ? parseFloat(alphaMatch[0]) : 0.5;
                                  handleShadowConfigChange('color', `rgba(${r}, ${g}, ${b}, ${alpha})`);
                                }}
                                showAlpha={false}
                                showEyeDropper={true}
                                showPresets={true}
                                showRecentColors={true}
                                showHexInput={true}
                              />
                            </Island>
                          </PopoverContent>
                        </Popover>
                        <input
                          type="range"
                          className="inline-control__slider inline-control__slider--short"
                          value={(() => {
                            const alphaMatch = shadowConfig.color.match(/[\d.]+\)$/);
                            return alphaMatch ? parseFloat(alphaMatch[0]) * 100 : 50;
                          })()}
                          min={0}
                          max={100}
                          step={5}
                          title={language === 'zh' ? '透明度' : 'Opacity'}
                          onChange={(e) => {
                            const alpha = Number(e.target.value) / 100;
                            const rgbMatch = shadowConfig.color.match(/\d+/g);
                            if (rgbMatch && rgbMatch.length >= 3) {
                              const [r, g, b] = rgbMatch.slice(0, 3);
                              handleShadowConfigChange('color', `rgba(${r}, ${g}, ${b}, ${alpha})`);
                            }
                          }}
                        />
                        <span className="inline-control__value inline-control__value--narrow">
                          {(() => {
                            const alphaMatch = shadowConfig.color.match(/[\d.]+\)$/);
                            return alphaMatch ? Math.round(parseFloat(alphaMatch[0]) * 100) : 50;
                          })()}%
                        </span>
                      </div>
                    </div>
                    <div className="inline-control">
                      <label className="inline-control__label">{language === 'zh' ? 'X偏移' : 'X'}</label>
                      <div className="inline-control__slider-group">
                        <input
                          type="range"
                          className="inline-control__slider"
                          value={shadowConfig.offsetX}
                          min={-20}
                          max={20}
                          step={1}
                          onChange={(e) => handleShadowConfigChange('offsetX', Number(e.target.value))}
                        />
                        <span className="inline-control__value">{shadowConfig.offsetX}px</span>
                      </div>
                    </div>
                    <div className="inline-control">
                      <label className="inline-control__label">{language === 'zh' ? 'Y偏移' : 'Y'}</label>
                      <div className="inline-control__slider-group">
                        <input
                          type="range"
                          className="inline-control__slider"
                          value={shadowConfig.offsetY}
                          min={-20}
                          max={20}
                          step={1}
                          onChange={(e) => handleShadowConfigChange('offsetY', Number(e.target.value))}
                        />
                        <span className="inline-control__value">{shadowConfig.offsetY}px</span>
                      </div>
                    </div>
                    <div className="inline-control">
                      <label className="inline-control__label">{language === 'zh' ? '模糊' : 'Blur'}</label>
                      <div className="inline-control__slider-group">
                        <input
                          type="range"
                          className="inline-control__slider"
                          value={shadowConfig.blur}
                          min={0}
                          max={30}
                          step={1}
                          onChange={(e) => handleShadowConfigChange('blur', Number(e.target.value))}
                        />
                        <span className="inline-control__value">{shadowConfig.blur}px</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 渐变效果 */}
          <div className="text-property-panel__section">
            <div className="text-property-panel__section-content">
              {/* 渐变开关 */}
              <div className="inline-control">
                <label className="inline-control__label">{language === 'zh' ? '渐变' : 'Gradient'}</label>
                <div
                  className={classNames('toggle-switch__control toggle-switch__control--inline', { 'is-active': gradientEnabled })}
                  onClick={toggleGradient}
                />
              </div>
              
              {gradientEnabled && (
                <div className="gradient-editor-wrapper">
                  <GradientEditor
                    value={gradientConfig}
                    onChange={handleGradientConfigChange}
                    showPresets={true}
                    showHistory={false}
                    inline={true}
                    customPresets={customGradients.map((g) => g.css)}
                    onSavePreset={saveCurrentGradient}
                    onDeletePreset={(index) => {
                      const gradient = customGradients[index];
                      if (gradient) {
                        deleteCustomGradient(gradient.id);
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </>
  );
};

export default TextPropertyPanel;
