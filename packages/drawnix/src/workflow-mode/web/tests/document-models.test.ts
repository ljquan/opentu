import { describe, expect, it } from 'vitest';
import { batchImageConfig, resolveBatchImageModel } from '../src/services/document-batch-models';
import { defaultConfig, type AiConfig } from '../src/stores/use-config-store';

const entry = { name: 'gpt-image-2', capability: 'image' as const, parameters: [] };
const config: AiConfig = { ...defaultConfig, channels: [
    {id:'custom',name:'Custom',baseUrl:'',apiKey:'',apiFormat:'openai',models:[entry]},
    {id:'native',name:'OpenTu',baseUrl:'',apiKey:'',apiFormat:'openai',opentuProfileId:'p',models:[entry,
        {...entry,name:'script',script:'custom()'}, {...entry,name:'unavailable',unavailableReason:'disabled'},
        {...entry,name:'pending',parameters:undefined}, {...entry,name:'text',capability:'text'}]},
] };
describe('batch model eligibility', () => {
    it('only offers models accepted by the durable native queue', () => {
        const filtered = batchImageConfig(config);
        expect(filtered.models).toEqual(['native::gpt-image-2']);
        expect(filtered.channels).toHaveLength(1);
        expect(resolveBatchImageModel(config.channels, filtered.models[0])?.channel.opentuProfileId).toBe('p');
    });
    it('never silently migrates a custom or stale channel to an identically named native model', () => {
        for (const model of ['custom::gpt-image-2','removed::gpt-image-2','gpt-image-2','native::script','native::pending','native::unavailable']) {
            expect(resolveBatchImageModel(config.channels,model)).toBeUndefined();
        }
        expect(config.channels[0].models).toHaveLength(1);
    });
});
