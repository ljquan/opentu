import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Dialog, DialogContent } from '../dialog/dialog';
import {
  type ModelConfig,
  type ModelType,
  type ModelVendor,
} from '../../constants/model-config';
import {
  DISCOVERY_VENDOR_ORDER,
  getDiscoveryVendorLabel,
  getModelVendorPalette,
  ModelVendorMark,
} from '../shared/ModelVendorBrand';
import './model-discovery-dialog.scss';

type ModelTypeFilter = 'all' | ModelType;

const MODEL_TYPE_LABELS: Record<ModelTypeFilter, string> = {
  all: '全部',
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
};

const MODEL_TYPE_SECTION_LABELS: Record<ModelType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
};

const MODEL_TYPE_SHORT_LABELS: Record<ModelType, string> = {
  image: '图',
  video: '视',
  audio: '音',
  text: '文',
};

const MODEL_TYPE_TIE_BREAKER: ModelType[] = ['text', 'image', 'video', 'audio'];

type VendorGroup = {
  vendor: ModelVendor;
  models: ModelConfig[];
  counts: Record<ModelType, number>;
  selectedCount: number;
};

interface ModelDiscoveryDialogProps {
  open: boolean;
  container: HTMLElement | null;
  models: ModelConfig[];
  selectedModelIds: string[];
  onClose: () => void;
  onConfirm: (modelIds: string[]) => void;
}

function matchesModelQuery(model: ModelConfig, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    model.id,
    model.label,
    model.shortLabel,
    model.shortCode,
    model.description,
    model.sourceProfileName,
    getDiscoveryVendorLabel(model.vendor),
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalized));
}

function sortModels(models: ModelConfig[]) {
  return [...models].sort((left, right) => {
    const leftName = (left.shortLabel || left.label || left.id).toLowerCase();
    const rightName = (
      right.shortLabel ||
      right.label ||
      right.id
    ).toLowerCase();
    return leftName.localeCompare(rightName, 'zh-Hans-CN');
  });
}

function buildVendorGroups(
  models: ModelConfig[],
  selectedIds: Set<string>
): VendorGroup[] {
  const grouped = new Map<ModelVendor, VendorGroup>();

  for (const model of models) {
    const current =
      grouped.get(model.vendor) ||
      ({
        vendor: model.vendor,
        models: [],
        counts: { image: 0, video: 0, audio: 0, text: 0 },
        selectedCount: 0,
      } satisfies VendorGroup);

    current.models.push(model);
    current.counts[model.type] += 1;
    if (selectedIds.has(model.id)) {
      current.selectedCount += 1;
    }

    grouped.set(model.vendor, current);
  }

  const priorityMap = new Map(
    DISCOVERY_VENDOR_ORDER.map((vendor, index) => [vendor, index])
  );

  return Array.from(grouped.values()).sort((left, right) => {
    const leftPriority =
      priorityMap.get(left.vendor) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority =
      priorityMap.get(right.vendor) ?? Number.MAX_SAFE_INTEGER;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return right.models.length - left.models.length;
  });
}

function getOrderedTypeGroups(
  group: VendorGroup
): Array<{ type: ModelType; models: ModelConfig[] }> {
  return (['image', 'video', 'audio', 'text'] as ModelType[])
    .filter((type) => group.counts[type] > 0)
    .map((type) => ({
      type,
      models: sortModels(group.models.filter((model) => model.type === type)),
    }))
    .sort((left, right) => {
      if (right.models.length !== left.models.length) {
        return right.models.length - left.models.length;
      }

      return (
        MODEL_TYPE_TIE_BREAKER.indexOf(left.type) -
        MODEL_TYPE_TIE_BREAKER.indexOf(right.type)
      );
    });
}

export const ModelDiscoveryDialog: React.FC<ModelDiscoveryDialogProps> = ({
  open,
  container,
  models,
  selectedModelIds,
  onClose,
  onConfirm,
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
          <div className="model-discovery-dialog__toolbar-actions">
            <button
              type="button"
              className="model-discovery-dialog__ghost-button"
              onClick={toggleVisibleModels}
              disabled={visibleModels.length === 0}
            >
              {allVisibleSelected ? '取消当前结果' : '添加当前结果'}
            </button>
            <button
              type="button"
              className="model-discovery-dialog__ghost-button model-discovery-dialog__ghost-button--muted"
              onClick={() => setDraftSelection([])}
              disabled={draftSelection.length === 0}
            >
              清空已选
            </button>
          </div>
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
