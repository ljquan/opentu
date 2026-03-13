import {
  type ModelConfig,
  type ModelType,
  ModelVendor,
  VENDOR_NAMES,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_TEXT_MODEL_ID,
  getModelsByType,
  getStaticModelConfig,
  setRuntimeModelConfigs,
} from '../constants/model-config';
import { normalizeApiBase } from '../services/media-api/utils';

const CACHE_KEY = 'drawnix-runtime-model-discovery';

export interface RemoteModelListItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  supported_endpoint_types?: string[];
}

export interface RuntimeModelDiscoveryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  sourceBaseUrl: string;
  signature: string;
  discoveredAt: number | null;
  discoveredModels: ModelConfig[];
  selectedModelIds: string[];
  models: ModelConfig[];
  error: string | null;
}

interface PersistedRuntimeModelDiscoveryState {
  sourceBaseUrl: string;
  signature: string;
  discoveredAt: number;
  discoveredModels: ModelConfig[];
  selectedModelIds: string[];
}

const DEFAULT_STATE: RuntimeModelDiscoveryState = {
  status: 'idle',
  sourceBaseUrl: '',
  signature: '',
  discoveredAt: null,
  discoveredModels: [],
  selectedModelIds: [],
  models: [],
  error: null,
};

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(16);
}

export function normalizeModelApiBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim();
  const fallback = 'https://api.tu-zi.com/v1';
  if (!trimmed) return fallback;

  let normalized = trimmed.replace(/\/+$/, '');
  normalized = normalized.replace(/\/models$/i, '');
  if (!/\/v1$/i.test(normalized)) {
    normalized = `${normalizeApiBase(normalized)}/v1`;
  }
  return normalized;
}

function buildDiscoverySignature(baseUrl: string, apiKey: string): string {
  return `${normalizeModelApiBaseUrl(baseUrl)}::${hashString(apiKey.trim())}`;
}

function inferVendorByKeywords(modelId: string): ModelVendor {
  const lowerId = modelId.toLowerCase();
  if (lowerId.includes('flux')) return ModelVendor.FLUX;
  if (lowerId.startsWith('mj') || lowerId.includes('midjourney')) return ModelVendor.MIDJOURNEY;
  if (lowerId.includes('claude')) return ModelVendor.ANTHROPIC;
  if (lowerId.includes('deepseek')) return ModelVendor.DEEPSEEK;
  if (lowerId.includes('kling')) return ModelVendor.KLING;
  if (lowerId.includes('veo')) return ModelVendor.VEO;
  if (lowerId.includes('sora')) return ModelVendor.SORA;
  if (
    lowerId.includes('seedream') ||
    lowerId.includes('seedance') ||
    lowerId.includes('doubao')
  ) {
    return ModelVendor.DOUBAO;
  }
  if (
    lowerId.includes('gpt') ||
    lowerId.includes('openai')
  ) {
    return ModelVendor.GPT;
  }
  if (
    lowerId.includes('gemini') ||
    lowerId.includes('banana')
  ) {
    return ModelVendor.GEMINI;
  }
  if (lowerId.includes('google')) return ModelVendor.GOOGLE;
  return ModelVendor.OTHER;
}

function inferVendor(model: RemoteModelListItem): ModelVendor {
  const owner = (model.owned_by || '').trim().toLowerCase();
  if (owner === 'openai') return ModelVendor.GPT;
  if (owner === 'deepseek') return ModelVendor.DEEPSEEK;
  if (owner === 'anthropic' || owner === 'claude') return ModelVendor.ANTHROPIC;
  if (owner === 'volcengine' || owner === 'doubao-video' || owner === 'doubao') {
    return ModelVendor.DOUBAO;
  }
  if (owner === 'google') return ModelVendor.GOOGLE;
  if (owner === 'vertex-ai') {
    return model.id.toLowerCase().startsWith('gemini') ? ModelVendor.GEMINI : ModelVendor.GOOGLE;
  }
  if (owner === 'custom') {
    return inferVendorByKeywords(model.id);
  }
  return inferVendorByKeywords(model.id);
}

