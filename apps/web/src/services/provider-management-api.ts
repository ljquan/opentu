export type ProviderHealthStatus = 'unknown' | 'healthy' | 'unhealthy';
export type ProviderAuthType = 'bearer' | 'header' | 'query';

export type ManagedProvider = {
  id: string;
  name: string;
  baseUrl: string;
  authType: ProviderAuthType;
  enabled: boolean;
  healthStatus: ProviderHealthStatus;
  healthMessage: string | null;
  lastCheckedAt: string | null;
  hasApiKey: boolean;
};

export type ManagedProviderModel = {
  id: string;
  modelId: string;
  name: string;
  vendor: string;
  category: 'image' | 'video' | 'audio' | 'text' | 'research';
  description: string;
  tags: string[];
  accent: 'violet' | 'cyan' | 'rose' | 'green' | 'amber';
  available: boolean;
  published: boolean;
  gatewayEnabled: boolean;
  billingMode: 'unconfigured' | 'free' | 'external';
  routingPriority: number;
  lastSeenAt: string;
};

export type ManagedProviderModelUpdate = Partial<
  Pick<
    ManagedProviderModel,
    'published' | 'gatewayEnabled' | 'billingMode' | 'routingPriority'
  >
>;

export type ProviderDraft = {
  name: string;
  baseUrl: string;
  authType: ProviderAuthType;
  authHeader?: string;
  authQuery?: string;
  apiKey?: string;
  enabled?: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `请求失败 (${response.status})`);
  return payload?.data as T;
}

export const providerManagementApi = {
  list: () => request<ManagedProvider[]>('/api/admin/providers'),
  create: (draft: ProviderDraft) => request<ManagedProvider>('/api/admin/providers', { method: 'POST', body: JSON.stringify(draft) }),
  update: (id: string, draft: Partial<ProviderDraft>) => request<ManagedProvider>(`/api/admin/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(draft) }),
  remove: (id: string) => request<null>(`/api/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  test: (id: string) => request<{ provider: ManagedProvider; modelCount: number }>(`/api/admin/providers/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  syncModels: (id: string) => request<{ provider: ManagedProvider; models: ManagedProviderModel[] }>(`/api/admin/providers/${encodeURIComponent(id)}/sync-models`, { method: 'POST' }),
  models: (id: string) => request<ManagedProviderModel[]>(`/api/admin/providers/${encodeURIComponent(id)}/models`),
  updateModel: (providerId: string, modelId: string, update: ManagedProviderModelUpdate) => request<Pick<ManagedProviderModel, 'id' | 'modelId' | 'published' | 'available' | 'gatewayEnabled' | 'billingMode' | 'routingPriority'>>(`/api/admin/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, { method: 'PATCH', body: JSON.stringify(update) }),
};
