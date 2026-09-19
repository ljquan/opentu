/**
 * 模型分组工具
 *
 * 将模型列表按 供应商(Provider) → 厂商分类(Vendor) → 具体模型 三级结构分组
 * 无 sourceProfileId 的内置模型归入 "default" 默认供应商
 */

import { ModelVendor, type ModelConfig } from '../constants/model-config';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_DEFAULT_PROVIDER_NAME,
  TUZI_PROVIDER_ICON_URL,
  type ProviderProfile,
} from './settings-manager';
import {
  DISCOVERY_VENDOR_ORDER,
  getDiscoveryVendorLabel,
} from '../components/shared/ModelVendorBrand';
import { sortModelsByDisplayPriority } from './model-sort';

export interface VendorCategory {
  vendor: ModelVendor;
  label: string;
  models: ModelConfig[];
}

export interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerIconUrl?: string;
  vendorCategories: VendorCategory[];
  totalCount: number;
}

/** 内置模型的默认供应商 ID */
export const DEFAULT_PROVIDER_ID = LEGACY_DEFAULT_PROVIDER_PROFILE_ID;

const VIDEO_VENDOR_ORDER: ModelVendor[] = [
  ModelVendor.MINIMAX,
  ModelVendor.DOUBAO,
  ...DISCOVERY_VENDOR_ORDER.filter(
    (vendor) => vendor !== ModelVendor.MINIMAX && vendor !== ModelVendor.DOUBAO
  ),
];

const DEFAULT_VENDOR_PRIORITY = new Map(
  DISCOVERY_VENDOR_ORDER.map((vendor, index) => [vendor, index])
);
const VIDEO_VENDOR_PRIORITY = new Map(
  VIDEO_VENDOR_ORDER.map((vendor, index) => [vendor, index])
);

function hasRunnableProviderConfig(profile: ProviderProfile): boolean {
  const baseUrl = typeof profile.baseUrl === 'string' ? profile.baseUrl : '';
  const apiKey = typeof profile.apiKey === 'string' ? profile.apiKey : '';

  return (
    profile.enabled && baseUrl.trim().length > 0 && apiKey.trim().length > 0
  );
}

function getManagedDefaultProviderId(
  providerProfiles: ProviderProfile[]
): string | null {
  return (
    providerProfiles.find(
      (profile) =>
        profile.id.startsWith('tuzi-managed-') &&
        profile.pricingGroup === 'default' &&
        hasRunnableProviderConfig(profile)
    )?.id || null
  );
}

function normalizeProviderId(
  model: ModelConfig,
  managedDefaultProviderId: string | null
): string {
  if (!model.sourceProfileId) {
    return managedDefaultProviderId || DEFAULT_PROVIDER_ID;
  }

  return model.sourceProfileId;
}

/**
 * 按供应商 → 厂商分类 → 模型 三级分组
 */
export function groupModelsByProvider(
  models: ModelConfig[],
  providerProfiles: ProviderProfile[]
): ProviderGroup[] {
  const profileMap = new Map(providerProfiles.map((p) => [p.id, p]));
  const managedDefaultProviderId =
    getManagedDefaultProviderId(providerProfiles);
  const seen = new Set<string>();

  // 按 provider 分桶
  const buckets = new Map<string, ModelConfig[]>();
  for (const model of models) {
    const pid = normalizeProviderId(model, managedDefaultProviderId);
    const dedupeKey = `${pid}::${model.type}::${model.id}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const list = buckets.get(pid);
    if (list) {
      list.push(model);
    } else {
      buckets.set(pid, [model]);
    }
  }

  const groups: ProviderGroup[] = [];

  for (const [pid, bucket] of buckets) {
    const profile = profileMap.get(pid);
    if (profile && profile.enabled === false) {
      continue;
    }

    // 按 vendor 分组
    const vendorMap = new Map<ModelVendor, ModelConfig[]>();
    for (const m of bucket) {
      const list = vendorMap.get(m.vendor);
      if (list) {
        list.push(m);
      } else {
        vendorMap.set(m.vendor, [m]);
      }
    }

    const vendorPriority = bucket.every((model) => model.type === 'video')
      ? VIDEO_VENDOR_PRIORITY
      : DEFAULT_VENDOR_PRIORITY;
    const vendorCategories: VendorCategory[] = Array.from(vendorMap.entries())
      .sort(
        (a, b) =>
          (vendorPriority.get(a[0]) ?? 999) - (vendorPriority.get(b[0]) ?? 999)
      )
      .map(([vendor, vendorModels]) => ({
        vendor,
        label: getDiscoveryVendorLabel(vendor),
        models: sortModelsByDisplayPriority(vendorModels),
      }));

    const isDefault = pid === DEFAULT_PROVIDER_ID;

    groups.push({
      providerId: pid,
      providerName: isDefault
        ? profile?.name || TUZI_DEFAULT_PROVIDER_NAME
        : profile?.name || pid,
      providerIconUrl: isDefault
        ? profile?.iconUrl || TUZI_PROVIDER_ICON_URL
        : profile?.iconUrl,
      vendorCategories,
      totalCount: bucket.length,
    });
  }

  for (const profile of providerProfiles) {
    if (
      !hasRunnableProviderConfig(profile) ||
      buckets.has(profile.id) ||
      (managedDefaultProviderId && profile.id === DEFAULT_PROVIDER_ID)
    ) {
      continue;
    }

    groups.push({
      providerId: profile.id,
      providerName:
        profile.id === DEFAULT_PROVIDER_ID
          ? profile.name || TUZI_DEFAULT_PROVIDER_NAME
          : profile.name || profile.id,
      providerIconUrl:
        profile.id === DEFAULT_PROVIDER_ID
          ? profile.iconUrl || TUZI_PROVIDER_ICON_URL
          : profile.iconUrl,
      vendorCategories: [],
      totalCount: 0,
    });
  }

  // 当前实际使用的 default 置顶，其余按名称排序
  const defaultProviderId = managedDefaultProviderId || DEFAULT_PROVIDER_ID;
  groups.sort((a, b) => {
    if (a.providerId === defaultProviderId) return -1;
    if (b.providerId === defaultProviderId) return 1;
    return a.providerName.localeCompare(b.providerName);
  });

  return groups;
}
