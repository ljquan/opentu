import { describe, expect, it, vi } from 'vitest';
import { readNativeModels } from './native-models';
import { resolveNativeParameters } from '../shared/native-parameters';

vi.mock('../../utils/settings-manager', () => ({
  settingsManager: { waitForInitialization: async () => {} },
  providerProfilesSettings: {
    get: () => [
      { id: 'a', name: 'A', enabled: true },
      { id: 'b', name: 'B', enabled: true },
    ],
  },
  providerCatalogsSettings: {
    get: () =>
      ['a', 'b'].map((profileId) => ({
        profileId,
        discoveredModels: [
          { id: 'sora-2', type: 'video' },
          { id: 'gpt-image-2', type: 'image' },
        ],
        selectedModelIds: [],
      })),
  },
  resolveInvocationRoute: (routeType: string) => ({
    routeType,
    profileId: 'a',
    modelId:
      routeType === 'image'
        ? 'gpt-image-2'
        : routeType === 'video'
        ? 'sora-2'
        : 'unconfigured',
  }),
}));
vi.mock('../../services/model-adapters', () => ({
  getAdapterContextFromSettings: () => ({ binding: null }),
  resolveAdapterForInvocation: (
    kind: string,
    _model: string,
    ref: { profileId: string }
  ) =>
    kind === 'image'
      ? {
          id:
            ref.profileId === 'a'
              ? 'gpt-image-adapter'
              : 'tuzi-gpt-image-adapter',
          kind,
        }
      : kind === 'video'
      ? { id: 'gemini-video-adapter', kind }
      : undefined,
}));
vi.mock('../../services/video-binding-utils', () => ({
  getEffectiveVideoCompatibleParams: (
    _model: string,
    ref: { profileId: string },
    params?: Record<string, string>
  ) => [
    {
      id: 'duration',
      label: 'Duration',
      valueType: 'enum',
      options: [
        {
          value:
            params?.sora_mode === 'api'
              ? '4'
              : ref.profileId === 'a'
              ? '10'
              : '15',
          label: 'Duration',
        },
      ],
      defaultValue:
        params?.sora_mode === 'api' ? '4' : ref.profileId === 'a' ? '10' : '15',
    },
    {
      id: 'sora_mode',
      label: 'Mode',
      valueType: 'enum',
      options: [
        { value: 'web', label: 'Web' },
        { value: 'api', label: 'API' },
      ],
      defaultValue: 'web',
    },
  ],
}));

describe('runtime native metadata', () => {
  it('resolves channel-specific adapters and conditional parameter contracts', async () => {
    const result = await readNativeModels();
    const a = result.channels.find(
      (channel) => channel.opentuProfileId === 'a'
    )!;
    const b = result.channels.find(
      (channel) => channel.opentuProfileId === 'b'
    )!;
    const soraA = a.models.find((model) => model.name === 'sora-2')!;
    const soraB = b.models.find((model) => model.name === 'sora-2')!;
    expect(resolveNativeParameters(soraA.parameters!, {}).duration).toBe('10');
    expect(resolveNativeParameters(soraB.parameters!, {}).duration).toBe('15');
    expect(
      resolveNativeParameters(soraA.parameters!, { sora_mode: 'api' }).duration
    ).toBe('4');
    expect(() =>
      resolveNativeParameters(soraA.parameters!, {
        sora_mode: 'api',
        duration: '15',
      })
    ).toThrow();
    expect(
      a.models
        .find((model) => model.name === 'gpt-image-2')!
        .parameters!.some((parameter) => parameter.id === 'background')
    ).toBe(true);
    expect(
      b.models
        .find((model) => model.name === 'gpt-image-2')!
        .parameters!.some((parameter) => parameter.id === 'background')
    ).toBe(false);
    expect(
      result.coverage!.filter((entry) => entry.modelId === 'sora-2')
    ).toHaveLength(2);
  });
});
