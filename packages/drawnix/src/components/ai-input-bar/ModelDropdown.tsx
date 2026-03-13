/**
 * 模型下拉选择器组件
 *
 * 展示分两种：
 * 1. minimal (默认): 显示在 AI 输入框左下角，以 #shortCode 形式显示当前模型
 * 2. form: 表单下拉框风格，支持输入搜索过滤
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import {
  IMAGE_MODELS,
  getModelConfig,
  getModelsByVendor,
  getVendorOrder,
  type ModelConfig,
  type ModelVendor,
} from '../../constants/model-config';
import { VendorTabPanel, type VendorTab } from '../shared/VendorTabPanel';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import { Z_INDEX } from '../../constants/z-index';
import { useControllableState } from '../../hooks/useControllableState';
import './model-dropdown.scss';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { KeyboardDropdown } from './KeyboardDropdown';

export interface ModelDropdownProps {
  /** 当前选中的模型 ID */
  selectedModel: string;
  /** 选择模型回调 */
  onSelect: (modelId: string) => void;
  /** 语言 */
  language?: 'zh' | 'en';
  /** 模型列表（可选，默认为图片模型） */
  models?: ModelConfig[];
  /** 下拉菜单弹出方向（可选，默认为 up） */
  placement?: 'up' | 'down';
  /** 自定义标题（可选，仅用于 minimal 变体） */
  header?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 展示变体：'minimal' (AI 输入框风格) 或 'form' (表单下拉框风格) */
  variant?: 'minimal' | 'form';
  /** 占位符 (仅用于 variant="form") */
  placeholder?: string;
  /** 受控的打开状态 */
  isOpen?: boolean;
  /** 打开状态变化回调 */
  onOpenChange?: (open: boolean) => void;
}

/**
 * 模型下拉选择器
 */
