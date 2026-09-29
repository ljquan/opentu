import { modelOptionName, resolveModelChannel, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { GENERATE_REQUEST, GENERATE_RESPONSE, GENERATE_CANCEL, type GenerationRequest, type GenerationResult } from "../../../../shared/generation-bridge";
import { validateNativeReferences } from "../../../../shared/native-parameters";
import { nativeModel } from "@/integration/native-parameters";

export function nativeChannel(config: AiConfig, model: string, capability?: GenerationRequest["capability"]) {
    const channel = resolveModelChannel(config, model, capability);
    return channel?.opentuProfileId !== undefined && !resolveModelScript(config, model, capability) ? channel : undefined;
}

export function isNativeResult(result: GenerationResult | undefined, capability: GenerationRequest["capability"]): result is GenerationResult {
    if (!result) return false;
    const kind = result.resultKind || capability;
    if (kind === "lyrics") return capability === "audio" && typeof result.text === "string" && Boolean(result.text.trim());
    if (kind !== capability) return false;
    if (kind === "text") return typeof result.text === "string" && Boolean(result.text.trim());
    return Array.isArray(result.urls) && result.urls.length > 0 && result.urls.every((url) => typeof url === "string" && /^(https?:|data:|blob:)/i.test(url));
}

export function requestNative(config: AiConfig, model: string, params: Omit<GenerationRequest, "channelId" | "model">, signal?: AbortSignal): Promise<GenerationResult> {
    const channel = nativeChannel(config, model, params.capability);
    if (!channel || window.parent === window) return Promise.reject(new Error("请从 OpenTu 工作流入口打开。"));
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    try {
        validateNativeReferences(nativeModel(config, params.capability, model)?.referenceInputs || {}, params);
    } catch (error) {
        return Promise.reject(error);
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            window.removeEventListener("message", receive);
            window.removeEventListener("pagehide", abort);
            signal?.removeEventListener("abort", abort);
        };
        const abort = () => {
            cleanup();
            window.parent.postMessage({ type: GENERATE_CANCEL, requestId }, window.location.origin);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const receive = (event: MessageEvent) => {
            if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== GENERATE_RESPONSE || event.data.requestId !== requestId) return;
            cleanup();
            if (event.data.error) reject(new Error(String(event.data.error)));
            else {
                const result = event.data.payload as GenerationResult | undefined;
                if (!isNativeResult(result, params.capability)) reject(new Error("OpenTu 未返回有效生成结果。"));
                else resolve(result);
            }
        };
        window.addEventListener("message", receive);
        window.addEventListener("pagehide", abort);
        signal?.addEventListener("abort", abort, { once: true });
        window.parent.postMessage({ type: GENERATE_REQUEST, requestId, payload: { ...params, channelId: channel.id, model: modelOptionName(model) } }, window.location.origin);
    });
}
