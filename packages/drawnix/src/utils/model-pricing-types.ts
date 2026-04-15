/** /api/pricing 响应中单个模型在某分组下的价格配置 */
export interface PricingGroupPrice {
  quota_type: number;
  model_ratio: number;
  model_completion_ratio: number;
  model_price: number;
  model_cache_ratio: number;
  model_create_cache_ratio: number;
}

/** /api/pricing 响应中的模型信息 */
export interface PricingEndpointInfo {
  docs?: string;
  method?: string;
  path?: string;
  description?: string;
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

/** /api/pricing 响应中的分组信息 */
export interface PricingGroupInfo {
  GroupRatio: number;
  DisplayName: string;
}

/** /api/pricing 完整响应 */
export interface PricingApiResponse {
  success: boolean;
  data: {
    group_info: Record<string, PricingGroupInfo>;
    model_info: PricingModelInfo[];
  };
}

/** 计算后的单个模型价格（已转换为 CNY） */
export interface ModelPrice {
  inputCnyMtok: number | null;
  outputCnyMtok: number | null;
  flatCny: number | null;
  billingType: 'token' | 'flat' | 'per-second';
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
