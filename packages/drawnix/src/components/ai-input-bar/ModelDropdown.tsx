/**
 * 模型下拉选择器组件
 *
 * 展示分两种：
 * 1. minimal (默认): 显示在 AI 输入框左下角，以 #shortCode 形式显示当前模型
 * 2. form: 表单下拉框风格，支持输入搜索过滤
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import {
  IMAGE_MODELS,
  getModelConfig,
  type ModelConfig,
  type ModelVendor,
} from '../../constants/model-config';
import { VendorTabPanel, type VendorTab } from '../shared/VendorTabPanel';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import { Z_INDEX } from '../../constants/z-index';
import { useControllableState } from '../../hooks/useControllableState';
import { useProviderProfiles } from '../../hooks/use-provider-profiles';
import {
  DISCOVERY_VENDOR_ORDER,
  ModelVendorMark,
  getDiscoveryVendorLabel,
} from '../shared/ModelVendorBrand';
import { ModelSourceIcon } from '../shared/ModelSourceIcon';
import './model-dropdown.scss';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { KeyboardDropdown } from './KeyboardDropdown';

export interface ModelDropdownProps {
  /** 当前选中的模型 ID */
  selectedModel: string;
  /** 当前选中的唯一选择键（支持区分同模型不同供应商来源） */
  selectedSelectionKey?: string | null;
  /** 选择模型回调 */
  onSelect: (modelId: string) => void;
  /** 选择完整模型配置回调 */
  onSelectModel?: (model: ModelConfig) => void;
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
  selectedSelectionKey,
  onSelect,
  onSelectModel,
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
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);
  const triggerInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const providerProfiles = useProviderProfiles();
  const providerProfileMap = useMemo(
    () => new Map(providerProfiles.map((profile) => [profile.id, profile])),
    [providerProfiles]
  );
  const modelOrderMap = useMemo(
    () =>
      new Map(
        models.map((model, index) => [model.selectionKey || model.id, index])
      ),
    [models]
  );

  const getModelKey = useCallback(
    (model: ModelConfig) => model.selectionKey || model.id,
    []
  );

  const getModelGroupKey = useCallback(
    (model: ModelConfig) =>
      model.sourceProfileId
        ? `profile:${model.sourceProfileId}`
        : `vendor:${model.vendor}`,
    []
  );

  const getModelProfile = useCallback(
    (model: ModelConfig) =>
      model.sourceProfileId
        ? providerProfileMap.get(model.sourceProfileId) || null
        : null,
    [providerProfileMap]
  );

  const getModelGroupLabel = useCallback(
    (model: ModelConfig) =>
      getModelProfile(model)?.name ||
      model.sourceProfileName ||
      getDiscoveryVendorLabel(model.vendor),
    [getModelProfile]
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
        } else if (
          itemTop + itemHeight >
          containerScrollTop + containerHeight
        ) {
          // 在下方不可见
          listContainer.scrollTop =
            itemTop + itemHeight - containerHeight + containerPaddingTop;
        }
      }
    }
  }, [highlightedIndex, isOpen]);

  // 获取当前模型配置
  const currentModel =
    models.find(
      (model) => getModelKey(model) === (selectedSelectionKey || selectedModel)
    ) || getModelConfig(selectedModel);
  const currentProfile = useMemo(
    () => (currentModel ? getModelProfile(currentModel) : null),
    [currentModel, getModelProfile]
  );
  // 使用 shortCode 或默认简写
  const shortCode = currentModel?.shortCode || 'img';
  const isSearching = Boolean(searchQuery.trim());

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
      baseModels = models.filter(
        (m) =>
          m.id.toLowerCase().includes(query) ||
          m.label.toLowerCase().includes(query) ||
          m.shortLabel?.toLowerCase().includes(query) ||
          m.shortCode?.toLowerCase().includes(query) ||
          m.description?.toLowerCase().includes(query) ||
          m.sourceProfileName?.toLowerCase().includes(query) ||
          getDiscoveryVendorLabel(m.vendor).toLowerCase().includes(query)
      );
    } else if (activeTabId) {
      baseModels = models.filter((m) => getModelGroupKey(m) === activeTabId);
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
      const sourceDiff =
        Number(!a.tags?.includes('runtime')) -
        Number(!b.tags?.includes('runtime'));
      if (sourceDiff !== 0) return sourceDiff;
      return (
        (modelOrderMap.get(getModelKey(a)) ?? 0) -
        (modelOrderMap.get(getModelKey(b)) ?? 0)
      );
    });
  }, [
    models,
    searchQuery,
    activeTabId,
    modelOrderMap,
    getModelKey,
    getModelGroupKey,
  ]);

  const vendorSections = useMemo(() => {
    const sections = new Map<
      ModelVendor,
      {
        key: string;
        label: string;
        vendor: ModelVendor;
        models: ModelConfig[];
      }
    >();

    filteredModels.forEach((model) => {
      const existing = sections.get(model.vendor);
      if (existing) {
        existing.models.push(model);
        return;
      }

      sections.set(model.vendor, {
        key: `vendor:${model.vendor}`,
        label: getDiscoveryVendorLabel(model.vendor),
        vendor: model.vendor,
        models: [model],
      });
    });

    const priorityMap = new Map(
      DISCOVERY_VENDOR_ORDER.map((vendor, index) => [vendor, index])
    );

    return Array.from(sections.values()).sort((left, right) => {
      const leftPriority =
        priorityMap.get(left.vendor) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        priorityMap.get(right.vendor) ?? Number.MAX_SAFE_INTEGER;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return right.models.length - left.models.length;
    });
  }, [filteredModels]);

  const activeSection = useMemo(
    () =>
      vendorSections.find((section) => section.key === activeSectionKey) ||
      vendorSections[0] ||
      null,
    [vendorSections, activeSectionKey]
  );

  const displayedModels = useMemo(
    () => (isSearching ? filteredModels : activeSection?.models || []),
    [isSearching, filteredModels, activeSection]
  );
  const showCategoryTabs = !isSearching && vendorSections.length > 1;

  // 计算厂商标签列表
  const vendorTabs = useMemo((): VendorTab[] => {
    const tabs = new Map<string, VendorTab>();

    models.forEach((model) => {
      const tabId = getModelGroupKey(model);
      const profile = getModelProfile(model);
      const existing = tabs.get(tabId);

      if (existing) {
        existing.count += 1;
        return;
      }

      tabs.set(tabId, {
        id: tabId,
        label: getModelGroupLabel(model),
        count: 1,
        icon: model.sourceProfileId ? (
          <ModelSourceIcon
            vendor={model.vendor}
            profileName={profile?.name || model.sourceProfileName}
            iconUrl={profile?.iconUrl}
            size={16}
          />
        ) : (
          <ModelVendorMark vendor={model.vendor} size={16} />
        ),
      });
    });

    return Array.from(tabs.values());
  }, [models, getModelGroupKey, getModelGroupLabel, getModelProfile]);

  // 切换厂商
  const handleVendorChange = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setSearchQuery('');
    setActiveSectionKey(null);
    setHighlightedIndex(0);
  }, []);

  const handleSectionChange = useCallback((sectionKey: string) => {
    setActiveSectionKey(sectionKey);
    setHighlightedIndex(0);
  }, []);

  // 当过滤结果变化时，重置高亮索引
  useEffect(() => {
    setHighlightedIndex(0);
  }, [displayedModels]);

  useEffect(() => {
    if (isSearching) {
      return;
    }

    if (vendorSections.length === 0) {
      if (activeSectionKey) {
        setActiveSectionKey(null);
      }
      return;
    }

    if (
      !activeSectionKey ||
      !vendorSections.some((section) => section.key === activeSectionKey)
    ) {
      setActiveSectionKey(vendorSections[0].key);
    }
  }, [vendorSections, activeSectionKey, isSearching]);

  // 切换下拉菜单
  const handleToggle = useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault(); // 阻止触发输入框失焦
      if (disabled) return;
      const next = !isOpen;
      if (next) {
        setActiveTabId(currentModel ? getModelGroupKey(currentModel) : null);
        setActiveSectionKey(
          currentModel ? `vendor:${currentModel.vendor}` : null
        );
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
    },
    [
      disabled,
      isOpen,
      setIsOpen,
      variant,
      currentModel,
      selectedModel,
      getModelGroupKey,
    ]
  );

  // 选择模型
  const handleSelect = useCallback(
    (model: ModelConfig) => {
      onSelect(model.id);
      onSelectModel?.(model);
      setIsOpen(false);
      if (variant === 'form') {
        setSearchQuery(model.label || model.id);
      } else {
        setSearchQuery('');
      }
    },
    [onSelect, onSelectModel, setIsOpen, variant]
  );

  const handleOpenKey = useCallback(
    (key: string) => {
      if (key === 'Escape') {
        setIsOpen(false);
        if (variant === 'form') {
          setSearchQuery(currentModel?.label || selectedModel);
        }
        return true;
      }

      if (key === 'ArrowDown') {
        if (displayedModels.length > 0) {
          setHighlightedIndex((prev) =>
            prev < displayedModels.length - 1 ? prev + 1 : 0
          );
        }
        return true;
      }

      if (key === 'ArrowUp') {
        if (displayedModels.length > 0) {
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : displayedModels.length - 1
          );
        }
        return true;
      }

      if (key === 'Enter' || key === 'Tab') {
        const targetModel = displayedModels[highlightedIndex];
        if (targetModel) {
          handleSelect(targetModel);
          return true;
        }
        if (variant === 'form' && searchQuery.trim()) {
          // 如果是表单变体且有输入，但没有匹配的模型，则使用输入的内容
          onSelect(searchQuery.trim());
          setIsOpen(false);
          return true;
        }
      }

      return false;
    },
    [
      displayedModels,
      highlightedIndex,
      handleSelect,
      variant,
      currentModel,
      onSelect,
      searchQuery,
      selectedModel,
      setIsOpen,
    ]
  );

  // 自动聚焦
  useEffect(() => {
    if (isOpen && variant === 'form') {
      triggerInputRef.current?.focus();
      triggerInputRef.current?.select();
    }
  }, [isOpen, variant]);

  const renderTrigger = (
    handleTriggerKeyDown: (event: React.KeyboardEvent) => void
  ) => {
    if (variant === 'minimal') {
      return (
        <button
          className={`model-dropdown__trigger model-dropdown__trigger--minimal ${
            isOpen ? 'model-dropdown__trigger--open' : ''
          }`}
          onMouseDown={handleToggle}
          onKeyDown={handleTriggerKeyDown}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title={`${
            currentModel?.shortLabel || currentModel?.label || selectedModel
          } (↑↓ Tab)`}
          disabled={disabled}
        >
          {currentModel ? (
            <ModelSourceIcon
              vendor={currentModel.vendor}
              profileName={
                currentProfile?.name || currentModel.sourceProfileName
              }
              iconUrl={currentProfile?.iconUrl}
              size={15}
              className="model-dropdown__trigger-source-icon"
            />
          ) : null}
          <span className="model-dropdown__at">#</span>
          <span className="model-dropdown__code">{shortCode}</span>
          <ModelHealthBadge modelId={selectedModel} />
          <ChevronDown
            size={14}
            className={`model-dropdown__chevron ${
              isOpen ? 'model-dropdown__chevron--open' : ''
            }`}
          />
        </button>
      );
    }

    return (
      <div
        className={`model-dropdown__trigger model-dropdown__trigger--form ${
          isOpen ? 'model-dropdown__trigger--open' : ''
        }`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setSearchQuery('');
            setActiveTabId(
              currentModel ? getModelGroupKey(currentModel) : null
            );
          }
        }}
      >
        <div className="model-dropdown__form-content">
          {currentModel ? (
            <ModelSourceIcon
              vendor={currentModel.vendor}
              profileName={
                currentProfile?.name || currentModel.sourceProfileName
              }
              iconUrl={currentProfile?.iconUrl}
              size={18}
              className="model-dropdown__trigger-source-icon"
            />
          ) : null}
          <input
            ref={triggerInputRef}
            type="text"
            className="model-dropdown__form-input"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            placeholder={
              placeholder ||
              (language === 'zh' ? '选择或输入模型' : 'Select or enter model')
            }
            disabled={disabled}
          />
          <ModelHealthBadge modelId={selectedModel} />
        </div>
        <ChevronDown
          size={16}
          className={`model-dropdown__chevron ${
            isOpen ? 'model-dropdown__chevron--open' : ''
          }`}
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
      trackPosition={
        variant === 'form' || placement === 'down' || placement === 'up'
      }
    >
      {({ containerRef, menuRef, portalPosition, handleTriggerKeyDown }) => {
        const isPortalled =
          variant === 'form' || placement === 'down' || placement === 'up';

        const menu = (
          <div
            className={`model-dropdown__menu model-dropdown__menu--${placement} ${
              variant === 'form' ? 'model-dropdown__menu--form' : ''
            } ${
              isPortalled ? 'model-dropdown__menu--portalled' : ''
            } ${ATTACHED_ELEMENT_CLASS_NAME}`}
            ref={menuRef}
            role="listbox"
            aria-label={language === 'zh' ? '选择模型' : 'Select Model'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={
              isPortalled
                ? {
                    position: 'fixed',
                    zIndex: Z_INDEX.DROPDOWN_PORTAL,
                    left: portalPosition.left,
                    width:
                      variant === 'form'
                        ? Math.max(
                            portalPosition.width,
                            showCategoryTabs ? 520 : 420
                          )
                        : 'auto',
                    top:
                      placement === 'down' ? portalPosition.bottom + 4 : 'auto',
                    bottom:
                      placement === 'up'
                        ? window.innerHeight - portalPosition.top + 4
                        : 'auto',
                    visibility:
                      portalPosition.width === 0 ? 'hidden' : 'visible',
                  }
                : {
                    zIndex: 1000,
                  }
            }
          >
            {header && variant === 'minimal' && !searchQuery && (
              <div className="model-dropdown__header">{header}</div>
            )}

            <VendorTabPanel
              tabs={vendorTabs}
              activeTab={activeTabId}
              onTabChange={handleVendorChange}
              searchQuery={searchQuery}
              compact
            >
              <div
                className={`model-dropdown__content-shell ${
                  showCategoryTabs
                    ? 'model-dropdown__content-shell--with-category'
                    : 'model-dropdown__content-shell--single-category'
                }`}
              >
                {showCategoryTabs ? (
                  <div className="model-dropdown__category-tabs">
                    {vendorSections.map((section) => {
                      const isSectionActive =
                        activeSection?.key === section.key;

                      return (
                        <button
                          key={section.key}
                          type="button"
                          className={`model-dropdown__category-tab ${
                            isSectionActive
                              ? 'model-dropdown__category-tab--active'
                              : ''
                          }`}
                          onClick={() => handleSectionChange(section.key)}
                        >
                          <span className="model-dropdown__category-tab-icon">
                            <ModelVendorMark
                              vendor={section.vendor}
                              size={14}
                            />
                          </span>
                          <span className="model-dropdown__category-tab-label">
                            {section.label}
                          </span>
                          <span className="model-dropdown__category-tab-count">
                            {section.models.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="model-dropdown__list-pane">
                  {!isSearching && activeSection ? (
                    <div className="model-dropdown__section-header">
                      <span className="model-dropdown__section-header-label">
                        <ModelVendorMark
                          vendor={activeSection.vendor}
                          size={14}
                        />
                        {activeSection.label}
                      </span>
                      <span>{activeSection.models.length}</span>
                    </div>
                  ) : null}

                  <div className="model-dropdown__list" ref={listRef}>
                    {displayedModels.length > 0 ? (
                      displayedModels.map((model, index) => {
                        const modelKey = getModelKey(model);
                        const profile = getModelProfile(model);
                        const isSelected =
                          modelKey === (selectedSelectionKey || selectedModel);
                        const isHighlighted = index === highlightedIndex;
                        return (
                          <div
                            key={modelKey}
                            data-model-index={index}
                            className={`model-dropdown__item ${
                              isSelected ? 'model-dropdown__item--selected' : ''
                            } ${
                              isHighlighted
                                ? 'model-dropdown__item--highlighted'
                                : ''
                            }`}
                            onClick={() => handleSelect(model)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            role="option"
                            aria-selected={isSelected}
                          >
                            <div className="model-dropdown__item-content">
                              <div className="model-dropdown__item-name">
                                <span className="model-dropdown__item-source-icon">
                                  <ModelVendorMark
                                    vendor={model.vendor}
                                    size={16}
                                  />
                                </span>
                                <span className="model-dropdown__item-code">
                                  #{model.shortCode}
                                </span>
                                <span className="model-dropdown__item-label">
                                  {model.shortLabel || model.label}
                                </span>
                                {isSearching ? (
                                  <span className="model-dropdown__item-group-tag">
                                    {profile?.name ||
                                      model.sourceProfileName ||
                                      getDiscoveryVendorLabel(model.vendor)}
                                  </span>
                                ) : null}
                                {model.tags?.includes('new') && (
                                  <span className="model-dropdown__item-new">
                                    NEW
                                  </span>
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
                              <Check
                                size={16}
                                className="model-dropdown__item-check"
                              />
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="model-dropdown__empty">
                        {language === 'zh'
                          ? '未找到匹配的模型'
                          : 'No matching models'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </VendorTabPanel>
          </div>
        );

        return (
          <div
            className={`model-dropdown model-dropdown--variant-${variant} ${
              disabled ? 'model-dropdown--disabled' : ''
            }`}
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