function inferModelType(model: RemoteModelListItem): ModelType {
  const endpointHints = (model.supported_endpoint_types || []).join(' ').toLowerCase();
  const lowerId = model.id.toLowerCase();

  const isVideo =
    endpointHints.includes('video') ||
    endpointHints.includes('sora-2') ||
    lowerId.includes('veo') ||
    lowerId.includes('sora') ||
    lowerId.includes('kling') ||
    lowerId.includes('seedance') ||
    lowerId.includes('t2v') ||
    lowerId.includes('i2v') ||
    lowerId.includes('video');
  if (isVideo) return 'video';

  const isImage =
    endpointHints.includes('banana') ||
    endpointHints.includes('generate') ||
    endpointHints.includes('edit') ||
    endpointHints.includes('image') ||
    lowerId.includes('image') ||
    lowerId.includes('banana') ||
    lowerId.includes('flux') ||
    lowerId.startsWith('mj') ||
    lowerId.includes('midjourney') ||
    lowerId.includes('seedream') ||
    lowerId.includes('gpt-image');
  if (isImage) return 'image';

  return 'text';
}

function buildShortCode(modelId: string, type: ModelType): string {
  const compact = modelId
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => part[0]?.toLowerCase() || '')
    .join('');
  if (compact) return compact.slice(0, 6);
  if (type === 'video') return 'vid';
  if (type === 'text') return 'txt';
  return 'img';
}

function buildFallbackConfig(model: RemoteModelListItem): ModelConfig {
  const type = inferModelType(model);
  const vendor = inferVendor(model);
  const vendorLabel = VENDOR_NAMES[vendor];
  const supportsTools =
    type === 'text' &&
    (model.supported_endpoint_types || []).some((item) => item.toLowerCase().includes('openai-chat'));

  return {
    id: model.id,
    label: model.id,
    shortLabel: model.id,
    shortCode: buildShortCode(model.id, type),
    description: `${vendorLabel} ${type === 'image' ? '图片模型' : type === 'video' ? '视频模型' : '文本模型'}`,
    type,
    vendor,
    supportsTools,
    tags: ['runtime'],
    imageDefaults: type === 'image' ? { aspectRatio: 'auto', width: 1024, height: 1024 } : undefined,
    videoDefaults: type === 'video' ? { duration: '8', size: '1280x720', aspectRatio: '16:9' } : undefined,
  };
}

function adaptRuntimeModel(model: RemoteModelListItem): ModelConfig | null {
  if (!model?.id || typeof model.id !== 'string') {
    return null;
  }

  const staticConfig = getStaticModelConfig(model.id);
  if (staticConfig) {
    return {
      ...staticConfig,
      tags: staticConfig.tags ? [...staticConfig.tags] : undefined,
    };
  }

  return buildFallbackConfig(model);
}

function persistState(state: RuntimeModelDiscoveryState): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedRuntimeModelDiscoveryState = {
      sourceBaseUrl: state.sourceBaseUrl,
      signature: state.signature,
      discoveredAt: state.discoveredAt || Date.now(),
      discoveredModels: state.discoveredModels,
      selectedModelIds: state.selectedModelIds,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore cache persistence errors
  }
}

