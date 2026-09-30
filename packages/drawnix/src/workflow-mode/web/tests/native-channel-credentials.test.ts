import { describe, expect, it } from 'vitest';
import { automaticChannelCredentials } from '../src/integration/opentu-channel-credentials';
import { defaultConfig } from '../src/stores/use-config-store';
import type { NativeProviderCredentials } from '../../host/native-models';

const channel = defaultConfig.channels[0];
const providers: NativeProviderCredentials[] = [
    { id: 'legacy-default', name: 'Default', apiFormat: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'test-default' },
    { id: 'mix', name: 'Mix', apiFormat: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'test-mix' },
];

describe('automatic channel credential selection', () => {
    it('uses the active image profile for a blank default channel, with the default group as fallback', () => {
        expect(automaticChannelCredentials(channel, providers, 'mix')).toBe(providers[1]);
        expect(automaticChannelCredentials(channel, providers, 'removed')).toBe(providers[0]);
    });
    it('preserves existing credentials and native channel ownership', () => {
        expect(automaticChannelCredentials({ ...channel, apiKey: 'user-value' }, providers, 'mix')).toBeUndefined();
        expect(automaticChannelCredentials({ ...channel, opentuProfileId: 'mix' }, providers, 'mix')).toBeUndefined();
    });
    it('fills a matching custom endpoint, treating /v1 and trailing slash as equivalent', () => {
        expect(automaticChannelCredentials({ ...channel, baseUrl: 'https://provider.example/' }, providers, 'mix')).toBe(providers[1]);
    });
    it('never sends the host key to a different custom URL or protocol', () => {
        expect(automaticChannelCredentials({ ...channel, baseUrl: 'https://another.example' }, providers, 'mix')).toBeUndefined();
        expect(automaticChannelCredentials({ ...channel, baseUrl: 'https://provider.example', apiFormat: 'gemini' }, providers, 'mix')).toBeUndefined();
    });
    it('uses a single configured profile but leaves multiple unrelated profiles for explicit selection', () => {
        const candidates = providers.map((provider, index) => ({ ...provider, id: `custom-${index}` }));
        expect(automaticChannelCredentials(channel, candidates, null)).toBeUndefined();
        expect(automaticChannelCredentials(channel, candidates.slice(1), null)).toBe(candidates[1]);
        expect(automaticChannelCredentials(channel, [], null)).toBeUndefined();
    });
});
