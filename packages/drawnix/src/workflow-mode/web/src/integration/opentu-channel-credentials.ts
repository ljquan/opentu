import type { NativeProviderCredentials } from '../../../host/native-models';
import { defaultBaseUrlForApiFormat, type ModelChannel } from '@/stores/use-config-store';

function endpointKey(baseUrl: string) {
    try {
        return new URL(baseUrl.trim()).href.replace(/\/+$/, '').replace(/\/v1$/i, '');
    } catch {
        return baseUrl.trim();
    }
}

export function automaticChannelCredentials(
    channel: ModelChannel,
    profiles: NativeProviderCredentials[],
    preferredProfileId: string | null,
): NativeProviderCredentials | undefined {
    if (channel.opentuProfileId !== undefined || channel.apiKey.trim()) return;
    const isDefaultEndpoint = !channel.baseUrl.trim() || endpointKey(channel.baseUrl) === endpointKey(defaultBaseUrlForApiFormat(channel.apiFormat));
    const candidates = isDefaultEndpoint
        ? profiles
        : profiles.filter((profile) => endpointKey(profile.baseUrl) === endpointKey(channel.baseUrl) && profile.apiFormat === channel.apiFormat);
    return candidates.find((profile) => profile.id === preferredProfileId)
        || candidates.find((profile) => profile.id === 'legacy-default')
        || (candidates.length === 1 ? candidates[0] : undefined);
}
