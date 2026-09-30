import axios from 'axios';
import { providerTransport } from '../../../../../services/provider-routing/provider-transport';
import { isTrustedTuziApiBaseUrl, isTuziRequestRecoveryBaseUrl, loadTuziApiEndpointBaseUrls, normalizeTuziApiEndpointUrl } from '../../../../../services/provider-routing/tuzi-api-endpoints';
import { withLocalProxy } from '@/stores/use-config-store';

/** Match canvas recovery: query the original provider, then trusted shared nodes on transport failure. */
export async function queryWorkflowImageResult(baseUrl: string, apiKey: string, requestId: string) {
    if (!isTuziRequestRecoveryBaseUrl(baseUrl)) throw new Error('当前渠道不支持按请求 ID 恢复图片');
    const targets = [baseUrl];
    let fallbacksLoaded = false;
    let lastError: unknown;
    for (const target of targets) {
        try {
            const prepared = providerTransport.prepareRequest({ profileId: 'workflow-local', profileName: 'Workflow', providerType: 'custom', baseUrl: target, apiKey, authType: 'bearer' }, {
                path: '/images/generations/result', method: 'GET', baseUrlStrategy: 'ensure-v1', query: { request_id: requestId }, requestId,
            });
            const headers: Record<string, string> = {};
            new Headers(prepared.init.headers).forEach((value, name) => { headers[name] = value; });
            const response = await axios.get(withLocalProxy(prepared.url), { headers, timeout: 20_000 });
            const payload = response.data;
            if (payload && ['succeeded', 'failed', 'processing_or_not_found'].includes(payload.status)) return payload;
            lastError = new Error('结果查询返回无效响应，结果待确认');
        } catch (error) {
            const status = (error as { response?: { status?: number } })?.response?.status;
            // Authentication and other explicit query errors must not be hidden by fallback.
            if (status && status !== 404 && status !== 429 && status < 500) throw error;
            lastError = error;
        }
        if (!fallbacksLoaded) {
            fallbacksLoaded = true;
            const original = normalizeTuziApiEndpointUrl(baseUrl);
            targets.push(...[...new Set(await loadTuziApiEndpointBaseUrls())].filter(url => isTrustedTuziApiBaseUrl(url) && normalizeTuziApiEndpointUrl(url) !== original));
        }
    }
    throw lastError || new Error('暂时无法查询生成结果');
}