export const ModelDropdown: React.FC<ModelDropdownProps> = ({
  selectedModel,
  onSelect,
  language = 'zh',
  models = IMAGE_MODELS,
  placement = 'up',
  header,
  disabled = false,
  variant = 'minimal',
  placeholder,
  isOpen: controlledIsOpen,
  onOpenChange,
}) => {
  const { value: isOpen, setValue: setIsOpen } = useControllableState({
    controlledValue: controlledIsOpen,
    defaultValue: false,
    onChange: onOpenChange,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeVendor, setActiveVendor] = useState<ModelVendor | null>(null);
  const triggerInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modelOrderMap = useMemo(
    () => new Map(models.map((model, index) => [model.id, index])),
    [models]
  );

  // 确保高亮项可见
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlightedElement = listRef.current.querySelector(
        `[data-model-index="${highlightedIndex}"]`
      ) as HTMLElement | null;
      if (highlightedElement) {
        const listContainer = listRef.current;
        const itemTop = highlightedElement.offsetTop;
        const itemHeight = highlightedElement.offsetHeight;
        const containerScrollTop = listContainer.scrollTop;
        const containerHeight = listContainer.offsetHeight;
        const containerPaddingTop = 4; // 与 SCSS 中的 padding 一致

        if (highlightedIndex === 0) {
          // 强制滚回到最顶部，处理 padding
          listContainer.scrollTop = 0;
        } else if (itemTop - containerPaddingTop < containerScrollTop) {
          // 在上方不可见
          listContainer.scrollTop = itemTop - containerPaddingTop;
        } else if (itemTop + itemHeight > containerScrollTop + containerHeight) {
          // 在下方不可见
          listContainer.scrollTop = itemTop + itemHeight - containerHeight + containerPaddingTop;
        }
      }
    }
  }, [highlightedIndex, isOpen]);

  // 获取当前模型配置
  const currentModel = getModelConfig(selectedModel);
  // 使用 shortCode 或默认简写
  const shortCode = currentModel?.shortCode || 'img';

  // 当外部选中的模型变化时，同步搜索框内容（仅 form 变体）
  useEffect(() => {
    if (variant === 'form' && !isOpen) {
      setSearchQuery(currentModel?.label || selectedModel);
    }
  }, [selectedModel, currentModel, variant, isOpen]);

  // 过滤模型列表
  const filteredModels = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const isSearching = !!query;
    let baseModels: ModelConfig[];

    // 搜索时跨厂商过滤
    if (isSearching) {
      baseModels = models.filter(m =>
        m.id.toLowerCase().includes(query) ||
        m.label.toLowerCase().includes(query) ||
        m.shortLabel?.toLowerCase().includes(query) ||
        m.shortCode?.toLowerCase().includes(query) ||
        m.description?.toLowerCase().includes(query)
      );
    } else if (activeVendor) {
      // 无搜索时按 activeVendor 过滤
      baseModels = models.filter(m => m.vendor === activeVendor);
    } else {
      baseModels = models;
    }

    const getPriority = (model: ModelConfig) => {
      if (model.tags?.includes('new')) return 0;
      if (model.isVip) return 1;
      return 2;
    };

    return [...baseModels].sort((a, b) => {
      const priorityDiff = getPriority(a) - getPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      const sourceDiff = Number(!a.tags?.includes('runtime')) - Number(!b.tags?.includes('runtime'));
      if (sourceDiff !== 0) return sourceDiff;
      return (modelOrderMap.get(a.id) ?? 0) - (modelOrderMap.get(b.id) ?? 0);
    });
  }, [models, searchQuery, activeVendor, modelOrderMap]);

  const groupedModels = useMemo(() => {
    const sections = [
      {
        key: 'added',
        label: language === 'zh' ? '已添加模型' : 'Added Models',
        models: filteredModels.filter((model) => model.tags?.includes('runtime')),
      },
      {
        key: 'system',
        label: language === 'zh' ? '系统模型' : 'System Models',
        models: filteredModels.filter((model) => !model.tags?.includes('runtime')),
      },
    ];

    return sections.filter((section) => section.models.length > 0);
  }, [filteredModels, language]);

  // 计算厂商标签列表
  const vendorTabs = useMemo((): VendorTab[] => {
    const vendorMap = getModelsByVendor(models);
    const order = getVendorOrder(models);
    return order.map(vendor => ({
      vendor,
      count: vendorMap.get(vendor)?.length ?? 0,
    }));
  }, [models]);

  // 切换厂商
  const handleVendorChange = useCallback((vendor: ModelVendor) => {
    setActiveVendor(vendor);
    setSearchQuery('');
    setHighlightedIndex(0);
  }, []);

  // 当过滤结果变化时，重置高亮索引
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredModels]);

  // 切换下拉菜单
  const handleToggle = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault(); // 阻止触发输入框失焦
    if (disabled) return;
    const next = !isOpen;
    if (next) {
      // 打开时初始化 activeVendor 为当前选中模型的厂商
      setActiveVendor(currentModel?.vendor ?? null);
    }
    if (variant === 'form') {
      if (next) {
        // 打开时清空搜索，展示全部模型
        setSearchQuery('');
      } else {
        // 关闭时恢复当前模型标签
        setSearchQuery(currentModel?.label || selectedModel);
      }
    }
    setIsOpen(next);
  }, [disabled, isOpen, setIsOpen, variant, currentModel, selectedModel]);

  // 选择模型
  const handleSelect = useCallback((modelId: string) => {
    const model = getModelConfig(modelId);
    onSelect(modelId);
    setIsOpen(false);
    if (variant === 'form') {
      setSearchQuery(model?.label || modelId);
    } else {
      setSearchQuery('');
    }
  }, [onSelect, variant]);

  const handleOpenKey = useCallback((key: string) => {
    if (key === 'Escape') {
      setIsOpen(false);
      if (variant === 'form') {
        setSearchQuery(currentModel?.label || selectedModel);
      }
      return true;
    }

    if (key === 'ArrowDown') {
      if (filteredModels.length > 0) {
        setHighlightedIndex(prev =>
          prev < filteredModels.length - 1 ? prev + 1 : 0
        );
      }
      return true;
    }

    if (key === 'ArrowUp') {
      if (filteredModels.length > 0) {
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : filteredModels.length - 1
        );
      }
      return true;
    }

    if (key === 'Enter' || key === 'Tab') {
      const targetModel = filteredModels[highlightedIndex];
      if (targetModel) {
        handleSelect(targetModel.id);
        return true;
      }
      if (variant === 'form' && searchQuery.trim()) {
        // 如果是表单变体且有输入，但没有匹配的模型，则使用输入的内容
        handleSelect(searchQuery.trim());
        return true;
      }
    }

    return false;
  }, [filteredModels, highlightedIndex, handleSelect, variant, currentModel, selectedModel, searchQuery]);

  // 自动聚焦
  useEffect(() => {
    if (isOpen && variant === 'form') {
      triggerInputRef.current?.focus();
      triggerInputRef.current?.select();
    }
  }, [isOpen, variant]);

  const renderTrigger = (handleTriggerKeyDown: (event: React.KeyboardEvent) => void) => {
    if (variant === 'minimal') {
      return (
        <button
          className={`model-dropdown__trigger model-dropdown__trigger--minimal ${isOpen ? 'model-dropdown__trigger--open' : ''}`}
          onMouseDown={handleToggle}
          onKeyDown={handleTriggerKeyDown}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title={`${currentModel?.shortLabel || currentModel?.label || selectedModel} (↑↓ Tab)`}
          disabled={disabled}
        >
          <span className="model-dropdown__at">#</span>
          <span className="model-dropdown__code">{shortCode}</span>
          <ModelHealthBadge modelId={selectedModel} />
          <ChevronDown size={14} className={`model-dropdown__chevron ${isOpen ? 'model-dropdown__chevron--open' : ''}`} />
        </button>
      );
    }

    return (
      <div
        className={`model-dropdown__trigger model-dropdown__trigger--form ${isOpen ? 'model-dropdown__trigger--open' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setSearchQuery('');
            setActiveVendor(currentModel?.vendor ?? null);
          }
        }}
      >
        <div className="model-dropdown__form-content">
          <ModelHealthBadge modelId={selectedModel} />
          <input
            ref={triggerInputRef}
            type="text"
            className="model-dropdown__form-input"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            placeholder={placeholder || (language === 'zh' ? '选择或输入模型' : 'Select or enter model')}
            disabled={disabled}
          />
        </div>
        <ChevronDown
          size={16}
          className={`model-dropdown__chevron ${isOpen ? 'model-dropdown__chevron--open' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleToggle();
          }}
        />
      </div>
    );
  };

  // 渲染菜单内容
  return (
    <KeyboardDropdown
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      disabled={disabled}
      openKeys={['Enter', ' ']}
      onOpenKey={handleOpenKey}
      trackPosition={variant === 'form' || placement === 'down' || placement === 'up'}
    >
      {({ containerRef, menuRef, portalPosition, handleTriggerKeyDown }) => {
        const isPortalled = variant === 'form' || placement === 'down' || placement === 'up';

        const menu = (
          <div
            className={`model-dropdown__menu model-dropdown__menu--${placement} ${variant === 'form' ? 'model-dropdown__menu--form' : ''} ${isPortalled ? 'model-dropdown__menu--portalled' : ''} ${ATTACHED_ELEMENT_CLASS_NAME}`}
            ref={menuRef}
            role="listbox"
            aria-label={language === 'zh' ? '选择模型' : 'Select Model'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={isPortalled ? {
              position: 'fixed',
              zIndex: Z_INDEX.DROPDOWN_PORTAL,
              left: portalPosition.left,
              width: variant === 'form' ? Math.max(portalPosition.width, 420) : 'auto',
              top: placement === 'down' ? portalPosition.bottom + 4 : 'auto',
              bottom: placement === 'up' ? window.innerHeight - portalPosition.top + 4 : 'auto',
              visibility: portalPosition.width === 0 ? 'hidden' : 'visible',
            } : {
              zIndex: 1000,
            }}
          >
            {header && variant === 'minimal' && !searchQuery && (
              <div className="model-dropdown__header">{header}</div>
            )}

            <VendorTabPanel
              tabs={vendorTabs}
              activeVendor={activeVendor}
              onVendorChange={handleVendorChange}
              searchQuery={searchQuery}
              compact
            >
              <div className="model-dropdown__list" ref={listRef}>
                {filteredModels.length > 0 ? (
                  groupedModels.map((section) => (
                    <div key={section.key} className="model-dropdown__section">
                      <div className="model-dropdown__section-title">{section.label}</div>
                      {section.models.map((model) => {
                        const index = filteredModels.findIndex((item) => item.id === model.id);
                        const isSelected = model.id === selectedModel;
                        const isHighlighted = index === highlightedIndex;
                        return (
                          <div
                            key={model.id}
                            data-model-index={index}
                            className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''} ${isHighlighted ? 'model-dropdown__item--highlighted' : ''}`}
                            onClick={() => handleSelect(model.id)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            role="option"
                            aria-selected={isSelected}
                          >
                            <div className="model-dropdown__item-content">
                              <div className="model-dropdown__item-name">
                                <span className="model-dropdown__item-code">#{model.shortCode}</span>
                                <span className="model-dropdown__item-label">
                                  {model.shortLabel || model.label}
                                </span>
                                {model.tags?.includes('runtime') && (
                                  <span className="model-dropdown__item-added">
                                    {language === 'zh' ? '已添加' : 'Added'}
                                  </span>
                                )}
                                {model.isVip && (
                                  <span className="model-dropdown__item-vip">VIP</span>
                                )}
                                {model.tags?.includes('new') && (
                                  <span className="model-dropdown__item-new">NEW</span>
                                )}
                                <ModelHealthBadge modelId={model.id} />
                              </div>
                              {model.description && (
                                <div className="model-dropdown__item-desc">
                                  {model.description}
                                </div>
                              )}
                            </div>
                            {isSelected && (
                              <Check size={16} className="model-dropdown__item-check" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
              ) : (
                <div className="model-dropdown__empty">
                  {language === 'zh' ? '未找到匹配的模型' : 'No matching models'}
                </div>
              )}
            </div>
            </VendorTabPanel>
          </div>
        );

        return (
          <div
            className={`model-dropdown model-dropdown--variant-${variant} ${disabled ? 'model-dropdown--disabled' : ''}`}
            ref={containerRef}
            data-testid="model-selector"
          >
            {renderTrigger(handleTriggerKeyDown)}
            {isOpen && (isPortalled ? createPortal(menu, document.body) : menu)}
          </div>
        );
      }}
    </KeyboardDropdown>
  );
};

export default ModelDropdown;
