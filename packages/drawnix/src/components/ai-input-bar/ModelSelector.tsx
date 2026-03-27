/**
 * 模型选择器组件
 *
 * 当用户输入 "#" 时显示模型选择下拉菜单
 * 支持键盘操作：上/下选择，Enter/Tab/空格确认
 * 支持同时选择图片模型和视频模型
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
  getModelsByVendor,
  getVendorOrder,
  VENDOR_NAMES,
  type ModelType,
} from '../../constants/model-config';
import './model-selector.scss';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { VendorTabPanel, type VendorTab } from '../shared/VendorTabPanel';
import { ModelVendorMark } from '../shared/ModelVendorBrand';

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
}) => {
  // console.log('[ModelSelector] render, visible:', visible, 'filterKeyword:', filterKeyword);
  const panelRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeVendor, setActiveVendor] = useState<string | null>(null);

  // 检查是否两种模型都已选择
  const allModelsSelected = !!selectedImageModel && !!selectedVideoModel;

  // 按类型过滤后的模型（用于生成厂商标签）
  const typeFilteredModels = useMemo(() => {
    if (allModelsSelected) return [];
    return IMAGE_VIDEO_MODELS.filter((model) => {
      if (model.type === 'image' && selectedImageModel) return false;
      if (model.type === 'video' && selectedVideoModel) return false;
      return true;
    });
  }, [selectedImageModel, selectedVideoModel, allModelsSelected]);

  // 计算厂商标签列表
  const vendorTabs = useMemo((): VendorTab[] => {
    const vendorMap = getModelsByVendor(typeFilteredModels);
    const order = getVendorOrder(typeFilteredModels);
    return order.map((vendor) => ({
      id: vendor,
      label: VENDOR_NAMES[vendor],
      count: vendorMap.get(vendor)?.length ?? 0,
      icon: <ModelVendorMark vendor={vendor} size={14} />,
    }));
  }, [typeFilteredModels]);

  // 初始化 activeVendor（visible 变化时）
  useEffect(() => {
    if (visible && vendorTabs.length > 0 && !activeVendor) {
      setActiveVendor(vendorTabs[0].id);
    }
    if (!visible) {
      setActiveVendor(null);
    }
  }, [visible, vendorTabs, activeVendor]);

  // 过滤模型列表
  const filteredModels = useMemo(() => {
    const keyword = filterKeyword.toLowerCase().trim();
    const isSearching = !!keyword;

    // 搜索时跨厂商过滤
    if (isSearching) {
      return typeFilteredModels.filter(
        (model) =>
          model.id.toLowerCase().includes(keyword) ||
          model.label.toLowerCase().includes(keyword) ||
          (model.shortLabel && model.shortLabel.toLowerCase().includes(keyword))
      );
    }

    // 无搜索时按 activeVendor 过滤
    if (activeVendor) {
      return typeFilteredModels.filter((m) => m.vendor === activeVendor);
    }

    return typeFilteredModels;
  }, [typeFilteredModels, filterKeyword, activeVendor]);

  // 重置高亮索引当过滤结果变化时
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredModels.length]);

  // 处理模型选择
  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
    },
    [onSelect]
  );

  // 切换厂商
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
    if (filteredModels.length === 0) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        // 不拦截其他键，让它们传递到 textarea
      };
      document.addEventListener('keydown', handleKeyDown, true);
      return () => document.removeEventListener('keydown', handleKeyDown, true);
    }

    // 有可选模型时，处理方向键和选择
    const handleKeyDown = (event: KeyboardEvent) => {
      // console.log('[ModelSelector] handleKeyDown, key:', event.key, 'filteredModels.length:', filteredModels.length);
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          setHighlightedIndex((prev) =>
            prev <= 0 ? filteredModels.length - 1 : prev - 1
          );
          break;
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          setHighlightedIndex((prev) =>
            prev >= filteredModels.length - 1 ? 0 : prev + 1
          );
          break;
        case 'Tab':
          // Tab 键选择当前高亮项
          // console.log('[ModelSelector] Tab pressed, selecting model');
          event.preventDefault();
          event.stopPropagation();
          if (filteredModels[highlightedIndex]) {
            handleSelect(filteredModels[highlightedIndex].id);
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
    filteredModels,
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
  if (filteredModels.length === 0) return null;

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
        // 阻止默认行为，防止 textarea 失去焦点
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
        tabs={vendorTabs}
        activeTab={activeVendor}
        onTabChange={handleVendorChange}
        searchQuery={filterKeyword}
        compact
      >
        <div className="ai-model-selector__list">
          {filteredModels.map((model, index) => {
            const isSelected =
              (model.type === 'image' && selectedImageModel === model.id) ||
              (model.type === 'video' && selectedVideoModel === model.id);

            return (
              <div
                key={model.id}
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
