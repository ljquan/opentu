import { describe, expect, it } from 'vitest';
import {
  buildPricingSourceSignature,
  getPricingCacheTtlMs,
  isPricingCacheEligibleForWarmup,
  MODEL_PRICING_CACHE_TTL_MS,
  TUZI_PRICING_CACHE_TTL_MS,
} from '../model-pricing-service';
import type { ProviderPricingCache } from '../model-pricing-types';

describe('model-pricing-service', () => {
  it('对 Tuzi 价格接口使用每日缓存', () => {
    expect(getPricingCacheTtlMs('https://api.tu-zi.com/api/pricing')).toBe(
      TUZI_PRICING_CACHE_TTL_MS
    );
    expect(
      getPricingCacheTtlMs('https://api.tu-zi.com/api/pricing?group=default')
    ).toBe(TUZI_PRICING_CACHE_TTL_MS);
  });

  it('对非 Tuzi 价格接口保持默认短缓存', () => {
    expect(getPricingCacheTtlMs('https://example.com/api/pricing')).toBe(
      MODEL_PRICING_CACHE_TTL_MS
    );
  });

  it('仅允许手动成功或旧版已缓存签名参与自动更新', () => {
    const sourceSignature = buildPricingSourceSignature(
      'https://api.tu-zi.com/api/pricing',
      'default',
      0.7
    );

    const manualReadyCache: ProviderPricingCache = {
      profileId: 'p1',
      fetchedAt: Date.now(),
      sourceSignature,
      autoRefreshSourceSignature: sourceSignature,
      groups: [],
      prices: {},
    };
    expect(isPricingCacheEligibleForWarmup(manualReadyCache, sourceSignature)).toBe(true);

    const explicitlyDisabledCache: ProviderPricingCache = {
      ...manualReadyCache,
      autoRefreshSourceSignature: null,
    };
    expect(
      isPricingCacheEligibleForWarmup(explicitlyDisabledCache, sourceSignature)
    ).toBe(false);

    const legacyCache: ProviderPricingCache = {
      ...manualReadyCache,
      autoRefreshSourceSignature: undefined,
    };
    expect(isPricingCacheEligibleForWarmup(legacyCache, sourceSignature)).toBe(true);

    expect(isPricingCacheEligibleForWarmup(null, sourceSignature)).toBe(false);
  });
});
