import { describe, expect, it } from 'vitest';
import type { ProviderProfile } from '../../../utils/settings-manager';
import { canDisableProvider } from '../provider-toggle-utils';

function createProvider(id: string, enabled: boolean): ProviderProfile {
  return {
    id,
    name: id,
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-test',
    providerType: 'openai-compatible',
    authType: 'bearer',
    enabled,
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: false,
      supportsAudio: false,
      supportsTools: false,
    },
  };
}

describe('provider-toggle-utils', () => {
  it('允许关闭 default，只要还有其他启用供应商', () => {
    expect(
      canDisableProvider(
        [createProvider('legacy-default', true), createProvider('vip', true)],
        'legacy-default'
      )
    ).toBe(true);
  });

  it('不允许关闭最后一个启用供应商', () => {
    expect(
      canDisableProvider(
        [createProvider('legacy-default', true), createProvider('vip', false)],
        'legacy-default'
      )
    ).toBe(false);
  });
});
