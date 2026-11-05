import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCatalog, ProviderProfile } from '../utils/settings-types';
import { VersionModelRefresh } from './version-model-refresh';
import { discoverProviderModels } from './provider-model-catalog';
import { runtimeModelDiscovery } from '../utils/runtime-model-discovery';
const mocks = vi.hoisted(() => ({
  profiles: [] as ProviderProfile[],
  catalogs: [] as ProviderCatalog[],
  initialize: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock('../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
  providerProfilesSettings: {
    get: () => mocks.profiles,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  providerCatalogsSettings: {
    get: () => mocks.catalogs,
    addListener: vi.fn(),
    update: vi.fn(async (catalogs: ProviderCatalog[]) => {
      mocks.catalogs = catalogs;
    }),
  },
  invocationPresetsSettings: { addListener: vi.fn() },
  settingsManager: {
    getSetting: () => [],
    addListener: vi.fn(),
    waitForInitialization: mocks.initialize,
  },
}));
vi.mock('./tuzi-embedded-config', () => ({ isTuziEmbeddedMode: () => false }));
vi.mock('./tuzi-provider-reuse-state', () => ({
  isCurrentTuziEndpoint: () => false,
  isVerifiedTuziProvider: () => true,
  TUZI_PROVIDER_REUSE_EVENT: 'test-verified',
}));
vi.mock('./tuzi-postmessage-bridge', () => ({
  requestTuziParentContext: vi.fn(),
  TUZI_BRIDGE_EVENT: 'test-bridge',
}));
function profile(id = 'custom'): ProviderProfile {
  return {
    id,
    name: id,
    apiKey: 'test-key',
    baseUrl: 'https://models.example.test/v1',
    enabled: true,
    authType: 'bearer',
    providerType: 'openai-compatible',
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: true,
      supportsAudio: true,
      supportsTools: true,
    },
  };
}
function response(ids = ['gpt-image-2.6-1k']) {
  return Response.json({ data: ids.map((id) => ({ id })) });
}
async function seed() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(response(['gpt-image-2', 'gpt-image-2.5']))
  );
  await discoverProviderModels(mocks.profiles[0], [], { selectAll: true });
  runtimeModelDiscovery.applySelection('custom', ['gpt-image-2']);
}
describe('models refresh once per application version', () => {
  beforeEach(() => {
    mocks.profiles = [profile()];
    mocks.catalogs = [];
    runtimeModelDiscovery.clear('custom');
    runtimeModelDiscovery.clear('other');
    vi.clearAllMocks();
    mocks.initialize.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('adds new image models, preserves deselections and persists the version across restarts', async () => {
    await seed();
    const fetch = vi.fn(async () =>
      response(['gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.6-1k'])
    );
    vi.stubGlobal('fetch', fetch);
    const runner = new VersionModelRefresh();
    await runner.refresh('1.2.7');
    expect(runtimeModelDiscovery.getSelectedModelIds('custom')).toEqual([
      'gpt-image-2',
      'gpt-image-2.6-1k',
    ]);
    expect(
      runtimeModelDiscovery
        .getState('custom')
        .models.find((m) => m.id === 'gpt-image-2.6-1k')
    ).toMatchObject({
      type: 'image',
      selectionKey: 'custom::gpt-image-2.6-1k',
    });
    expect(
      mocks.catalogs.find((c) => c.profileId === 'custom')
        ?.lastAutoRefreshVersion
    ).toBe('1.2.7');
    await runner.refresh('1.2.7');
    await new VersionModelRefresh().refresh('1.2.7');
    expect(fetch).toHaveBeenCalledTimes(1);
    await runner.refresh('1.2.8');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(runtimeModelDiscovery.getState('custom').lastAutoRefreshVersion).toBe('1.2.8');
  });
  it('deduplicates concurrent startup/configuration notifications', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const runner = new VersionModelRefresh();
    await Promise.all([
      runner.refresh('1.2.7'),
      runner.refresh('1.2.7'),
      runner.refresh('1.2.7'),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps cached models on failure and retries next startup without looping this session', async () => {
    await seed();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'not authorized' }, { status: 401 })
      );
    vi.stubGlobal('fetch', fetch);
    const runner = new VersionModelRefresh();
    await runner.refresh('1.2.7');
    expect(runtimeModelDiscovery.getSelectedModelIds('custom')).toEqual([
      'gpt-image-2',
    ]);
    expect(
      runtimeModelDiscovery.getState('custom').lastAutoRefreshVersion
    ).toBeUndefined();
    await runner.refresh('1.2.7');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(response());
    await new VersionModelRefresh().refresh('1.2.7');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      runtimeModelDiscovery.getState('custom').lastAutoRefreshVersion
    ).toBe('1.2.7');
  });
  it.each(['disabled', 'no-key', 'no-models-endpoint', 'custom-auth'])(
    'skips %s until configuration is eligible',
    async (reason) => {
      const p = mocks.profiles[0];
      if (reason === 'disabled') p.enabled = false;
      if (reason === 'no-key') p.apiKey = '';
      if (reason === 'no-models-endpoint')
        p.capabilities.supportsModelsEndpoint = false;
      if (reason === 'custom-auth') p.authType = 'header';
      const fetch = vi.fn().mockResolvedValue(response());
      vi.stubGlobal('fetch', fetch);
      const runner = new VersionModelRefresh();
      await runner.refresh('1.2.7');
      expect(fetch).not.toHaveBeenCalled();
      mocks.profiles = [profile()];
      await runner.refresh('1.2.7');
      expect(fetch).toHaveBeenCalledOnce();
    }
  );
  it('waits for saved credentials to decrypt', async () => {
    let ready!: () => void;
    mocks.initialize.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      })
    );
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const run = new VersionModelRefresh().refresh('1.2.7');
    expect(fetch).not.toHaveBeenCalled();
    ready();
    await run;
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(['key', 'disabled', 'removed'])(
    'discards a late response after provider %s changes',
    async (change) => {
      await seed();
      let finish!: (response: Response) => void;
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      );
      vi.stubGlobal('fetch', fetch);
      const run = new VersionModelRefresh().refresh('1.2.7');
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      if (change === 'key') mocks.profiles[0].apiKey = 'new-key';
      if (change === 'disabled') mocks.profiles[0].enabled = false;
      if (change === 'removed') mocks.profiles = [];
      finish(response());
      await run;
      expect(
        runtimeModelDiscovery.getState('custom').lastAutoRefreshVersion
      ).toBeUndefined();
      expect(
        runtimeModelDiscovery
          .getState('custom')
          .discoveredModels.map((m) => m.id)
      ).not.toContain('gpt-image-2.6-1k');
    }
  );
  it('preserves user edits made during discovery', async () => {
    await seed();
    let finish!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    vi.stubGlobal('fetch', fetch);
    const run = new VersionModelRefresh().refresh('1.2.7');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    runtimeModelDiscovery.applySelection('custom', ['gpt-image-2.5']);
    runtimeModelDiscovery.addManualModel('custom', {
      id: 'my-image',
      type: 'image',
    });
    finish(response(['gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.6-1k']));
    await run;
    expect(runtimeModelDiscovery.getSelectedModelIds('custom')).toEqual([
      'gpt-image-2.5',
      'my-image',
      'gpt-image-2.6-1k',
    ]);
  });
  it.each(['success', 'failure'])(
    'does not overwrite manual discovery with an older automatic %s',
    async (result) => {
      let finish!: (response: Response) => void;
      const fetch = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finish = resolve;
            })
        )
        .mockResolvedValue(response(['gpt-image-2.5']));
      vi.stubGlobal('fetch', fetch);
      const run = new VersionModelRefresh().refresh('1.2.7');
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      await discoverProviderModels(mocks.profiles[0], [], { selectAll: true });
      finish(
        result === 'success'
          ? response()
          : Response.json({ error: 'expired' }, { status: 401 })
      );
      await run;
      expect(runtimeModelDiscovery.getSelectedModelIds('custom')).toEqual([
        'gpt-image-2.5',
      ]);
      expect(runtimeModelDiscovery.getState('custom').status).toBe('ready');
      expect(
        runtimeModelDiscovery.getState('custom').lastAutoRefreshVersion
      ).toBeUndefined();
    }
  );
  it('invalidates a prior success when changed credentials fail', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    await new VersionModelRefresh().refresh('1.2.7');
    mocks.profiles[0].apiKey = 'changed-key';
    fetch.mockResolvedValue(
      Response.json({ error: 'invalid' }, { status: 401 })
    );
    await new VersionModelRefresh().refresh('1.2.7');
    expect(
      runtimeModelDiscovery.getState('custom').lastAutoRefreshVersion
    ).toBeUndefined();
    fetch.mockResolvedValue(response());
    await new VersionModelRefresh().refresh('1.2.7');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('isolates failed providers and skips unknown app versions', async () => {
    mocks.profiles.push(profile('other'));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'invalid' }, { status: 401 })
      )
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const runner = new VersionModelRefresh();
    await runner.refresh('');
    await runner.refresh('0.0.0');
    expect(fetch).not.toHaveBeenCalled();
    await runner.refresh('1.2.7');
    expect(
      runtimeModelDiscovery.getState('custom').lastAutoRefreshVersion
    ).toBeUndefined();
    expect(runtimeModelDiscovery.getState('other').lastAutoRefreshVersion).toBe(
      '1.2.7'
    );
  });
});
