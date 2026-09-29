import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readNativeModels } from '../../host/native-models';
import { syncOpenTuModels } from '../src/integration/opentu-model-defaults';
import { configuredChannelsOnly, defaultConfig, selectableModelsByCapability, useConfigStore, type ModelChannel } from '../src/stores/use-config-store';
vi.mock('../../host/native-models', () => ({ readNativeModels: vi.fn() }));
const local: ModelChannel = { id: 'tuzi', name: 'Tuzi 固定渠道', providerKind: 'tuzi-fixed', baseUrl: 'https://api.tu-zi.com', apiKey: 'fake', apiFormat: 'openai', credentials: [{ id: 'key', label: 'test', apiKey: 'fake', createdAt: 1 }], activeCredentialId: 'key', models: [{ name: 'image', capability: 'image' }, { name: 'video', capability: 'video' }] };
const host: ModelChannel = { id: 'opentu-native-p', name: 'OpenTu / default', opentuProfileId: 'p', baseUrl: '', apiKey: '', apiFormat: 'openai', models: [{ name: 'image', capability: 'image' }, { name: 'host-only', capability: 'text' }] };
beforeEach(() => { vi.clearAllMocks(); useConfigStore.setState({ config: { ...defaultConfig, channels: [host, local], imageModel: `${host.id}::image`, textModel: `${host.id}::host-only`, videoModel: 'tuzi::video', model: `${host.id}::image` } }); });
describe('configured workflow model sources', () => {
    it('removes hidden host catalogs without fetching any catalog or changing local keys', async () => {
        await syncOpenTuModels();
        const config = useConfigStore.getState().config;
        expect(config.channels).toEqual([local]);
        expect(config.channels[0]).toBe(local);
        expect(config.models).toEqual(['tuzi::image', 'tuzi::video']);
        expect(readNativeModels).not.toHaveBeenCalled();
    });
    it('migrates only unique matching host preferences and clears unavailable models', async () => {
        await syncOpenTuModels();
        expect(useConfigStore.getState().config).toMatchObject({ model: 'tuzi::image', imageModel: 'tuzi::image', videoModel: 'tuzi::video', textModel: '' });
        expect(selectableModelsByCapability(useConfigStore.getState().config, 'image')).toEqual(['tuzi::image']);
    });
    it('preserves intentionally empty selections and remains idempotent', async () => {
        useConfigStore.setState({ config: { ...useConfigStore.getState().config, imageModel: '', systemPrompt: 'keep' } });
        await syncOpenTuModels();
        const first = useConfigStore.getState().config;
        await syncOpenTuModels();
        expect(useConfigStore.getState().config).toBe(first);
        expect(first.imageModel).toBe('');
        expect(first.systemPrompt).toBe('keep');
    });
    it('does not guess between two local channels or reroute a deleted local channel', () => {
        const config = configuredChannelsOnly({ ...useConfigStore.getState().config, channels: [host, local, { ...local, id: 'other' }], videoModel: 'deleted::video' });
        expect(config.imageModel).toBe('');
        expect(config.videoModel).toBe('');
    });
    it('does not recreate a default channel when only old host channels remain', () => {
        expect(configuredChannelsOnly({ ...defaultConfig, channels: [host] }).channels).toEqual([]);
    });
    it('filters persisted catalogs and preserves an explicitly empty channel list', () => {
        const merge = useConfigStore.persist.getOptions().merge!;
        const current = useConfigStore.getState();
        const restored = merge({ config: current.config }, current);
        expect(restored.config.channels.map(channel => channel.id)).toEqual(['tuzi']);
        expect(restored.config.imageModel).toBe('tuzi::image');
        const empty = merge({ config: { ...current.config, channels: [] } }, current);
        expect(empty.config.channels).toEqual([]);
        expect(empty.config.models).toEqual([]);
    });
    it('does not mutate after the caller becomes inactive' , async () => {
        const original = useConfigStore.getState().config;
        await syncOpenTuModels(() => false);
        expect(useConfigStore.getState().config).toBe(original);
    });
});
