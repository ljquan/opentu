/**
 * 模型下拉选择器组件
 *
 * 展示分两种：
 * 1. minimal (默认): 显示在 AI 输入框左下角，以 #shortCode 形式显示当前模型
 * 2. form: 表单下拉框风格，支持输入搜索过滤
 *
 * 三列布局：供应商 → 模型分类(Vendor) → 具体模型
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
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
import { useDrawnix } from '../../hooks/use-drawnix';
import {
  ModelVendorMark,
  getDiscoveryVendorLabel,
} from '../shared/ModelVendorBrand';
import { ModelSourceIcon } from '../shared/ModelSourceIcon';
import './model-dropdown.scss';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { KeyboardDropdown } from './KeyboardDropdown';
import {
  groupModelsByProvider,
  DEFAULT_PROVIDER_ID,
} from '../../utils/model-grouping';
import { compareModelsByDisplayPriority } from '../../utils/model-sort';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
} from '../../utils/settings-manager';

const SETTINGS_PROVIDER_NAV_EVENT = 'aitu:settings:provider-nav';

type ProviderSettingsIntent =
  | { action: 'select'; profileId: string }
  | { action: 'create' };

function normalizeSearchText(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[\s\-_.:/]+/g, '').trim();
}

function fuzzyScore(value: string, query: string): number {
  const rawValue = value.toLowerCase().trim();
  const rawQuery = query.toLowerCase().trim();
  if (!rawValue || !rawQuery) {
    return 0;
  }

  const normalizedValue = normalizeSearchText(rawValue);
  const normalizedQuery = normalizeSearchText(rawQuery);

  if (!normalizedQuery) {
    return 0;
  }
  if (rawValue === rawQuery || normalizedValue === normalizedQuery) {
    return 120;
  }
  if (
    rawValue.startsWith(rawQuery) ||
    normalizedValue.startsWith(normalizedQuery)
  ) {
    return 100;
  }
  if (rawValue.includes(rawQuery)) {
    return 80;
  }
  if (normalizedValue.includes(normalizedQuery)) {
    return 70;
  }

  const tokens = rawQuery.split(/\s+/).filter(Boolean);
  if (
    tokens.length > 1 &&
    tokens.every((token) => {
      const normalizedToken = normalizeSearchText(token);
      return (
        rawValue.includes(token) ||
        (!!normalizedToken && normalizedValue.includes(normalizedToken))
      );
    })
  ) {
    return 60;
  }

  let queryIndex = 0;
  for (const char of normalizedValue) {
    if (char === normalizedQuery[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === normalizedQuery.length) {
        return 40;
      }
    }
  }

  return 0;
}

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
  const { setAppState } = useDrawnix();
  const { value: isOpen, setValue: setIsOpen } = useControllableState({
    controlledValue: controlledIsOpen,
    defaultValue: false,
    onChange: onOpenChange,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeVendor, setActiveVendor] = useState<string | null>(null);
  const triggerInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const getModelProfile = useCallback(
    (model: ModelConfig) =>
      model.sourceProfileId
        ? providerProfileMap.get(model.sourceProfileId) || null
        : null,
    [providerProfileMap]
  );

  // 三级分组：供应商 → 厂商分类 → 模型
  const providerGroups = useMemo(
    () => groupModelsByProvider(models, providerProfiles),
    [models, providerProfiles]
  );
  const providerModelCountMap = useMemo(
    () => new Map(providerGroups.map((group) => [group.providerId, group.totalCount])),
    [providerGroups]
  );

  // 当前选中的供应商
  const activeProvider = useMemo(
    () =>
      providerGroups.find((g) => g.providerId === activeProviderId) ||
      providerGroups[0] ||
      null,
    [providerGroups, activeProviderId]
  );

  // 当前选中的厂商分类
  const activeCategory = useMemo(() => {
    if (!activeProvider) return null;
    return (
      activeProvider.vendorCategories.find(
        (c) => c.vendor === activeVendor
      ) ||
      activeProvider.vendorCategories[0] ||
      null
    );
  }, [activeProvider, activeVendor]);

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

  // 从 selectionKey 或 currentModel 推导当前选中模型所属的供应商 ID 和 vendor
  const selectedProviderHint = useMemo(() => {
    if (currentModel?.sourceProfileId) return currentModel.sourceProfileId;
    if (selectedSelectionKey?.includes('::')) {
      return selectedSelectionKey.split('::')[0];
    }
    return DEFAULT_PROVIDER_ID;
  }, [currentModel, selectedSelectionKey]);

  const selectedVendorHint = currentModel?.vendor ?? null;

  // 当外部选中的模型变化时，同步搜索框内容（仅 form 变体）
  useEffect(() => {
    if (variant === 'form' && !isOpen) {
      setSearchQuery(currentModel?.label || selectedModel);
    }
  }, [selectedModel, currentModel, variant, isOpen]);

  // 过滤模型列表
  const filteredModels = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return [];

    return models
      .map((model) => {
        const score = Math.max(
          fuzzyScore(model.id, query),
          fuzzyScore(model.label, query),
          fuzzyScore(model.shortLabel || '', query),
          fuzzyScore(model.shortCode || '', query),
          fuzzyScore(model.description || '', query),
          fuzzyScore(model.sourceProfileName || '', query),
          fuzzyScore(getDiscoveryVendorLabel(model.vendor), query)
        );
        return { model, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        compareModelsByDisplayPriority(a.model, b.model, {
          fallbackOrderMap: modelOrderMap,
        })
      );
  }, [models, searchQuery, modelOrderMap]);

  const filteredModelList = useMemo(
    () => filteredModels.map(({ model }) => model),
    [filteredModels]
  );

  const displayedModels = useMemo(
    () => (isSearching ? filteredModelList : activeCategory?.models || []),
    [isSearching, filteredModelList, activeCategory]
  );

  // 供应商标签列表（第一列）
  const providerTabs = useMemo(
    (): VendorTab[] =>
      providerGroups.map((g) => ({
        id: g.providerId,
        label: g.providerName,
        count: g.totalCount,
        icon: g.providerIconUrl ? (
          <ModelSourceIcon
            vendor={
              g.vendorCategories[0]?.vendor || ('OTHER' as ModelVendor)
            }
            profileName={g.providerName}
            iconUrl={g.providerIconUrl}
            size={16}
          />
        ) : (
          <ModelVendorMark
            vendor={
              g.vendorCategories[0]?.vendor || ('OTHER' as ModelVendor)
            }
            size={16}
          />
        ),
      })),
    [providerGroups]
  );

  // 厂商分类标签列表（中间列）
  const vendorCategoryTabs = useMemo(
    (): VendorTab[] =>
      (activeProvider?.vendorCategories || []).map((c) => ({
        id: c.vendor,
        label: c.label,
        count: c.models.length,
        icon: <ModelVendorMark vendor={c.vendor} size={14} />,
      })),
    [activeProvider]
  );

  // 切换供应商
  const handleProviderChange = useCallback(
    (providerId: string) => {
      setActiveProviderId(providerId);
      setSearchQuery('');
      // 自动选中第一个分类
      const group = providerGroups.find((g) => g.providerId === providerId);
      setActiveVendor(group?.vendorCategories[0]?.vendor ?? null);
      setHighlightedIndex(0);
    },
    [providerGroups]
  );

  // 切换厂商分类
  const handleVendorChange = useCallback((vendorId: string) => {
    setActiveVendor(vendorId);
    setHighlightedIndex(0);
  }, []);

  const handleOpenProviderSettings = useCallback(() => {
    const availableProfiles = providerProfiles.filter(
      (profile) => profile.id !== LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );
    const lastProfile =
      availableProfiles[availableProfiles.length - 1] || null;
    const lastProfileModelCount = lastProfile
      ? providerModelCountMap.get(lastProfile.id) || 0
      : 0;

    const intent: ProviderSettingsIntent =
      lastProfile && lastProfileModelCount === 0
        ? { action: 'select', profileId: lastProfile.id }
        : availableProfiles.some(
            (profile) =>
              profile.id === TUZI_ORIGINAL_PROVIDER_PROFILE_ID &&
              (providerModelCountMap.get(profile.id) || 0) === 0
          )
        ? { action: 'select', profileId: TUZI_ORIGINAL_PROVIDER_PROFILE_ID }
        : { action: 'create' };

    (
      window as typeof window & {
        __aituPendingProviderNavigationIntent?: ProviderSettingsIntent;
      }
    ).__aituPendingProviderNavigationIntent = intent;
    window.dispatchEvent(
      new CustomEvent<ProviderSettingsIntent>(SETTINGS_PROVIDER_NAV_EVENT, {
        detail: intent,
      })
    );
    setIsOpen(false);
    setAppState((prev) => ({ ...prev, openSettings: true }));
  }, [providerProfiles, providerModelCountMap, setAppState, setIsOpen]);

  // 当过滤结果变化时，高亮选中模型或重置到第一项
  useEffect(() => {
    const selectedKey = selectedSelectionKey || selectedModel;
    const idx = displayedModels.findIndex(
      (m) => getModelKey(m) === selectedKey
    );
    setHighlightedIndex(idx >= 0 ? idx : 0);
  }, [displayedModels, selectedModel, selectedSelectionKey, getModelKey]);

  useEffect(() => {
    if (isSearching) return;

    // 确保 activeProviderId 有效，优先用 selectedProviderHint（即使 currentModel 还没加载）
    if (
      !activeProviderId ||
      !providerGroups.some((g) => g.providerId === activeProviderId)
    ) {
      const matchedProvider = providerGroups.find(
        (g) => g.providerId === selectedProviderHint
      );
      setActiveProviderId(
        matchedProvider?.providerId || providerGroups[0]?.providerId || null
      );
      if (selectedVendorHint) {
        setActiveVendor(selectedVendorHint);
        return;
      }
    }

    // 确保 activeVendor 有效
    if (activeProvider) {
      const validVendors = activeProvider.vendorCategories.map(
        (c) => c.vendor
      );
      if (!activeVendor || !validVendors.includes(activeVendor as ModelVendor)) {
        setActiveVendor(validVendors[0] ?? null);
      }
    }
  }, [
    providerGroups,
    activeProviderId,
    activeProvider,
    activeVendor,
    isSearching,
    selectedProviderHint,
    selectedVendorHint,
  ]);

  // 切换下拉菜单
  const handleToggle = useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault(); // 阻止触发输入框失焦
      if (disabled) return;
      const next = !isOpen;
      if (next) {
        setActiveProviderId(selectedProviderHint);
        if (selectedVendorHint) {
          setActiveVendor(selectedVendorHint);
        }
      }
      if (next) {
        // 打开时清空搜索，默认展示当前供应商/分类
        setSearchQuery('');
      } else if (variant === 'form') {
        // 表单态关闭时恢复当前模型标签
        setSearchQuery(currentModel?.label || selectedModel);
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
      selectedProviderHint,
      selectedVendorHint,
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

  useEffect(() => {
    if (isOpen && variant === 'minimal') {
      searchInputRef.current?.focus();
    }
  }, [isOpen, variant]);

  useEffect(() => {
    if (!isOpen && variant === 'minimal' && searchQuery) {
      setSearchQuery('');
    }
  }, [isOpen, searchQuery, variant]);

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
            setActiveProviderId(selectedProviderHint);
            if (selectedVendorHint) {
              setActiveVendor(selectedVendorHint);
            }
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
                            providerGroups.length > 1 ? 620 : 520
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
            {variant === 'minimal' ? (
              <div className="model-dropdown__toolbar">
                {header ? (
                  <div className="model-dropdown__toolbar-title">{header}</div>
                ) : null}
                <div className="model-dropdown__search">
                  <div className="model-dropdown__search-input-wrapper">
                    <Search className="model-dropdown__search-icon" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="model-dropdown__search-input"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={
                        language === 'zh'
                          ? '搜索模型名 / 展示名'
                          : 'Search model id / label'
                      }
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        className="model-dropdown__search-clear"
                        onClick={() => {
                          setSearchQuery('');
                          searchInputRef.current?.focus();
                        }}
                        aria-label={language === 'zh' ? '清空搜索' : 'Clear search'}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : header ? (
              <div className="model-dropdown__header">{header}</div>
            ) : null}

            <VendorTabPanel
              tabs={providerTabs}
              activeTab={activeProviderId}
              onTabChange={handleProviderChange}
              middleTabs={vendorCategoryTabs}
              activeMiddleTab={activeVendor}
              onMiddleTabChange={handleVendorChange}
              searchQuery={searchQuery}
              compact
              tabsFooter={
                <button
                  type="button"
                  className="model-dropdown__provider-action"
                  onClick={handleOpenProviderSettings}
                  title={
                    language === 'zh'
                      ? '新增供应商或打开供应商设置'
                      : 'Add provider or open provider settings'
                  }
                >
                  <Plus size={16} />
                </button>
              }
            >
              <div className="model-dropdown__list-pane">
                {!isSearching && activeCategory ? (
                  <div className="model-dropdown__section-header">
                    <span className="model-dropdown__section-header-label">
                      <ModelVendorMark
                        vendor={activeCategory.vendor}
                        size={14}
                      />
                      {activeCategory.label}
                    </span>
                    <span>{activeCategory.models.length}</span>
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
                      const displayName = model.shortLabel || model.label;
                      const showIdTooltip =
                        displayName !== model.id &&
                        !displayName.includes(model.id);
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
                          title={showIdTooltip ? model.id : undefined}
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