function loadPersistedState(): RuntimeModelDiscoveryState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as PersistedRuntimeModelDiscoveryState;
    if (!parsed || !Array.isArray(parsed.discoveredModels)) return DEFAULT_STATE;
    const selectedModelIds = Array.isArray(parsed.selectedModelIds)
      ? parsed.selectedModelIds.filter((item): item is string => typeof item === 'string')
      : [];
    const models = parsed.discoveredModels.filter((model) => selectedModelIds.includes(model.id));
    return {
      status: 'ready',
      sourceBaseUrl: parsed.sourceBaseUrl || '',
      signature: parsed.signature || '',
      discoveredAt: Number.isFinite(parsed.discoveredAt) ? parsed.discoveredAt : Date.now(),
      discoveredModels: parsed.discoveredModels,
      selectedModelIds,
      models,
      error: null,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

class RuntimeModelDiscoveryStore {
  private state: RuntimeModelDiscoveryState = loadPersistedState();
  private listeners = new Set<() => void>();

  constructor() {
    if (this.state.models.length > 0) {
      setRuntimeModelConfigs(this.state.models);
    }
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private setState(next: RuntimeModelDiscoveryState) {
    this.state = next;
    setRuntimeModelConfigs(next.models);
    if (next.status === 'ready' && next.discoveredModels.length > 0) {
      persistState(next);
    }
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): RuntimeModelDiscoveryState {
    return this.state;
  }

  getDiscoveredModels(type?: ModelType): ModelConfig[] {
    return type
      ? this.state.discoveredModels.filter((model) => model.type === type)
      : this.state.discoveredModels;
  }

  getSelectedModelIds(): string[] {
    return [...this.state.selectedModelIds];
  }

  getPreferredModels(type: ModelType): ModelConfig[] {
    return getModelsByType(type);
  }

  invalidateIfConfigChanged(baseUrl: string, apiKey: string): void {
    const signature = buildDiscoverySignature(baseUrl, apiKey);
    if (!this.state.signature || this.state.signature === signature) {
      return;
    }
    this.clear();
  }

  applySelection(modelIds: string[]): ModelConfig[] {
    const selectedModelIds = Array.from(
      new Set(
        modelIds.filter((modelId) =>
          this.state.discoveredModels.some((model) => model.id === modelId)
        )
      )
    );
    const models = this.state.discoveredModels.filter((model) => selectedModelIds.includes(model.id));

    this.setState({
      ...this.state,
      status: this.state.discoveredModels.length > 0 ? 'ready' : this.state.status,
      selectedModelIds,
      models,
      error: null,
    });

    return models;
  }

  clear(): void {
    this.setState({ ...DEFAULT_STATE });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(CACHE_KEY);
      } catch {
        // ignore
      }
    }
  }

  async discover(baseUrl: string, apiKey: string): Promise<ModelConfig[]> {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      throw new Error('缺少 API Key');
    }

    const normalizedBaseUrl = normalizeModelApiBaseUrl(baseUrl);
    const signature = buildDiscoverySignature(normalizedBaseUrl, trimmedApiKey);

    this.setState({
      ...this.state,
      status: 'loading',
      sourceBaseUrl: normalizedBaseUrl,
      signature,
      error: null,
    });

    const response = await fetch(`${normalizedBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${trimmedApiKey}`,
      },
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`获取模型列表失败: HTTP ${response.status}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error('模型列表接口未返回有效 JSON');
    }

    const data = (parsed as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      throw new Error('模型列表接口缺少 data 数组');
    }

    const adaptedModels = data
      .map((item) => adaptRuntimeModel(item as RemoteModelListItem))
      .filter((item): item is ModelConfig => !!item);

    if (adaptedModels.length === 0) {
      throw new Error('模型列表为空');
    }

    const selectedModelIds = this.state.signature === signature
      ? this.state.selectedModelIds.filter((modelId) =>
          adaptedModels.some((model) => model.id === modelId)
        )
      : [];
    const models = adaptedModels.filter((model) => selectedModelIds.includes(model.id));

    const nextState: RuntimeModelDiscoveryState = {
      status: 'ready',
      sourceBaseUrl: normalizedBaseUrl,
      signature,
      discoveredAt: Date.now(),
      discoveredModels: adaptedModels,
      selectedModelIds,
      models,
      error: null,
    };
    this.setState(nextState);
    return adaptedModels;
  }

  setError(error: string): void {
    this.setState({
      ...this.state,
      status: 'error',
      error,
    });
  }
}

export const runtimeModelDiscovery = new RuntimeModelDiscoveryStore();

export function getPreferredModels(type: ModelType): ModelConfig[] {
  return runtimeModelDiscovery.getPreferredModels(type);
}

export function getFallbackDefaultModelId(type: ModelType): string {
  const preferred = runtimeModelDiscovery.getPreferredModels(type);
  if (preferred.length > 0) {
    return preferred[0].id;
  }
  if (type === 'video') return DEFAULT_VIDEO_MODEL_ID;
  if (type === 'text') return DEFAULT_TEXT_MODEL_ID;
  return DEFAULT_IMAGE_MODEL_ID;
}
