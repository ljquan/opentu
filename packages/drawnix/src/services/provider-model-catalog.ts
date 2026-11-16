import type { ModelConfig } from '../constants/model-config';
import {
  runtimeModelDiscovery,
  type RuntimeModelDiscoveryOptions,
} from '../utils/runtime-model-discovery';
import { normalizeModelApiBaseUrl } from '../utils/provider-base-url';
import {
  TUZI_PROVIDER_DEFAULT_BASE_URL,
  type ProviderProfile,
} from '../utils/settings-manager';
import { isTuziCompatibleBaseUrl } from './provider-routing/tuzi-api-endpoints';

interface DiscoverProviderModelsOptions
  extends Pick<
    RuntimeModelDiscoveryOptions,
    'selectAll' | 'signal' | 'refreshForVersion' | 'shouldApply'
  > {
  forceMarketplaceRefresh?: boolean;
}

export function usesTuziMarketplace(profile: ProviderProfile): boolean {
  return (
    profile.id.startsWith('tuzi-') ||
    isTuziCompatibleBaseUrl(
      profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL
    ) ||
    isTuziCompatibleBaseUrl(profile.pricingUrl)
  );
}

export async function discoverProviderModels(
  profile: ProviderProfile,
  fallbackBaseUrls: string[] = [],
  options: DiscoverProviderModelsOptions = {}
): Promise<ModelConfig[]> {
  const baseUrl = normalizeModelApiBaseUrl(
    profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL
  );
  const loadModelMetadata: RuntimeModelDiscoveryOptions['loadModelMetadata'] =
    usesTuziMarketplace(profile)
      ? async () => {
          const { modelPricingService, resolveProviderPricingConfig } =
            await import('../utils/model-pricing-service');
          const pricingConfig = resolveProviderPricingConfig(profile);
          if (!pricingConfig) {
            return [];
          }
          const catalog = await modelPricingService.fetchAndCache(
            profile.id,
            pricingConfig.pricingUrl,
            profile.apiKey.trim(),
            pricingConfig.pricingGroup,
            pricingConfig.cnyPerUsd,
            { force: options.forceMarketplaceRefresh }
          );
          return Object.entries(catalog.prices).map(([id, price]) => ({
            id,
            description: price.description,
            ...catalog.modelCatalog?.[id],
            supported_endpoint_types:
              catalog.modelCatalog?.[id]?.supported_endpoint_types ||
              Object.keys(catalog.modelEndpoints?.[id] || {}),
          }));
        }
      : undefined;

  return runtimeModelDiscovery.discover(
    profile.id,
    baseUrl,
    profile.apiKey.trim(),
    fallbackBaseUrls,
    {
      selectAll: options.selectAll,
      refreshForVersion: options.refreshForVersion,
      shouldApply: options.shouldApply,
      signal: options.signal,
      loadModelMetadata,
    }
  );
}
