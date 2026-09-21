import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverAndUseAllTuziProviderModels,
  discoverChangedTuziProviderModels,
} from '../tuzi-managed-provider-models';

const { discover, applySelection, setError, getState, setPersistedSelection } =
  vi.hoisted(() => ({
    discover: vi.fn(),
    applySelection: vi.fn(),
    setError: vi.fn(),
    getState: vi.fn(),
    setPersistedSelection: vi.fn(),
  }));

vi.mock('../../utils/runtime-model-discovery', () => ({
  runtimeModelDiscovery: { discover, applySelection, setError, getState },
}));
vi.mock('../tuzi-embedded-config', () => ({
  tuziEmbeddedConfig: { apiBaseUrl: 'http://localhost:3100' },
}));
vi.mock('../../utils/ai-model-selection-storage', () => ({
  setPersistedModelSelection: setPersistedSelection,
}));

const provider = {
  id: 'tuzi-managed-default',
  group: 'default',
  displayName: 'default',
  apiKey: 'sk-new',
  status: 1,
  rotatedAt: 1,
};

describe('Tuzi managed provider model synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discover.mockResolvedValue([{ id: 'model-a' }, { id: 'model-b' }]);
    getState.mockReturnValue({
      models: [
        { id: 'text-model', type: 'text', vendor: 'OTHER' },
        { id: 'image-model', type: 'image', vendor: 'GPT' },
      ],
      discoveredModels: [
        { id: 'text-model', type: 'text', vendor: 'OTHER' },
        { id: 'image-model', type: 'image', vendor: 'GPT' },
      ],
    });
  });

  it('discovers and enables every model returned for the group key', async () => {
    await expect(discoverAndUseAllTuziProviderModels(provider)).resolves.toBe(
      2
    );

    expect(discover).toHaveBeenCalledWith(
      provider.id,
      'http://localhost:3100/v1',
      'sk-new',
      [],
      { selectAll: true }
    );
    expect(applySelection).not.toHaveBeenCalled();
  });

  it('only refreshes models for first-time or changed keys', async () => {
    await discoverChangedTuziProviderModels(
      [provider, { ...provider, id: 'tuzi-managed-vip', group: 'vip' }],
      new Map([
        [provider.id, 'sk-old'],
        ['tuzi-managed-vip', 'sk-new'],
      ])
    );

    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith(
      provider.id,
      expect.any(String),
      provider.apiKey,
      [],
      { selectAll: true }
    );
  });

  it('backfills models for an existing key with no model catalog', async () => {
    getState
      .mockReturnValueOnce({ discoveredModels: [] })
      .mockReturnValue({ discoveredModels: [{ id: 'model-a' }] });

    await discoverChangedTuziProviderModels(
      [provider],
      new Map([[provider.id, provider.apiKey]])
    );

    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('selects the first image model only when explicitly requested', async () => {
    await discoverChangedTuziProviderModels([provider], new Map(), {
      selectImageModelForProviderId: provider.id,
    });

    expect(setPersistedSelection).toHaveBeenCalledWith('image', {
      modelId: 'image-model',
      modelRef: {
        profileId: provider.id,
        modelId: 'image-model',
      },
      providerIdHint: provider.id,
      vendorHint: 'GPT',
    });
  });

  it('does not override image selection during background synchronization', async () => {
    await discoverChangedTuziProviderModels([provider], new Map());

    expect(setPersistedSelection).not.toHaveBeenCalled();
  });
});
