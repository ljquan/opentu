/**
 * 模型选择器组件
 *
 * 当用户输入 "#" 时显示模型选择下拉菜单
 * 支持键盘操作：上/下选择，Enter/Tab/空格确认
 * 支持同时选择图片模型和视频模型
 * 三列布局：供应商 → 模型分类(Vendor) → 具体模型
 */

import React, {
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useState,
} from 'react';
import { Bot, Check, Image, Video } from 'lucide-react';
import {
  IMAGE_VIDEO_MODELS,
  getModelConfig,
  type ModelConfig,
  type ModelType,
  type ModelVendor,
} from '../../constants/model-config';
import './model-selector.scss';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { VendorTabPanel, type VendorTab } from '../shared/VendorTabPanel';
import { ModelVendorMark } from '../shared/ModelVendorBrand';
import { ModelSourceIcon } from '../shared/ModelSourceIcon';
import { useProviderProfiles } from '../../hooks/use-provider-profiles';
import { groupModelsByProvider } from '../../utils/model-grouping';
import { sortModelsByDisplayPriority } from '../../utils/model-sort';

export interface ModelSelectorProps {
  /** 是否可见 */
  visible: boolean;
  /** 过滤关键词（# 后面的内容） */
  filterKeyword: string;
  /** 当前选中的图片模型 */
  selectedImageModel?: string;
  /** 当前选中的视频模型 */
  selectedVideoModel?: string;
  /** 选择模型回调 */
  onSelect: (modelId: string) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 语言 */
  language?: 'zh' | 'en';
  /** 模型列表（可选，默认为图片+视频模型） */
  models?: ModelConfig[];
}

