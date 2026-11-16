import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../constants/model-config';
import { resolveSavedGenerationModel } from './restore-generation-model';
const mocks = vi.hoisted(() => ({
  profiles: [] as any[],
  pinned: vi.fn(),
  state: vi.fn(),
  discover: vi.fn(),
}));
vi.mock('./settings-manager', () => ({
  providerProfilesSettings: { get: () => mocks.profiles },
}));
vi.mock('./runtime-model-discovery', () => ({
  getPinnedSelectableModel: (...args: unknown[]) => mocks.pinned(...args),
  runtimeModelDiscovery: {
    getState: () => mocks.state(),
    getInFlightDiscovery: () => undefined,
    discover: (...args: unknown[]) => mocks.discover(...args),
  },
}));
const model: ModelConfig = {
  id: 'historical-image',
  type: 'image',
  label: 'Historical',
  shortLabel: 'Historical',
  vendor: ModelVendor.OTHER,
  sourceProfileId: 'original',
  selectionKey: 'original::historical-image',
};
const ref = { profileId: 'original', modelId: model.id };
describe('saved generation model restore', () => {
  beforeEach(() => {
    mocks.profiles = [
      {
        id: 'original',
        enabled: true,
        baseUrl: 'http://localhost',
        apiKey: 'test',
      },
    ];
    mocks.pinned.mockReturnValue(model);
    mocks.state.mockReturnValue({ discoveredModels: [model] });
    mocks.discover.mockReset();
  });
  it('restores the exact historical model even when it is hidden from the quick list', async () => {
    expect(
      await resolveSavedGenerationModel('image', [], model.id, ref)
    ).toEqual(model);
  });
  it('loads the original provider catalog after refresh before restoring', async () => {
    mocks.state.mockReturnValue({ discoveredModels: [] });
    mocks.discover.mockResolvedValue([model]);
    expect(
      await resolveSavedGenerationModel('image', [], model.id, ref)
    ).toEqual(model);
    expect(mocks.discover).toHaveBeenCalledWith(
      'original',
      'http://localhost',
      'test'
    );
  });

  it('never substitutes a different provider', async () => {
    mocks.pinned.mockReturnValue({
      ...model,
      sourceProfileId: 'other',
      selectionKey: 'other::historical-image',
    });
    expect(
      await resolveSavedGenerationModel('image', [], model.id, ref)
    ).toBeUndefined();
  });
  it.each(['missing', 'disabled', 'no-key', 'no-url'])(
    'rejects %s provider settings',
    async (reason) => {
      if (reason === 'missing') mocks.profiles = [];
      if (reason === 'disabled') mocks.profiles[0].enabled = false;
      if (reason === 'no-key') mocks.profiles[0].apiKey = '';
      if (reason === 'no-url') mocks.profiles[0].baseUrl = '';
      expect(
        await resolveSavedGenerationModel('image', [model], model.id, ref)
      ).toBeUndefined();
    }
  );
  it('rejects a model that discovery no longer provides', async () => {
    mocks.pinned.mockReturnValue(null);
    expect(
      await resolveSavedGenerationModel('image', [], model.id, ref)
    ).toBeUndefined();
  });
});
