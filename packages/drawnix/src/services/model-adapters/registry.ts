import type { ModelAdapter, ModelKind } from './types';
import { getModelConfig, ModelVendor } from '../../constants/model-config';
import type { ModelType } from '../../constants/model-config';
import {
  resolveInvocationRoute,
  type ModelRef,
} from '../../utils/settings-manager';
import {
  resolveInvocationPlanFromRoute,
  type ProviderModelBinding,
} from '../provider-routing';
import { isTuziCompatibleBaseUrl } from '../provider-routing/tuzi-api-endpoints';

const adapterRegistry = new Map<string, ModelAdapter>();

export function registerModelAdapter(adapter: ModelAdapter): void {
  adapterRegistry.set(adapter.id, adapter);
}

export function getModelAdapter(adapterId: string): ModelAdapter | undefined {
  return adapterRegistry.get(adapterId);
}

export function hasModelAdapter(adapterId: string): boolean {
  return adapterRegistry.has(adapterId);
}

export function clearModelAdapters(): void {
  adapterRegistry.clear();
}

export function listModelAdapters(kind?: ModelKind): ModelAdapter[] {
  const adapters = Array.from(adapterRegistry.values());
  return kind ? adapters.filter((adapter) => adapter.kind === kind) : adapters;
}

function scoreAdapterForBinding(
  adapter: ModelAdapter,
  binding: ProviderModelBinding
): number {
  if (adapter.matchRequestSchemas?.includes(binding.requestSchema)) {
    return 400;
  }

  if (adapter.matchProtocols?.includes(binding.protocol)) {
    return 300;
  }

  if (adapter.supportedModels?.includes(binding.modelId)) {
    return 200;
  }

  return -1;
}

export function resolveAdapterForBinding(
  binding: ProviderModelBinding,
  kind: ModelKind
): ModelAdapter | undefined {
  const adapters = listModelAdapters(kind)
    .map((adapter) => ({
      adapter,
      score: scoreAdapterForBinding(adapter, binding),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  return adapters[0]?.adapter;
}

export function resolveAdapterForModel(
  modelId: string,
  kind: ModelKind
): ModelAdapter | undefined {
  const adapters = listModelAdapters(kind);
  const modelConfig = getModelConfig(modelId);

  return adapters.find((adapter) => {
    // 1) 适配器 ID 与模型 ID 完全一致
    if (adapter.id === modelId) return true;

    if (!modelConfig) {
      // 没有模型配置时，仅允许 supportedModels 精确匹配
      return adapter.supportedModels?.includes(modelId) ?? false;
    }

    const tags = (modelConfig.tags || []).map((t) => t.toLowerCase());
    const vendor = modelConfig.vendor;

    // 2) 精确匹配列表
    if (adapter.matchModels?.includes(modelId)) return true;

    // 3) 自定义匹配函数
    if (adapter.matchPredicate && adapter.matchPredicate(modelConfig))
      return true;

    // 4) 标签匹配
    if (
      adapter.matchTags &&
      adapter.matchTags.some((tag) => tags.includes(tag.toLowerCase()))
    ) {
      return true;
    }

    // 5) 厂商匹配
    if (adapter.matchVendors?.includes(vendor)) return true;

    // 6) 兼容旧逻辑：supportedModels 列表
    if (adapter.supportedModels?.includes(modelId)) return true;

    return false;
  });
}

function toRouteType(kind: ModelKind): ModelType {
  switch (kind) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'chat':
    default:
      return 'text';
  }
}

function isGPTImageModel(modelId?: string | null): boolean {
  if (!modelId) {
    return false;
  }

  const modelConfig = getModelConfig(modelId);
  const lowerId = modelId.toLowerCase();
  return (
    lowerId.startsWith('gpt-image') ||
    lowerId === 'chatgpt-image-latest' ||
    (modelConfig?.vendor === ModelVendor.GPT && lowerId.includes('gpt-image'))
  );
}

function findImageAdapterBySchema(schema: string): ModelAdapter | undefined {
  return listModelAdapters('image').find((adapter) =>
    adapter.matchRequestSchemas?.includes(schema)
  );
}

function resolveGPTImageAdapterForLegacyRoute(
  modelId?: string | null,
  modelRef?: ModelRef | null
): ModelAdapter | undefined {
  if (!isGPTImageModel(modelId)) {
    return undefined;
  }

  const route = resolveInvocationRoute('image', modelRef || modelId);
  if (isTuziCompatibleBaseUrl(route.baseUrl)) {
    return findImageAdapterBySchema('tuzi.image.gpt-generation-json');
  }

  return findImageAdapterBySchema('openai.image.gpt-generation-json');
}

export function resolveAdapterForInvocation(
  kind: ModelKind,
  modelId?: string | null,
  modelRef?: ModelRef | null,
  options: {
    bindingId?: string | null;
    preferredRequestSchema?: string | readonly string[] | null;
  } = {}
): ModelAdapter | undefined {
  const routeModel = modelRef || modelId || null;
  const plan = resolveInvocationPlanFromRoute(
    toRouteType(kind),
    routeModel,
    options
  );

  if (plan) {
    const adapter = resolveAdapterForBinding(plan.binding, kind);
    if (adapter) {
      return adapter;
    }
  }

  if (!modelId) {
    return undefined;
  }

  if (kind === 'image') {
    const routeAdapter = resolveGPTImageAdapterForLegacyRoute(
      modelId,
      modelRef
    );
    if (routeAdapter) {
      return routeAdapter;
    }
  }

  return resolveAdapterForModel(modelId, kind);
}
