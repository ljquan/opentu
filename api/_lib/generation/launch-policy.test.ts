import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyLaunchInputLimits,
  assertPublicGenerationEnabled,
  launchLimits,
} from './launch-policy';
import { enforceBillingBoundary } from './repository';
import type { CreateGenerationTaskRequest, GenerationRoute } from './types';

afterEach(() => vi.unstubAllEnvs());
const request = (
  operation: 'text' | 'image' = 'text'
): CreateGenerationTaskRequest => ({
  modelId: 'test',
  operation,
  input: { prompt: 'hello' },
  parameters: {},
  references: [],
  context: {},
});

describe('free launch policy', () => {
  it.each(['', 'false', '1', 'TRUE'])(
    'defaults closed for flag %s',
    (value) => {
      vi.stubEnv('OPENTU_PUBLIC_GENERATION_ENABLED', value);
      expect(assertPublicGenerationEnabled).toThrow('生成服务暂未开放');
    }
  );
  it('enables only with an explicit true flag', () => {
    vi.stubEnv('OPENTU_PUBLIC_GENERATION_ENABLED', 'true');
    expect(assertPublicGenerationEnabled).not.toThrow();
  });
  it.each(['0', '-1', 'abc', '1.5', 'Infinity', '101'])(
    'rejects invalid concurrency %s',
    (value) => {
      vi.stubEnv('OPENTU_GENERATION_GLOBAL_CONCURRENCY', value);
      expect(launchLimits).toThrow('生成服务额度配置无效');
    }
  );
  it('caps omitted output parameters and rejects costly overrides', () => {
    const text = request();
    applyLaunchInputLimits(text);
    expect(text.parameters.maxTokens).toBe(2048);
    expect(() =>
      applyLaunchInputLimits({ ...request(), parameters: { maxTokens: 10000 } })
    ).toThrow();
    const image = request('image');
    applyLaunchInputLimits(image);
    expect(image.parameters).toMatchObject({
      n: 1,
      size: '1024x1024',
      quality: 'low',
    });
    expect(() =>
      applyLaunchInputLimits({ ...request('image'), parameters: { n: 4 } })
    ).toThrow();
  });
  it('rejects unimplemented upload paths rather than silently dropping references', () => {
    expect(() =>
      applyLaunchInputLimits({
        ...request(),
        references: [{ uploadId: 'x', role: 'image' }],
      })
    ).toThrow();
    expect(() =>
      applyLaunchInputLimits({
        ...request('image'),
        input: { prompt: 'x', images: [] },
      })
    ).toThrow();
  });
  it.each(['external', 'unconfigured'] as const)(
    'does not let an administrator canary bypass %s billing',
    async (billingMode) => {
      await expect(
        enforceBillingBoundary(
          { id: 'admin', role: 10, username: 'admin', quota: 1 },
          { billingMode } as GenerationRoute,
          true
        )
      ).rejects.toMatchObject({ code: 'BILLING_UNAVAILABLE' });
    }
  );
});
