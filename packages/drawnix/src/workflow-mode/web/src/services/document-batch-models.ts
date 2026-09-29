import { decodeChannelModel, encodeChannelModel, type AiConfig } from '@/stores/use-config-store';
import type { WorkflowChannel } from '../../../shared/model-defaults';

type Channel = Pick<WorkflowChannel, 'id' | 'opentuProfileId' | 'models'>;

/** Batch requests must keep a native route snapshot and cannot execute custom scripts. */
export function resolveBatchImageModel(channels: Channel[], value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return undefined;
    const channel = channels.find(item => item.id === decoded.channelId);
    if (!channel || channel.opentuProfileId === undefined) return undefined;
    const entry = channel.models.find(item => item.name === decoded.model && item.capability === 'image');
    if (!entry || entry.script || entry.unavailableReason || !entry.parameters) return undefined;
    return { channel, entry };
}

export function batchImageConfig(config: AiConfig): AiConfig {
    const channels = config.channels.map(channel => ({ ...channel, models: channel.models.filter(entry =>
        resolveBatchImageModel([channel], encodeChannelModel(channel.id, entry.name))?.entry === entry,
    ) })).filter(channel => channel.models.length > 0);
    return { ...config, channels, models: channels.flatMap(channel => channel.models.map(entry => encodeChannelModel(channel.id, entry.name))) };
}
