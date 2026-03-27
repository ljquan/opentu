/**
 * ModelSelector Component
 *
 * A provider-aware dropdown component for selecting the chat model.
 * Features: search, vendor grouping, and provider-backed runtime model routing.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useLayoutEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { Input } from 'tdesign-react';
import { ChevronDownIcon, SearchIcon } from 'tdesign-icons-react';
import {
  DEFAULT_TEXT_MODEL_ID,
  type ModelConfig,
  type ModelVendor,
  VENDOR_NAMES,
} from '../../constants/model-config';
import { ModelVendorMark } from '../shared/ModelVendorBrand';
import { VendorTabPanel, type VendorTab } from '../shared/VendorTabPanel';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { Z_INDEX } from '../../constants/z-index';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import {
  findMatchingSelectableModel,
  getSelectionKey,
  getSelectionKeyForModel,
} from '../../utils/model-selection';
import { createModelRef, type ModelRef } from '../../utils/settings-manager';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';

export interface ModelSelectorProps {
  className?: string;
  /** Current selected model ID (controlled mode) */
  value?: string;
  /** Current selected model ref (controlled mode) */
  valueRef?: ModelRef | null;
  /** Callback when model changes - does NOT save to global settings */
  onChange?: (modelId: string, modelRef?: ModelRef | null) => void;
  /** Display variant: 'capsule' (default for chat drawer) or 'form' (for settings) */
  variant?: 'capsule' | 'form';
}

function getProviderLabel(model: ModelConfig): string {
  return model.sourceProfileName || VENDOR_NAMES[model.vendor] || model.id;
}

function getItemDescription(model: ModelConfig): string {
  const providerLabel = getProviderLabel(model);
  const description = model.description?.trim();
  if (!description) {
    return providerLabel;
  }
  if (description.includes(providerLabel)) {
    return description;
  }
  return `${providerLabel} · ${description}`;
}

function getItemInitial(model: ModelConfig): string {
  return getProviderLabel(model).trim().slice(0, 1).toUpperCase() || 'M';
}

