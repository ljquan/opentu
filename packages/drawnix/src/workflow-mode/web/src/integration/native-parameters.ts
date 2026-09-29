import { effectiveNativeParameters, resolveNativeParameters } from "../../../shared/native-parameters";
import { decodeChannelModel, modelOptionName, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type Values = Record<string, string | number | boolean>;
type SavedParameters = Record<string, Values>;

export function nativeModel(config: AiConfig, capability: ModelCapability, model = config.model || config[`${capability}Model`]) {
    const decoded = decodeChannelModel(model);
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((entry) => entry.name === model && entry.capability === capability));
    if (channel?.opentuProfileId === undefined) return undefined;
    const entry = channel.models.find((item) => item.name === modelOptionName(model) && item.capability === capability);
    return entry?.script ? undefined : entry;
}

function readSaved(config: AiConfig): SavedParameters {
    if (!config.nativeParams) return {};
    try {
        const value: unknown = JSON.parse(config.nativeParams);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        for (const params of Object.values(value)) {
            if (!params || typeof params !== "object" || Array.isArray(params) || Object.values(params).some((item) => !["string", "number", "boolean"].includes(typeof item))) throw new Error();
        }
        return value as SavedParameters;
    } catch {
        throw new Error("模型参数记录无效，请恢复默认参数后重试。");
    }
}

function scopeKey(model: string, capability: ModelCapability) {
    return `${capability}::${model}`;
}

export function getNativeParameterDraft(config: AiConfig, model: string, capability: ModelCapability): Values {
    const entry = nativeModel(config, capability, model);
    const saved = readSaved(config)[scopeKey(model, capability)] || {};
    const parameters = effectiveNativeParameters(entry?.parameters || [], saved);
    const defaults = Object.fromEntries(parameters.filter((param) => param.defaultValue !== undefined && !param.disabledReason).map((param) => [param.id, param.defaultValue!]));
    return { ...defaults, ...saved };
}

export function getNativeParameterValues(config: AiConfig, model: string, capability: ModelCapability): Values {
    const entry = nativeModel(config, capability, model);
    if (!entry) throw new Error("当前原生模型或渠道已不可用，请重新选择模型。");
    if (entry.unavailableReason) throw new Error(entry.unavailableReason);
    if (!entry.parameters) throw new Error("模型参数尚未同步，请重新进入工作流。");
    return resolveNativeParameters(entry.parameters, readSaved(config)[scopeKey(model, capability)] || {});
}

export function setNativeParameterValue(config: AiConfig, model: string, capability: ModelCapability, id: string, value: string | number | boolean): string {
    const saved = readSaved(config);
    const key = scopeKey(model, capability);
    const parameter = nativeModel(config, capability, model)?.parameters?.find((param) => param.id === id);
    const typed = parameter?.valueType === "number" && typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value;
    return JSON.stringify({ ...saved, [key]: { ...saved[key], [id]: typed } });
}

export function resetNativeParameterValues(config: AiConfig, model: string, capability: ModelCapability): string {
    let saved: SavedParameters;
    try { saved = readSaved(config); } catch { saved = {}; }
    delete saved[scopeKey(model, capability)];
    return JSON.stringify(saved);
}

export function nativeParameterSummary(config: AiConfig, capability: ModelCapability): string | undefined {
    const model = config.model || config[`${capability}Model`];
    const entry = nativeModel(config, capability, model);
    if (!entry) return undefined;
    try {
        const values = getNativeParameterValues(config, model, capability);
        return effectiveNativeParameters(entry.parameters || [], values).filter((param) => !param.disabledReason && values[param.id] !== undefined && values[param.id] !== "")
            .map((param) => `${param.label} ${param.options?.find((option) => option.value === String(values[param.id]))?.label || values[param.id]}`).join(" · ") || "默认参数";
    } catch { return "参数待修正"; }
}

export function nativeImageCount(config: AiConfig): number | undefined {
    if (!nativeModel(config, "image")) return undefined;
    const values = getNativeParameterValues(config, config.model || config.imageModel, "image");
    return Number(values.n ?? values.count ?? 1);
}

export function singleImageConfig(config: AiConfig): AiConfig {
    let next = { ...config, count: "1" };
    for (const param of nativeModel(config, "image")?.parameters || []) {
        if (param.id === "n" || param.id === "count") next = { ...next, nativeParams: setNativeParameterValue(next, config.model || config.imageModel, "image", param.id, 1) };
    }
    return next;
}
