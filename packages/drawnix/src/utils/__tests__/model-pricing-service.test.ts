import { describe, expect, it } from 'vitest';
import {
  getPricingCacheTtlMs,
  MODEL_PRICING_CACHE_TTL_MS,
  TUZI_PRICING_CACHE_TTL_MS,
} from '../model-pricing-service';

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
});