export const ModelSelector: React.FC<ModelSelectorProps> = React.memo(
  ({ className, value, valueRef, onChange, variant = 'capsule' }) => {
    const baseSelectableModels = useSelectableModels('text');
    const defaultModelId = baseSelectableModels[0]?.id || DEFAULT_TEXT_MODEL_ID;
    const [internalModel, setInternalModel] = useState<string>(defaultModelId);
    const [internalModelRef, setInternalModelRef] = useState<ModelRef | null>(
      () => createModelRef(null, defaultModelId)
    );
    const selectedModel = value ?? internalModel;
    const selectedModelRef =
      valueRef === undefined ? internalModelRef : valueRef;

    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeVendor, setActiveVendor] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
      if (!value && defaultModelId && internalModel !== defaultModelId) {
        setInternalModel(defaultModelId);
        setInternalModelRef(createModelRef(null, defaultModelId));
      }
    }, [defaultModelId, internalModel, value]);

    useEffect(() => {
      if (!isOpen) return;

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(target) &&
          triggerRef.current &&
          !triggerRef.current.contains(target)
        ) {
          setIsOpen(false);
          setSearchQuery('');
        }
      };

      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);

      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [isOpen]);

    const currentSelectionKey = useMemo(() => {
      if (!selectedModel) {
        return null;
      }
      return getSelectionKey(selectedModel, selectedModelRef);
    }, [selectedModel, selectedModelRef]);

    const selectableModels = useMemo(() => {
      const currentMatch = findMatchingSelectableModel(
        baseSelectableModels,
        selectedModel,
        selectedModelRef
      );
      if (currentMatch || !selectedModel) {
        return baseSelectableModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'text',
        selectedModel,
        selectedModelRef
      );
      return pinnedModel
        ? [pinnedModel, ...baseSelectableModels]
        : baseSelectableModels;
    }, [baseSelectableModels, selectedModel, selectedModelRef]);

    const currentModel = useMemo(
      () =>
        findMatchingSelectableModel(
          selectableModels,
          selectedModel,
          selectedModelRef
        ) || selectableModels.find((model) => model.id === selectedModel),
      [selectableModels, selectedModel, selectedModelRef]
    );

    const handleSelectModel = useCallback(
      (model: ModelConfig) => {
        const modelRef = createModelRef(
          model.sourceProfileId || null,
          model.id
        );
        if (value === undefined) {
          setInternalModel(model.id);
        }
        if (valueRef === undefined) {
          setInternalModelRef(modelRef);
        }
        onChange?.(model.id, modelRef);
        setIsOpen(false);
        setSearchQuery('');
      },
      [value, valueRef, onChange]
    );

    const handleToggle = useCallback(() => {
      const next = !isOpen;
      setIsOpen(next);
      if (next) {
        setActiveVendor(currentModel?.vendor || null);
      } else {
        setSearchQuery('');
      }
    }, [currentModel?.vendor, isOpen]);

    const vendorTabs = useMemo((): VendorTab[] => {
      const vendorMap = new Map<ModelVendor, number>();
      const order: ModelVendor[] = [];
      selectableModels.forEach((model) => {
        if (!vendorMap.has(model.vendor)) {
          order.push(model.vendor);
          vendorMap.set(model.vendor, 0);
        }
        vendorMap.set(model.vendor, (vendorMap.get(model.vendor) ?? 0) + 1);
      });
      return order.map((vendor) => ({
        id: vendor,
        label: VENDOR_NAMES[vendor],
        count: vendorMap.get(vendor) ?? 0,
        icon: <ModelVendorMark vendor={vendor} size={14} />,
      }));
    }, [selectableModels]);

    const handleVendorChange = useCallback((vendorId: string) => {
      setActiveVendor(vendorId);
    }, []);

    const filteredModels = useMemo(() => {
      const query = searchQuery.toLowerCase().trim();
      if (query) {
        return selectableModels.filter((model) => {
          const providerLabel = getProviderLabel(model).toLowerCase();
          return (
            model.id.toLowerCase().includes(query) ||
            model.label.toLowerCase().includes(query) ||
            model.shortLabel?.toLowerCase().includes(query) ||
            model.description?.toLowerCase().includes(query) ||
            providerLabel.includes(query)
          );
        });
      }
      if (activeVendor) {
        return selectableModels.filter(
          (model) => model.vendor === activeVendor
        );
      }
      return selectableModels;
    }, [searchQuery, activeVendor, selectableModels]);

    const [portalPosition, setPortalPosition] = useState({
      top: 0,
      left: 0,
      width: 0,
      bottom: 0,
      placement: 'bottom' as 'top' | 'bottom',
      maxHeight: 480,
    });

    useLayoutEffect(() => {
      if (!isOpen) {
        return undefined;
      }

      const updatePosition = () => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const spaceBelow = windowHeight - rect.bottom;
        const spaceAbove = rect.top;
        const placement =
          spaceBelow < 400 && spaceAbove > spaceBelow ? 'top' : 'bottom';
        const availableHeight =
          placement === 'top'
            ? spaceAbove - 16
            : windowHeight - rect.bottom - 16;

        setPortalPosition({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          bottom: rect.bottom,
          placement,
          maxHeight: Math.min(Math.max(availableHeight, 200), 600),
        });
      };

      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);

      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }, [isOpen]);

    const renderMenu = () => {
      if (!isOpen) return null;

      const menu = (
        <div
          ref={dropdownRef}
          className="model-selector__dropdown"
          style={{
            position: 'fixed',
            zIndex: Z_INDEX.DROPDOWN_PORTAL,
            left: portalPosition.left,
            top:
              portalPosition.placement === 'bottom'
                ? portalPosition.bottom + 8
                : 'auto',
            bottom:
              portalPosition.placement === 'top'
                ? window.innerHeight - portalPosition.top + 8
                : 'auto',
            minWidth: 360,
            width: variant === 'form' ? portalPosition.width : 'auto',
            maxHeight: portalPosition.maxHeight,
            visibility: portalPosition.width === 0 ? 'hidden' : 'visible',
            transformOrigin:
              portalPosition.placement === 'bottom'
                ? 'top left'
                : 'bottom left',
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="model-selector__search">
            <Input
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="搜索模型..."
              prefixIcon={<SearchIcon />}
              clearable
              autofocus
            />
          </div>

          <VendorTabPanel
            tabs={vendorTabs}
            activeTab={activeVendor}
            onTabChange={handleVendorChange}
            searchQuery={searchQuery}
            compact
          >
            <div className="model-selector__list">
              {filteredModels.length === 0 ? (
                <div className="model-selector__empty">未找到匹配的模型</div>
              ) : (
                filteredModels.map((model) => {
                  const modelKey = getSelectionKeyForModel(model);
                  const isActive = modelKey === currentSelectionKey;
                  return (
                    <button
                      key={modelKey}
                      className={`model-selector__item ${
                        isActive ? 'model-selector__item--active' : ''
                      }`}
                      data-track="chat_click_model_select"
                      onClick={() => handleSelectModel(model)}
                    >
                      <span
                        className="model-selector__item-icon model-selector__item-icon--text"
                        aria-hidden="true"
                      >
                        {getItemInitial(model)}
                      </span>
                      <div className="model-selector__item-content">
                        <div className="model-selector__item-header">
                          <span className="model-selector__item-name">
                            {model.shortLabel || model.label}
                          </span>
                          <ModelHealthBadge modelId={model.id} />
                        </div>
                        <div className="model-selector__item-desc">
                          {getItemDescription(model)}
                        </div>
                      </div>
                      {isActive && (
                        <svg
                          className="model-selector__check"
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M13.3334 4L6.00002 11.3333L2.66669 8"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </VendorTabPanel>
        </div>
      );

      return createPortal(menu, document.body);
    };

    return (
      <div
        className={`model-selector ${
          className || ''
        } model-selector--variant-${variant}`}
      >
        <button
          ref={triggerRef}
          className={`model-selector__trigger ${
            isOpen ? 'model-selector__trigger--active' : ''
          }`}
          data-track="chat_click_model_selector"
          onClick={handleToggle}
          aria-label="选择模型"
          aria-expanded={isOpen}
        >
          <div className="model-selector__trigger-content">
            <ModelHealthBadge
              modelId={currentModel?.id || selectedModel}
              className="model-selector__trigger-health"
            />
            <span className="model-selector__trigger-text">
              {currentModel?.shortLabel || currentModel?.label || '选择模型'}
            </span>
          </div>
          <ChevronDownIcon
            size={16}
            className={`model-selector__trigger-icon ${
              isOpen ? 'model-selector__trigger-icon--open' : ''
            }`}
          />
        </button>

        {renderMenu()}
      </div>
    );
  }
);

ModelSelector.displayName = 'ModelSelector';
