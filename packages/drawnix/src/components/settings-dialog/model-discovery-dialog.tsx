import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, FlaskConical, Search, X } from 'lucide-react';
import { Dialog, DialogContent } from '../dialog/dialog';
import {
  getStaticModelConfig,
  type ModelConfig,
  type ModelVendor,
} from '../../constants/model-config';
import {
  getDiscoveryVendorLabel,
  getModelVendorPalette,
  ModelVendorMark,
} from '../shared/ModelVendorBrand';
import {
  type ModelTypeFilter,
  MODEL_TYPE_LABELS,
  MODEL_TYPE_SECTION_LABELS,
  MODEL_TYPE_SHORT_LABELS,
  matchesModelQuery,
  buildVendorGroups,
  getOrderedTypeGroups,
} from './model-discovery-utils';
import './model-discovery-dialog.scss';

interface ModelDiscoveryDialogProps {
  open: boolean;
  container: HTMLElement | null;
  models: ModelConfig[];
  selectedModelIds: string[];
  onClose: () => void;
  onConfirm: (modelIds: string[]) => void;
  onTestModel?: (modelId: string) => void;
}

export const ModelDiscoveryDialog: React.FC<ModelDiscoveryDialogProps> = ({
  open,
  container,
  models,
  selectedModelIds,
  onClose,
  onConfirm,
  onTestModel,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeType, setActiveType] = useState<ModelTypeFilter>('all');
  const [draftSelection, setDraftSelection] =
    useState<string[]>(selectedModelIds);
  const [expandedVendors, setExpandedVendors] = useState<
    Partial<Record<ModelVendor, boolean>>
  >({});

  useEffect(() => {
    if (!open) {
      return;
    }

    setSearchQuery('');
    setActiveType('all');
    setDraftSelection(selectedModelIds);

    const selectedIds = new Set(selectedModelIds);
    const groups = buildVendorGroups(models, selectedIds);
    const expandedVendor =
      groups.find((group) => group.selectedCount > 0)?.vendor ||
      groups[0]?.vendor ||
      null;
    const nextExpanded: Partial<Record<ModelVendor, boolean>> = {};

    groups.forEach((group) => {
      nextExpanded[group.vendor] = group.vendor === expandedVendor;
    });

    setExpandedVendors(nextExpanded);
  }, [models, open, selectedModelIds]);

  const typeCounts = useMemo(
    () => ({
      all: models.length,
      image: models.filter((model) => model.type === 'image').length,
      video: models.filter((model) => model.type === 'video').length,
      audio: models.filter((model) => model.type === 'audio').length,
      text: models.filter((model) => model.type === 'text').length,
    }),
    [models]
  );

  const visibleModels = useMemo(() => {
    const query = searchQuery.trim();
    const typeScoped =
      activeType === 'all'
        ? models
        : models.filter((model) => model.type === activeType);

    if (!query) {
      return typeScoped;
    }

    return typeScoped.filter((model) => matchesModelQuery(model, query));
  }, [activeType, models, searchQuery]);

  const selectedIds = useMemo(() => new Set(draftSelection), [draftSelection]);

  const vendorGroups = useMemo(
    () => buildVendorGroups(visibleModels, selectedIds),
    [selectedIds, visibleModels]
  );

  const selectedCount = draftSelection.length;
  const selectedTypeCounts = useMemo(
    () => ({
      image: models.filter(
        (model) => model.type === 'image' && selectedIds.has(model.id)
      ).length,
      video: models.filter(
        (model) => model.type === 'video' && selectedIds.has(model.id)
      ).length,
      text: models.filter(
        (model) => model.type === 'text' && selectedIds.has(model.id)
      ).length,
    }),
    [models, selectedIds]
  );

  const allVisibleSelected =
    visibleModels.length > 0 &&
    visibleModels.every((model) => selectedIds.has(model.id));
  const recommendedModelIds = useMemo(
    () => models.filter((model) => getStaticModelConfig(model.id)).map((model) => model.id),
    [models]
  );
  const allRecommendedSelected =
    recommendedModelIds.length > 0 &&
    recommendedModelIds.every((modelId) => selectedIds.has(modelId));

  useEffect(() => {
    if (vendorGroups.length === 0) {
      return;
    }

    const hasVisibleExpandedVendor = vendorGroups.some(
      (group) => expandedVendors[group.vendor]
    );

    if (hasVisibleExpandedVendor) {
      return;
    }

    const hasAnyExpandedVendor = Object.values(expandedVendors).some(Boolean);

    if (!hasAnyExpandedVendor) {
      return;
    }

    setExpandedVendors(
      vendorGroups.reduce<Partial<Record<ModelVendor, boolean>>>(
        (state, group, index) => {
          state[group.vendor] = index === 0;
          return state;
        },
        {}
      )
    );
  }, [expandedVendors, vendorGroups]);

  const toggleModel = (modelId: string) => {
    setDraftSelection((prev) =>
      prev.includes(modelId)
        ? prev.filter((item) => item !== modelId)
        : [...prev, modelId]
    );
  };

  const toggleVisibleModels = () => {
    const visibleIds = visibleModels.map((model) => model.id);
    const visibleSelected = visibleIds.every((modelId) =>
      selectedIds.has(modelId)
    );

    setDraftSelection((prev) => {
      if (visibleSelected) {
        return prev.filter((modelId) => !visibleIds.includes(modelId));
      }

      return Array.from(new Set([...prev, ...visibleIds]));
    });
  };

  const selectRecommendedModels = () => {
    setDraftSelection((prev) => Array.from(new Set([...prev, ...recommendedModelIds])));
  };

  const toggleVendor = (vendor: ModelVendor) => {
    setExpandedVendors((current) => {
      const nextExpanded = !current[vendor];
      const nextState: Partial<Record<ModelVendor, boolean>> = {};

      vendorGroups.forEach((group) => {
        nextState[group.vendor] =
          group.vendor === vendor ? nextExpanded : false;
      });

      return nextState;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="model-discovery-dialog"
        container={container}
        data-testid="model-discovery-dialog"
      >
        <div className="model-discovery-dialog__header">
          <div className="model-discovery-dialog__headline">
            <h3 className="model-discovery-dialog__title">获取模型</h3>
            <div className="model-discovery-dialog__header-stats">
              <span className="model-discovery-dialog__header-pill">
                已发现 {models.length}
              </span>
              <span className="model-discovery-dialog__header-pill">
                品牌 {vendorGroups.length}
              </span>
              <span className="model-discovery-dialog__header-pill model-discovery-dialog__header-pill--accent">
                已选 {selectedCount}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="model-discovery-dialog__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="model-discovery-dialog__toolbar">
          <label className="model-discovery-dialog__search">
            <Search size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索模型名称、ID 或品牌"
            />
          </label>
        </div>

        <div className="model-discovery-dialog__type-tabs">
          {(Object.keys(MODEL_TYPE_LABELS) as ModelTypeFilter[]).map((type) => {
            const isActive = activeType === type;
            return (
              <button
                key={type}
                type="button"
                className={`model-discovery-dialog__type-tab ${
                  isActive ? 'model-discovery-dialog__type-tab--active' : ''
                }`}
                onClick={() => setActiveType(type)}
              >
                <span>{MODEL_TYPE_LABELS[type]}</span>
                <span className="model-discovery-dialog__type-tab-count">
                  {typeCounts[type]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="model-discovery-dialog__body">
          {vendorGroups.length === 0 ? (
            <div className="model-discovery-dialog__empty">
              {searchQuery.trim() ? '没有匹配的模型' : '暂无模型'}
            </div>
          ) : (
            <div className="model-discovery-dialog__group-list">
              {vendorGroups.map((group) => {
                const palette = getModelVendorPalette(group.vendor);
                const orderedTypeGroups = getOrderedTypeGroups(group);
                const expanded = !!expandedVendors[group.vendor];

                return (
                  <section
                    key={group.vendor}
                    className={`model-discovery-dialog__vendor-group ${
                      expanded
                        ? 'model-discovery-dialog__vendor-group--expanded'
                        : ''
                    }`}
                    style={
                      {
                        '--vendor-accent': palette.accent,
                        '--vendor-surface': palette.surface,
                        '--vendor-border': palette.border,
                      } as React.CSSProperties
                    }
                  >
                    <button
                      type="button"
                      className="model-discovery-dialog__vendor-header"
                      onClick={() => toggleVendor(group.vendor)}
                    >
                      <div className="model-discovery-dialog__vendor-main">
                        <span className="model-discovery-dialog__vendor-logo-shell">
                          <ModelVendorMark vendor={group.vendor} size={22} />
                        </span>
                        <div className="model-discovery-dialog__vendor-copy">
                          <span className="model-discovery-dialog__vendor-name">
                            {getDiscoveryVendorLabel(group.vendor)}
                          </span>
                          <div className="model-discovery-dialog__vendor-meta">
                            {orderedTypeGroups.map(
                              ({ type, models: items }) => (
                                <span
                                  key={`${group.vendor}-${type}`}
                                  className="model-discovery-dialog__vendor-meta-pill"
                                >
                                  {MODEL_TYPE_SHORT_LABELS[type]} {items.length}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      </div>

                      <span className="model-discovery-dialog__vendor-spacer" />

                      <div className="model-discovery-dialog__vendor-side">
                        {group.selectedCount > 0 ? (
                          <span className="model-discovery-dialog__vendor-selected">
                            已选 {group.selectedCount}
                          </span>
                        ) : null}
                        <span className="model-discovery-dialog__vendor-count">
                          {group.models.length}
                        </span>
                        <span
                          className={`model-discovery-dialog__vendor-chevron ${
                            expanded
                              ? 'model-discovery-dialog__vendor-chevron--expanded'
                              : ''
                          }`}
                        >
                          <ChevronDown size={16} />
                        </span>
                      </div>
                    </button>

                    {expanded ? (
                      <div className="model-discovery-dialog__vendor-body">
                        {orderedTypeGroups.map(({ type, models: items }) => (
                          <div
                            key={`${group.vendor}-${type}`}
                            className="model-discovery-dialog__type-section"
                          >
                            <div className="model-discovery-dialog__type-section-header">
                              <span className="model-discovery-dialog__type-section-title">
                                {MODEL_TYPE_SECTION_LABELS[type]}
                              </span>
                              <span className="model-discovery-dialog__type-section-count">
                                {items.length}
                              </span>
                            </div>

                            <div className="model-discovery-dialog__model-stack">
                              {items.map((model) => {
                                const checked = selectedIds.has(model.id);

                                return (
                                  <label
                                    key={model.id}
                                    className={`model-discovery-dialog__item ${
                                      checked
                                        ? 'model-discovery-dialog__item--checked'
                                        : ''
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="model-discovery-dialog__checkbox"
                                      checked={checked}
                                      onChange={() => toggleModel(model.id)}
                                    />
                                    <span className="model-discovery-dialog__checkmark">
                                      {checked ? <Check size={12} /> : null}
                                    </span>

                                    <div className="model-discovery-dialog__item-body">
                                      <div
                                        className={`model-discovery-dialog__item-id ${
                                          checked
                                            ? 'model-discovery-dialog__item-id--checked'
                                            : ''
                                        }`}
                                      >
                                        {model.id}
                                      </div>
                                    </div>
                                    {onTestModel ? (
                                      <button
                                        type="button"
                                        className="model-discovery-dialog__item-test"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          onTestModel(model.id);
                                        }}
                                        title="测试此模型"
                                      >
                                        <FlaskConical size={13} />
                                      </button>
                                    ) : null}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="model-discovery-dialog__footer">
          <span className="model-discovery-dialog__selection-count">
            已选 {selectedCount} 个 · 图 {selectedTypeCounts.image} / 视{' '}
            {selectedTypeCounts.video} / 文 {selectedTypeCounts.text}
          </span>
          <div className="model-discovery-dialog__footer-bulk">
            <button
              type="button"
              className="model-discovery-dialog__ghost-button"
              onClick={toggleVisibleModels}
              disabled={visibleModels.length === 0}
            >
              {allVisibleSelected ? '取消当前筛选' : '全选'}
            </button>
            <button
              type="button"
              className="model-discovery-dialog__ghost-button"
              onClick={selectRecommendedModels}
              disabled={recommendedModelIds.length === 0 || allRecommendedSelected}
            >
              选中推荐模型
            </button>
            <button
              type="button"
              className="model-discovery-dialog__ghost-button model-discovery-dialog__ghost-button--muted"
              onClick={() => setDraftSelection([])}
              disabled={draftSelection.length === 0}
            >
              清空
            </button>
          </div>
          <div className="model-discovery-dialog__actions">
            <button
              type="button"
              className="model-discovery-dialog__button model-discovery-dialog__button--secondary"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="model-discovery-dialog__button model-discovery-dialog__button--primary"
              onClick={() => onConfirm(draftSelection)}
            >
              添加模型
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
