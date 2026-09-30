import { executeNative } from "../../../../host/native-runtime";
import { modelOptionName, resolveModelChannel, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import type { GenerationRequest, GenerationResult } from "../../../../shared/generation-bridge";
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

export async function requestNative(config: AiConfig, model: string, params: Omit<GenerationRequest, "channelId" | "model">, signal?: AbortSignal, taskId?: string): Promise<GenerationResult> {
    const channel = nativeChannel(config, model, params.capability);
    if (!channel) throw new Error("当前模型没有绑定 OpenTu 渠道。");
    signal?.throwIfAborted();
    validateNativeReferences(nativeModel(config, params.capability, model)?.referenceInputs || {}, params);
    const result = await executeNative({ ...params, channelId: channel.id, model: modelOptionName(model) }, signal, taskId);
    if (!isNativeResult(result, params.capability)) throw new Error("OpenTu 未返回有效生成结果。");
    return result;
}
