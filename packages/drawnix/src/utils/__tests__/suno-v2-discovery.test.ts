import { afterEach, describe, expect, it, vi } from 'vitest';

const pricing = vi.hoisted(() => ({ caches: [] as unknown[], changed: undefined as (() => void) | undefined }));

vi.mock('../settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy',
  providerCatalogsSettings: {
    get: () => [{ profileId: 'p', discoveredModels: [
      { id: 'suno/music', label: 'chat', type: 'text', vendor: 'OTHER' },
      { id: 'suno_music', label: 'legacy', type: 'audio', vendor: 'SUNO' },
    ], selectedModelIds: ['suno/music', 'suno_music'] }],
    addListener: vi.fn(), update: vi.fn(),
  },
  providerProfilesSettings: { get: () => [{ id: 'p', name: 'Tuzi', enabled: true }], addListener: vi.fn() },
  invocationPresetsSettings: { addListener: vi.fn() },
  settingsManager: {
    addListener: (key: string, listener: () => void) => {
      if (key === 'providerPricingCache') pricing.changed = listener;
    },
    getSetting: () => pricing.caches,
  },
}));
vi.mock('../../services/tuzi-embedded-config', () => ({ isTuziEmbeddedMode: () => false }));

describe('Suno v2 discovery', () => {
  afterEach(() => { pricing.caches = []; vi.unstubAllGlobals(); });
  it('restores stale chat catalogs as audio without inventing unlisted channel capabilities', async () => {
    const { runtimeModelDiscovery } = await import('../runtime-model-discovery');
    expect(runtimeModelDiscovery.getConfiguredSelectableModels('audio')).toEqual([
      expect.objectContaining({ id: 'suno/music', type: 'audio', sourceProfileId: 'p', selectionKey: 'p::suno/music', shortLabel: '音乐生成' }),
      expect.objectContaining({ id: 'suno_music', type: 'audio' }),
    ]);
    expect(runtimeModelDiscovery.getConfiguredSelectableModels('text')).toEqual([]);
    expect(runtimeModelDiscovery.getDiscoveredModels('p').map((model) => model.id)).not.toContain('suno/cover');
  });

  it('discovers v2 actions as audio despite Chat Completions metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [
      { id: 'suno/music', category: 'text', supported_endpoint_types: ['openai-chat'] },
      { id: 'suno/cover', category: 'text', supported_endpoint_types: ['openai-chat'] },
    ] })));
    try {
      const { runtimeModelDiscovery } = await import('../runtime-model-discovery');
      await runtimeModelDiscovery.discover('p', 'https://api.tu-zi.com', 'test', [], { selectAll: true });
      expect(runtimeModelDiscovery.getConfiguredSelectableModels('audio').map((model) => model.id).sort()).toEqual(['suno/cover', 'suno/music']);
    } finally { vi.unstubAllGlobals(); }
  });

  it('does not add pricing-only actions during refresh or catalog restoration', async () => {
    const { runtimeModelDiscovery } = await import('../runtime-model-discovery');
    pricing.caches = [{ profileId: 'p', modelEndpoints: {
      'suno/cover': { native: { path: '/suno/v2/cover', method: 'POST' } },
      'suno/create-voice': { native: { path: '/suno/v2/create-voice', method: 'POST' } },
      'suno/add-instrumental': { native: { path: '/suno/v2/add-instrumental', method: 'POST' } },
      'suno/add-vocals': { native: { path: '/suno/v2/add-vocals', method: 'POST' } },
      'suno/extend': { native: { path: '/suno/v2/music', method: 'POST' } },
      'suno/upload': { chat: { path: '/v1/chat/completions' } },
      'suno/download': { query: { path: '/suno/v2/download', method: 'GET' } },
      suno_music: { native: { path: '/suno/v2/music', method: 'POST' } },
    } }, { profileId: 'other', modelEndpoints: {
      'suno/remaster': { native: { path: '/suno/v2/remaster', method: 'POST' } },
    } }];
    pricing.changed?.();
    expect(runtimeModelDiscovery.getDiscoveredModels('p').map((model) => model.id).sort())
      .toEqual(['suno/music', 'suno_music']);
    expect(runtimeModelDiscovery.getSelectedModelIds('p')).toEqual(['suno/music', 'suno_music']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'suno_music' }] })));
    await runtimeModelDiscovery.discover('p', 'https://api.tu-zi.com', 'test', [], { selectAll: true });
    expect(runtimeModelDiscovery.getConfiguredSelectableModels('audio').map((model) => model.id).sort())
      .toEqual(['suno_music']);
    expect(fetch).toHaveBeenCalledTimes(1);
    pricing.caches = [];
    pricing.changed?.();
    expect(runtimeModelDiscovery.getDiscoveredModels('p').map((model) => model.id))
      .not.toContain('suno/cover');
  });
  it('classifies documented MP4, MIDI and Persona entries as audio even when the catalog says chat', async () => {
    const ids = ['suno_act_mp4', 'suno_act_midi', 'suno_persona_create'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: ids.map((id) => ({ id, category: 'text', supported_endpoint_types: ['openai-chat'] })) })));
    try {
      const { runtimeModelDiscovery } = await import('../runtime-model-discovery');
      await runtimeModelDiscovery.discover('p', 'https://api.tu-zi.com', 'test', [], { selectAll: true });
      expect(runtimeModelDiscovery.getConfiguredSelectableModels('audio').map((model) => model.id).sort()).toEqual([...ids].sort());
      expect(runtimeModelDiscovery.getConfiguredSelectableModels('text')).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

});
