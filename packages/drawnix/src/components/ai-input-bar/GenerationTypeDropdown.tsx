import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Sparkles, Image, Video, Music4 } from 'lucide-react';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import { useI18n } from '../../i18n';
import { Z_INDEX } from '../../constants/z-index';
import type { GenerationType } from '../../utils/ai-input-parser';
import { KeyboardDropdown } from './KeyboardDropdown';

export interface GenerationTypeDropdownProps {
  value: GenerationType;
  onSelect: (type: GenerationType) => void;
  disabled?: boolean;
}

const TYPE_OPTIONS: Array<{ value: GenerationType; label: string; icon: React.ReactNode; zh: string; en: string }> = [
  { value: 'image', label: '图片', icon: <Image size={14} />, zh: '图片', en: 'Image' },
  { value: 'video', label: '视频', icon: <Video size={14} />, zh: '视频', en: 'Video' },
  { value: 'audio', label: '音频', icon: <Music4 size={14} />, zh: '音频', en: 'Audio' },
  { value: 'text', label: 'Agent', icon: <Sparkles size={14} />, zh: 'Agent', en: 'Agent' },
];

export const GenerationTypeDropdown: React.FC<GenerationTypeDropdownProps> = ({
  value,
  onSelect,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { language } = useI18n();
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时重置高亮索引到当前选中项
  useEffect(() => {
    if (isOpen) {
      const currentIndex = TYPE_OPTIONS.findIndex(opt => opt.value === value);
      setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [isOpen, value]);

  // 确保高亮项可见
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // 阻止触发输入框失焦
    if (disabled) return;
    setIsOpen(prev => !prev);
  }, [disabled]);

  const handleSelect = useCallback((type: GenerationType) => {
    onSelect(type);
    setIsOpen(false);
  }, [onSelect]);

  const handleOpenKey = useCallback((key: string) => {
    if (key === 'Escape') {
      setIsOpen(false);
      return true;
    }

    if (key === 'ArrowDown') {
      setHighlightedIndex(prev => (prev < TYPE_OPTIONS.length - 1 ? prev + 1 : 0));
      return true;
    }

    if (key === 'ArrowUp') {
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : TYPE_OPTIONS.length - 1));
      return true;
    }

    if (key === 'Enter' || key === ' ' || key === 'Tab') {
      handleSelect(TYPE_OPTIONS[highlightedIndex].value);
      return true;
    }

    return false;
  }, [highlightedIndex, handleSelect]);

  const selectedOption = TYPE_OPTIONS.find(opt => opt.value === value) || TYPE_OPTIONS[0];

  return (
    <KeyboardDropdown
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      disabled={disabled}
      openKeys={['Enter', ' ', 'ArrowDown', 'ArrowUp']}
      onOpenKey={handleOpenKey}
    >
      {({ containerRef, menuRef, portalPosition, handleTriggerKeyDown }) => (
        <div className="generation-type-dropdown" ref={containerRef}>
          <button
            className={`generation-type-dropdown__trigger ${isOpen ? 'generation-type-dropdown__trigger--open' : ''}`}
            onMouseDown={handleToggle}
            onKeyDown={handleTriggerKeyDown}
            disabled={disabled}
            type="button"
            title={`${language === 'zh' ? '生成类型' : 'Type'}: ${language === 'zh' ? selectedOption.zh : selectedOption.en} (↑↓ Tab)`}
          >
            <span className="generation-type-dropdown__icon-prefix">{selectedOption.icon}</span>
            <span className="generation-type-dropdown__label">
              {language === 'zh' ? selectedOption.zh : selectedOption.en}
            </span>
            <ChevronDown size={14} className={`generation-type-dropdown__chevron ${isOpen ? 'generation-type-dropdown__chevron--open' : ''}`} />
          </button>
          {isOpen && createPortal(
            <div
              ref={menuRef}
              className={`generation-type-dropdown__menu ${ATTACHED_ELEMENT_CLASS_NAME}`}
              style={{
                position: 'fixed',
                zIndex: Z_INDEX.DROPDOWN_PORTAL,
                left: portalPosition.left,
                bottom: window.innerHeight - portalPosition.top + 8,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="generation-type-dropdown__header">
                <Sparkles size={14} />
                <span>{language === 'zh' ? '生成类型 (↑↓ Tab)' : 'Generation type (↑↓ Tab)'}</span>
              </div>
              <div ref={listRef} className="generation-type-dropdown__list">
                {TYPE_OPTIONS.map((option, index) => {
                  const isSelected = option.value === value;
                  const isHighlighted = index === highlightedIndex;
                  return (
                    <div
                      key={option.value}
                      className={`generation-type-dropdown__item ${isSelected ? 'generation-type-dropdown__item--selected' : ''} ${isHighlighted ? 'generation-type-dropdown__item--highlighted' : ''}`}
                      onClick={() => handleSelect(option.value)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                    >
                      <span className="generation-type-dropdown__item-icon">{option.icon}</span>
                      <span className="generation-type-dropdown__item-label">
                        {language === 'zh' ? option.zh : option.en}
                      </span>
                      {isSelected && <Check size={14} className="generation-type-dropdown__item-check" />}
                    </div>
                  );
                })}
              </div>
            </div>,
            document.body
          )}
        </div>
      )}
    </KeyboardDropdown>
  );
};
