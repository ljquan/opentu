/** tuzi-api /api/pricing 响应中单个模型在某分组下的价格配置 */
export interface PricingGroupPrice {
  quota_type: number;
  model_ratio: number;
  model_completion_ratio: number;
  model_price: number;
  model_cache_ratio: number;
  model_create_cache_ratio: number;
}

/** tuzi-api /api/pricing 响应中的模型信息 */
export interface PricingEndpointInfo {
  transport?: string;
  async?: boolean;
  docs?: string;
  label?: string;
  method?: string;
  path?: string;
  description?: string;
  scenario?: string;
  highlights?: string[];
  parameters?: unknown[];
  request_template?: unknown;
}

export interface PricingModelInfo {
  model_name: string;
  description?: string;
  tags: string;
  /** 嵌套结构: group_name → sub_group → price */
  price_info: Record<string, Record<string, PricingGroupPrice>>;
  enable_groups: string[];
  endpoints?: Record<string, PricingEndpointInfo>;
}

/** tuzi-api /api/pricing 响应中的分组信息 */
export interface PricingGroupInfo {
  GroupRatio: number;
  DisplayName: string;
}

export interface NewApiPricingGroupInfo {
  GroupRatio?: number;
  DisplayName?: string;
  ratio?: number;
  group_ratio?: number;
  name?: string;
  display_name?: string;
}

/** tuzi-api /api/pricing 完整响应 */
export interface TuziPricingApiResponse {
  success: boolean;
  data: {
    group_info: Record<string, PricingGroupInfo>;
    model_info: PricingModelInfo[];
  };
}

/** new-api /api/pricing 响应中的模型信息 */
export interface NewApiPricingModelInfo {
  model_name: string;
  description?: string;
  tags?: string;
  quota_type: number;
  model_ratio?: number;
  completion_ratio?: number;
  model_price?: number;
  cache_ratio?: number | null;
  create_cache_ratio?: number | null;
  image_ratio?: number | null;
  audio_ratio?: number | null;
  audio_completion_ratio?: number | null;
  billing_mode?: string;
  billing_expr?: string;
  /** new-api 实际字段 */
  enable_groups?: string[];
  /** 兼容旧文档中的单数字段 */
  enable_group?: string[];
  supported_endpoint_types?: Array<string | number>;
  /** business.tu-zi.com 会把 endpoint 元信息直接放在模型下 */
  endpoints?: Record<string, PricingEndpointInfo | string>;
}

/** business.tu-zi.com /api/pricing 中按分组覆盖的模型价格表 */
export interface NewApiGroupModelPricing {
  quota_type?: Record<string, number>;
  model_quota_type?: Record<string, number>;
  model_ratio?: Record<string, number>;
  model_completion_ratio?: Record<string, number>;
  model_price?: Record<string, number>;
  model_cache_ratio?: Record<string, number>;
  model_create_cache_ratio?: Record<string, number>;
  model_image_ratio?: Record<string, number>;
  model_audio_ratio?: Record<string, number>;
  model_audio_completion_ratio?: Record<string, number>;
}

/** new-api /api/pricing 完整响应 */
export interface NewApiPricingApiResponse {
  success: boolean;
  data: NewApiPricingModelInfo[];
  group_ratio?: Record<string, number>;
  usable_group?: Record<string, string>;
  group_info?: Record<string, NewApiPricingGroupInfo | string | number>;
  group_model_pricing?: Record<string, NewApiGroupModelPricing>;
  supported_endpoint?: Record<string, PricingEndpointInfo | string>;
}

export type PricingApiResponse = TuziPricingApiResponse | NewApiPricingApiResponse;

/** 计算后的单个模型价格（已转换为 CNY） */
export interface ModelPrice {
  inputCnyMtok: number | null;
  outputCnyMtok: number | null;
  cacheReadCnyMtok?: number | null;
  cacheCreateCnyMtok?: number | null;
  imageInputCnyMtok?: number | null;
  audioInputCnyMtok?: number | null;
  audioOutputCnyMtok?: number | null;
  flatCny: number | null;
  billingType: 'token' | 'flat' | 'per-second' | 'tiered';
  tieredCny?: Array<{ label: string; perSecondCny: number }>;
  description?: string;
  docsUrl?: string;
}

/** 分组选项 */
export interface PricingGroup {
  name: string;
  displayName: string;
  ratio: number;
}

/** 缓存的供应商价格数据 */
export interface ProviderPricingCache {
  profileId: string;
  fetchedAt: number;
  sourceSignature?: string;
  autoRefreshSourceSignature?: string | null;
  groups: PricingGroup[];
  /** key = modelId */
  prices: Record<string, ModelPrice>;
  /** key = modelId, value = endpoint name → endpoint info */
  modelEndpoints?: Record<string, Record<string, PricingEndpointInfo>>;
}
