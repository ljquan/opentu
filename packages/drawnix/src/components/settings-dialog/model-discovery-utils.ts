import type { ModelConfig, ModelType, ModelVendor } from '../../constants/model-config';
import { DISCOVERY_VENDOR_ORDER, getDiscoveryVendorLabel } from '../shared/ModelVendorBrand';
import { sortModelsByDisplayPriority } from '../../utils/model-sort';

export type ModelTypeFilter = 'all' | ModelType;

export const MODEL_TYPE_LABELS: Record<ModelTypeFilter, string> = {
  all: '全部',
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
};

export const MODEL_TYPE_SECTION_LABELS: Record<ModelType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
};

export const MODEL_TYPE_SHORT_LABELS: Record<ModelType, string> = {
  image: '图',
  video: '视',
  audio: '音',
  text: '文',
};

const MODEL_TYPE_TIE_BREAKER: ModelType[] = ['text', 'image', 'video', 'audio'];

export type VendorGroup = {
  vendor: ModelVendor;
  models: ModelConfig[];
  counts: Record<ModelType, number>;
  selectedCount: number;
};

export function matchesModelQuery(model: ModelConfig, query: string) {
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
  return sortModelsByDisplayPriority(models);
}

export function buildVendorGroups(
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

export function getOrderedTypeGroups(
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
