/**
 * 字体选择器按钮组件
 * Font Family Selector Button Component
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import classNames from 'classnames';
import { ToolButton } from '../../tool-button';
import { useConfirmDialog } from '../../dialog/ConfirmDialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { Island } from '../../island';
import { ATTACHED_ELEMENT_CLASS_NAME, PlaitBoard } from '@plait/core';
import { useI18n } from '../../../i18n';
import { SYSTEM_FONTS, GOOGLE_FONTS, SUPPORTED_FONT_EXTENSIONS } from '../../../constants/text-effects';
import type { FontConfig, CustomFontAsset } from '../../../types/text-effects.types';
import { loadGoogleFont, loadCustomFont, getFontFormat } from '../../../utils/text-effects-utils';
import { setTextFontFamily } from '../../../transforms/property';
import { FontFamilyIcon } from '../../icons';
import './font-family-button.scss';

export interface PopupFontFamilyButtonProps {
  board: PlaitBoard;
  currentFont?: string;
  title: string;
  onFontChange?: (font: FontConfig) => void;
}

type FontTab = 'system' | 'google' | 'custom';

export const PopupFontFamilyButton: React.FC<PopupFontFamilyButtonProps> = ({
  board,
  currentFont,
  title,
  onFontChange,
}) => {
  const { t, language } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FontTab>('system');
  const [selectedFont, setSelectedFont] = useState<string>(currentFont || 'PingFang SC');
  const [loadingFonts, setLoadingFonts] = useState<Set<string>>(new Set());
  const [customFonts, setCustomFonts] = useState<CustomFontAsset[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const container = PlaitBoard.getBoardContainer(board);
  const { confirm, confirmDialog } = useConfirmDialog({ container });

  // 加载自定义字体列表
  useEffect(() => {
    const loadCustomFonts = async () => {
      try {
        const stored = localStorage.getItem('custom-fonts');
        if (stored) {
          const fonts: CustomFontAsset[] = JSON.parse(stored);
          setCustomFonts(fonts);
          // 加载已保存的自定义字体
          for (const font of fonts) {
            await loadCustomFont(font.family, font.url, font.format);
          }
        }
      } catch (error) {
        console.error('Failed to load custom fonts:', error);
      }
    };
    loadCustomFonts();
  }, []);

  // 处理字体选择
  const handleFontSelect = useCallback(async (font: FontConfig) => {
    setSelectedFont(font.family);
    
    // 如果是 Google Font，需要先加载
    if (font.source === 'google' && !loadingFonts.has(font.family)) {
      setLoadingFonts((prev) => new Set(prev).add(font.family));
      try {
        await loadGoogleFont(font.family);
      } catch (error) {
        console.error('Failed to load Google font:', error);
      } finally {
        setLoadingFonts((prev) => {
          const next = new Set(prev);
          next.delete(font.family);
          return next;
        });
      }
    }
    
    // 应用字体到选中的文本
    setTextFontFamily(board, font.family);
    
    onFontChange?.(font);
    setIsOpen(false);
  }, [board, loadingFonts, onFontChange]);

  // 处理自定义字体上传
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const format = getFontFormat(file.name);
    if (!format) {
      console.error('Unsupported font format');
      return;
    }

    try {
      // 创建 Blob URL
      const url = URL.createObjectURL(file);
      const family = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-');
      
      // 加载字体
      await loadCustomFont(family, url, format);
      
      // 保存到自定义字体列表
      const newFont: CustomFontAsset = {
        id: `custom-${Date.now()}`,
        name: file.name,
        family,
        url,
        format,
        createdAt: Date.now(),
      };
      
      const updatedFonts = [...customFonts, newFont];
      setCustomFonts(updatedFonts);
      localStorage.setItem('custom-fonts', JSON.stringify(updatedFonts));
      
      // 选择新上传的字体
      handleFontSelect({
        family,
        source: 'custom',
        url,
        displayName: file.name.replace(/\.[^/.]+$/, ''),
      });
    } catch (error) {
      console.error('Failed to upload font:', error);
    }
    
    // 清空 input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [customFonts, handleFontSelect]);

  // 删除自定义字体
  const handleDeleteCustomFont = useCallback(async (fontId: string) => {
    const font = customFonts.find((item) => item.id === fontId);
    const fontLabel = font?.name.replace(/\.[^/.]+$/, '') || '未命名字体';
    const confirmed = await confirm({
      title: language === 'zh' ? '确认删除字体' : 'Delete Font',
      description:
        language === 'zh'
          ? `确定要删除自定义字体「${fontLabel}」吗？`
          : `Are you sure you want to delete the custom font "${fontLabel}"?`,
      confirmText: language === 'zh' ? '删除' : 'Delete',
      cancelText: language === 'zh' ? '取消' : 'Cancel',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    // 找到要删除的字体并 revoke 其 Blob URL
    const fontToDelete = customFonts.find((f) => f.id === fontId);
    if (fontToDelete?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(fontToDelete.url);
    }
    
    const updatedFonts = customFonts.filter((f) => f.id !== fontId);
    setCustomFonts(updatedFonts);
    localStorage.setItem('custom-fonts', JSON.stringify(updatedFonts));
  }, [confirm, customFonts, language]);

  const renderFontList = (fonts: FontConfig[]) => (
    <div className="font-list">
      {fonts.map((font) => (
        <button
          key={font.family}
          className={classNames('font-item', {
            'font-item--selected': selectedFont === font.family,
            'font-item--loading': loadingFonts.has(font.family),
          })}
          style={{ fontFamily: `'${font.family}', sans-serif` }}
          onClick={() => handleFontSelect(font)}
          disabled={loadingFonts.has(font.family)}
        >
          <span className="font-preview">{font.previewText || font.displayName}</span>
          <span className="font-name">{font.displayName}</span>
          {loadingFonts.has(font.family) && <span className="font-loading">...</span>}
        </button>
      ))}
    </div>
  );

  const renderCustomFontList = () => (
    <div className="font-list custom-font-list">
      {customFonts.length === 0 ? (
        <div className="empty-state">
          {language === 'zh' ? '暂无自定义字体' : 'No custom fonts'}
        </div>
      ) : (
        customFonts.map((font) => (
          <div key={font.id} className="font-item custom-font-item">
            <button
              className={classNames('font-item-content', {
                'font-item--selected': selectedFont === font.family,
              })}
              style={{ fontFamily: `'${font.family}', sans-serif` }}
              onClick={() => handleFontSelect({
                family: font.family,
                source: 'custom',
                url: font.url,
                displayName: font.name.replace(/\.[^/.]+$/, ''),
              })}
            >
              <span className="font-preview">{language === 'zh' ? '元旦快乐' : 'Happy New Year'}</span>
              <span className="font-name">{font.name.replace(/\.[^/.]+$/, '')}</span>
            </button>
            <button
              className="font-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteCustomFont(font.id);
              }}
              title={language === 'zh' ? '删除' : 'Delete'}
            >
              ×
            </button>
          </div>
        ))
      )}
      <button
        className="upload-font-btn"
        onClick={() => fileInputRef.current?.click()}
      >
        <span className="upload-icon">+</span>
        <span>{language === 'zh' ? '上传字体' : 'Upload Font'}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_FONT_EXTENSIONS.join(',')}
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
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
          className={classNames('property-button', 'font-family-button')}
          selected={isOpen}
          visible={true}
          icon={<FontFamilyIcon />}
          type="button"
          title={title}
          aria-label={title}
          onPointerUp={() => setIsOpen(!isOpen)}
        />
      </PopoverTrigger>
      <PopoverContent container={container}>
        <Island padding={4} className={classNames(ATTACHED_ELEMENT_CLASS_NAME, 'font-family-panel')}>
          <div className="font-tabs">
            <button
              className={classNames('font-tab', { active: activeTab === 'system' })}
              onClick={() => setActiveTab('system')}
            >
              {language === 'zh' ? '系统字体' : 'System'}
            </button>
            <button
              className={classNames('font-tab', { active: activeTab === 'google' })}
              onClick={() => setActiveTab('google')}
            >
              Google
            </button>
            <button
              className={classNames('font-tab', { active: activeTab === 'custom' })}
              onClick={() => setActiveTab('custom')}
            >
              {language === 'zh' ? '自定义' : 'Custom'}
            </button>
          </div>
          <div className="font-content">
            {activeTab === 'system' && renderFontList(SYSTEM_FONTS)}
            {activeTab === 'google' && renderFontList(GOOGLE_FONTS)}
            {activeTab === 'custom' && renderCustomFontList()}
          </div>
        </Island>
      </PopoverContent>
      {confirmDialog}
    </Popover>
  );
};

export default PopupFontFamilyButton;