/**
 * 模型选择器组件
 */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  visible,
  filterKeyword,
  selectedImageModel,
  selectedVideoModel,
  onSelect,
  onClose,
  language = 'zh',
  models = IMAGE_VIDEO_MODELS,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeVendor, setActiveVendor] = useState<string | null>(null);
  const providerProfiles = useProviderProfiles();

  // 检查是否两种模型都已选择
  const allModelsSelected = !!selectedImageModel && !!selectedVideoModel;

  // 按类型过滤后的模型
  const typeFilteredModels = useMemo(() => {
    if (allModelsSelected) return [];
    return models.filter((model) => {
      if (model.type === 'image' && selectedImageModel) return false;
      if (model.type === 'video' && selectedVideoModel) return false;
      return true;
    });
  }, [models, selectedImageModel, selectedVideoModel, allModelsSelected]);

  // 三级分组
  const providerGroups = useMemo(
    () => groupModelsByProvider(typeFilteredModels, providerProfiles),
    [typeFilteredModels, providerProfiles]
  );

  const activeProvider = useMemo(
    () =>
      providerGroups.find((g) => g.providerId === activeProviderId) ||
      providerGroups[0] ||
      null,
    [providerGroups, activeProviderId]
  );

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

  const isSearching = !!filterKeyword.trim();

  // 搜索过滤
  const searchFilteredModels = useMemo(() => {
    if (!isSearching) return [];
    const keyword = filterKeyword.toLowerCase().trim();
    return sortModelsByDisplayPriority(
      typeFilteredModels.filter(
        (model) =>
          model.id.toLowerCase().includes(keyword) ||
          model.label.toLowerCase().includes(keyword) ||
          (model.shortLabel && model.shortLabel.toLowerCase().includes(keyword))
      )
    );
  }, [typeFilteredModels, filterKeyword, isSearching]);

  const displayedModels = isSearching
    ? searchFilteredModels
    : activeCategory?.models || [];

  // 供应商标签（第一列）
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
            size={14}
          />
        ) : (
          <ModelVendorMark
            vendor={
              g.vendorCategories[0]?.vendor || ('OTHER' as ModelVendor)
            }
            size={14}
          />
        ),
      })),
    [providerGroups]
  );

  // 厂商分类标签（中间列）
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

  // 初始化 activeProviderId
  useEffect(() => {
    if (visible && providerGroups.length > 0 && !activeProviderId) {
      setActiveProviderId(providerGroups[0].providerId);
    }
    if (!visible) {
      setActiveProviderId(null);
      setActiveVendor(null);
    }
  }, [visible, providerGroups, activeProviderId]);

  // 确保 activeVendor 有效
  useEffect(() => {
    if (!activeProvider || isSearching) return;
    const validVendors = activeProvider.vendorCategories.map((c) => c.vendor);
    if (!activeVendor || !validVendors.includes(activeVendor as ModelVendor)) {
      setActiveVendor(validVendors[0] ?? null);
    }
  }, [activeProvider, activeVendor, isSearching]);

  // 重置高亮索引当过滤结果变化时
  useEffect(() => {
    setHighlightedIndex(0);
  }, [displayedModels.length]);

  // 处理模型选择
  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
    },
    [onSelect]
  );

  // 切换供应商
  const handleProviderChange = useCallback(
    (providerId: string) => {
      setActiveProviderId(providerId);
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

  // 全局键盘事件监听
  useEffect(() => {
    if (!visible) return;

    // 如果所有模型都已选择，只处理 Escape 关闭，不拦截 Enter（让用户可以发送消息）
    if (allModelsSelected) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        // 不拦截 Enter，让它传递到 textarea 的 onKeyDown 处理发送
      };
      document.addEventListener('keydown', handleKeyDown, true);
      return () => document.removeEventListener('keydown', handleKeyDown, true);
    }

    // 如果没有可选模型，只处理 Escape
    if (displayedModels.length === 0) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      };
      document.addEventListener('keydown', handleKeyDown, true);
      return () => document.removeEventListener('keydown', handleKeyDown, true);
    }

    // 有可选模型时，处理方向键和选择
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          setHighlightedIndex((prev) =>
            prev <= 0 ? displayedModels.length - 1 : prev - 1
          );
          break;
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          setHighlightedIndex((prev) =>
            prev >= displayedModels.length - 1 ? 0 : prev + 1
          );
          break;
        case 'Tab':
          event.preventDefault();
          event.stopPropagation();
          if (displayedModels[highlightedIndex]) {
            handleSelect(displayedModels[highlightedIndex].id);
          }
          break;
        case 'Enter':
          // Enter 键：不拦截，让 AIInputBar 处理发送逻辑
          break;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          onClose();
          break;
      }
    };

    // 使用 capture 阶段捕获事件，优先于 textarea 的事件处理
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [
    visible,
    displayedModels,
    highlightedIndex,
    handleSelect,
    onClose,
    allModelsSelected,
  ]);

  // 滚动高亮项到可见区域
  useEffect(() => {
    if (!visible) return;

    const highlightedElement = panelRef.current?.querySelector(
      `.ai-model-selector__item:nth-child(${highlightedIndex + 1})`
    );

    if (highlightedElement) {
      highlightedElement.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [highlightedIndex, visible]);

  if (!visible) return null;

  // 如果两种模型都已选择，显示提示信息
  if (allModelsSelected) {
    const selectedImageConfig = getModelConfig(selectedImageModel);
    const selectedVideoConfig = getModelConfig(selectedVideoModel);

    return (
      <div
        ref={panelRef}
        className="ai-model-selector"
        role="dialog"
        aria-label={language === 'zh' ? '模型已选择' : 'Models Selected'}
        onMouseDown={(e) => {
          // 阻止默认行为，防止 textarea 失去焦点
          e.preventDefault();
        }}
      >
        <div className="ai-model-selector__header">
          <Bot size={16} />
          <span>{language === 'zh' ? '模型已选择' : 'Models Selected'}</span>
        </div>
        <div className="ai-model-selector__complete-message">
          <div className="ai-model-selector__selected-models">
            <div className="ai-model-selector__selected-item">
              {selectedImageConfig ? (
                <span className="ai-model-selector__selected-source-icon">
                  <ModelVendorMark
                    vendor={selectedImageConfig.vendor}
                    size={14}
                  />
                </span>
              ) : null}
              <Image size={14} />
              <span className="ai-model-selector__selected-label">
                {language === 'zh' ? '图片' : 'Image'}:
              </span>
              <span className="ai-model-selector__selected-name">
                {selectedImageConfig?.shortLabel ||
                  selectedImageConfig?.label ||
                  selectedImageModel}
              </span>
              <Check size={14} className="ai-model-selector__selected-check" />
            </div>
            <div className="ai-model-selector__selected-item">
              {selectedVideoConfig ? (
                <span className="ai-model-selector__selected-source-icon">
                  <ModelVendorMark
                    vendor={selectedVideoConfig.vendor}
                    size={14}
                  />
                </span>
              ) : null}
              <Video size={14} />
              <span className="ai-model-selector__selected-label">
                {language === 'zh' ? '视频' : 'Video'}:
              </span>
              <span className="ai-model-selector__selected-name">
                {selectedVideoConfig?.shortLabel ||
                  selectedVideoConfig?.label ||
                  selectedVideoModel}
              </span>
              <Check size={14} className="ai-model-selector__selected-check" />
            </div>
          </div>
          <p className="ai-model-selector__hint-text">
            {language === 'zh'
              ? '已选择图片和视频模型，无需再指定其他模型'
              : 'Image and video models selected, no need to specify more'}
          </p>
        </div>
      </div>
    );
  }

  // 如果没有匹配的模型，不显示
  if (displayedModels.length === 0 && isSearching) return null;
  if (typeFilteredModels.length === 0) return null;

  // 获取类型标签
  const getTypeLabel = (type: ModelType) => {
    if (type === 'image') {
      return language === 'zh' ? '图片' : 'Image';
    }
    return language === 'zh' ? '视频' : 'Video';
  };

  // 获取类型图标
  const TypeIcon = ({ type }: { type: ModelType }) => {
    if (type === 'image') {
      return <Image size={12} />;
    }
    return <Video size={12} />;
  };

  return (
    <div
      ref={panelRef}
      className="ai-model-selector"
      role="listbox"
      aria-label={language === 'zh' ? '选择模型' : 'Select Model'}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
    >
      <div className="ai-model-selector__header">
        <Bot size={16} />
        <span>{language === 'zh' ? '选择模型' : 'Select Model'}</span>
        <span className="ai-model-selector__hint">
          {language === 'zh'
            ? '↑↓选择 Tab确认'
            : '↑↓ to select, Tab to confirm'}
        </span>
      </div>

      <VendorTabPanel
        tabs={providerTabs}
        activeTab={activeProviderId}
        onTabChange={handleProviderChange}
        middleTabs={vendorCategoryTabs}
        activeMiddleTab={activeVendor}
        onMiddleTabChange={handleVendorChange}
        searchQuery={filterKeyword}
        compact
      >
        <div className="ai-model-selector__list">
          {displayedModels.map((model, index) => {
            const isSelected =
              (model.type === 'image' && selectedImageModel === model.id) ||
              (model.type === 'video' && selectedVideoModel === model.id);
            const displayName = model.shortLabel || model.label;
            const showIdTooltip =
              displayName !== model.id && !displayName.includes(model.id);

            return (
              <div
                key={model.selectionKey || model.id}
                className={`ai-model-selector__item ${
                  isSelected ? 'ai-model-selector__item--selected' : ''
                } ${
                  highlightedIndex === index
                    ? 'ai-model-selector__item--highlighted'
                    : ''
                }`}
                onClick={() => handleSelect(model.id)}
                role="option"
                aria-selected={isSelected}
                title={showIdTooltip ? model.id : undefined}
              >
                <div className="ai-model-selector__item-content">
                  <div className="ai-model-selector__item-name">
                    <span className="ai-model-selector__item-source-icon">
                      <ModelVendorMark vendor={model.vendor} size={14} />
                    </span>
                    <span
                      className={`ai-model-selector__item-id ai-model-selector__item-id--${model.type}`}
                    >
                      #{model.id}
                    </span>
                    <span className="ai-model-selector__item-label">
                      {model.shortLabel || model.label}
                    </span>
                    <span
                      className={`ai-model-selector__item-type ai-model-selector__item-type--${model.type}`}
                    >
                      <TypeIcon type={model.type} />
                      {getTypeLabel(model.type)}
                    </span>
                    <ModelHealthBadge modelId={model.id} />
                  </div>
                  <div className="ai-model-selector__item-desc">
                    {model.description}
                  </div>
                </div>
                {isSelected && (
                  <Check size={16} className="ai-model-selector__item-check" />
                )}
              </div>
            );
          })}
        </div>
      </VendorTabPanel>
    </div>
  );
};

export default ModelSelector;
