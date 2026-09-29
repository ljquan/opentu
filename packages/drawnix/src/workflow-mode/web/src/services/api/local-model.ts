import { asyncImageAPIService } from "../../../../../services/async-image-api-service";
import { getMJImageUrls } from "../../../../../services/model-adapters/mj-image-adapter";
import { getModelAdapter, localModelContract } from "../../../../host/local-model-contract";
import { generateImageDirect } from "../../../../../utils/gemini-api/services";
import { resolveImageResolutionTier } from "../../../../../services/model-adapters/image-size-quality-resolver";
import { audioAPIService, extractAudioGenerationResult } from "../../../../../services/audio-api-service";
import { nativeModel, getNativeParameterValues } from "@/integration/native-parameters";
import { resolveModelRequestConfig, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { validateNativeReferences } from "../../../../shared/native-parameters";
import type { ModelCapability } from "@/stores/use-config-store";
import { taskStorageWriter } from "../../../../../services/media-executor/task-storage-writer";
import { getDocumentBatchScope } from "../document-batch-scope";
import { notifyTaskSubmitted, SubmissionPersistenceError } from "../../../../../services/submission-persistence";

export function localModelContext(config: AiConfig, capability: ModelCapability, signal?: AbortSignal) {
    const model = config.model || config[`${capability}Model`];
    const route = resolveModelRequestConfig(config, model, capability);
    if (!route.baseUrl.trim() || !route.apiKey.trim()) throw new Error("请先配置当前渠道的 URL 和 API Key");
    return { baseUrl: route.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") + "/v1", apiKey: route.apiKey, signal, fetcher: (url: RequestInfo | URL, init?: RequestInit) => fetch(withLocalProxy(String(url)), init) };
}

export async function requestLocalModelImage(config: AiConfig, prompt: string, images: string[], options?: { signal?: AbortSignal; requestId?: string }) {
    const model = config.model || config.imageModel;
    const contract = nativeModel(config, "image", model);
    const params = getNativeParameterValues(config, model, "image");
    validateNativeReferences(contract?.referenceInputs || {}, { images });
    if (params.input_fidelity !== undefined && !images.length) throw new Error("输入保真度需要参考图片");
    if (params.output_compression !== undefined && !["jpeg", "webp"].includes(String(params.output_format))) throw new Error("压缩质量仅适用于 JPEG 或 WebP 输出");
    if (params.background === "transparent" && params.output_format === "jpeg") throw new Error("透明背景需要 PNG 或 WebP 输出");
    const route = resolveModelRequestConfig(config, model, "image");
    const operationContract = localModelContract(route.model, "image", route.apiFormat, route.baseUrl, images.length ? "edit" : "generation");
    if (operationContract?.unavailableReason) throw new Error(operationContract.unavailableReason);
    const context = {
        ...localModelContext(config, "image", options?.signal),
        binding: operationContract?.binding,
        operation: "image" as const,
        requestId: options?.requestId,
    };
    if (contract?.requestSchema === "openai.async.image.form") {
        const task = await asyncImageAPIService.generateWithPolling(
            { model: route.model, prompt, size: params.size === undefined ? undefined : String(params.size), referenceImages: images },
            {
                signal: context.signal,
                requestId: context.requestId,
                requestContext: { providerContext: { profileId: "workflow-local", profileName: "Workflow", providerType: "custom", baseUrl: context.baseUrl, apiKey: context.apiKey, authType: "bearer" }, fetcher: context.fetcher },
                onSubmitted: (id) => notifyTaskSubmitted(id, (remoteId) => saveLocalMediaTask(options?.requestId, "async-image", remoteId)),
            },
        );
        return [asyncImageAPIService.extractUrlAndFormat(task).url];
    }
    if (contract?.adapterId === "gemini-image-adapter") {
        const result = await generateImageDirect(
            prompt,
            {
                size: params.size === undefined ? undefined : String(params.size),
                quality: resolveImageResolutionTier(params),
                image: images.length ? images : undefined,
                count: Number(params.n || 1),
                response_format: params.response_format as "url" | "b64_json" | undefined,
                signal: context.signal,
                fetcher: context.fetcher,
                requestId: context.requestId,
            },
            route.model,
            undefined,
            { baseUrl: context.baseUrl, apiKey: context.apiKey, modelName: route.model, binding: context.binding, protocol: route.apiFormat === "gemini" ? "google.generateContent" : "openai.images.generations" },
        );
        return (result.data || []).map((item: { url?: string; b64_json?: string }) => item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : "")).filter(Boolean) as string[];
    }
    const adapter = getModelAdapter(contract?.adapterId || "");
    if (adapter?.kind !== "image") throw new Error("OpenTu 暂无此图片模型的适配器");
    const result = await adapter.generateImage(context, {
        prompt,
        model: route.model,
        size: params.size === undefined ? undefined : String(params.size),
        referenceImages: images,
        generationMode: images.length ? "image_to_image" : "text_to_image",
        background: params.background as "transparent" | "opaque" | "auto" | undefined,
        outputFormat: params.output_format as "png" | "jpeg" | "webp" | undefined,
        outputCompression: params.output_compression as number | undefined,
        inputFidelity: params.input_fidelity as "high" | "low" | undefined,
        params: { ...params, onSubmitted: (id: string) => notifyTaskSubmitted(id, (remoteId) => saveLocalMediaTask(options?.requestId, contract?.adapterId || "", remoteId)) },
    });
    return result.urls?.length ? result.urls : [result.url];
}

export function localAudioContext(config: AiConfig, signal?: AbortSignal) {
    const context = localModelContext(config, "audio", signal);
    const route = resolveModelRequestConfig(config, config.model || config.audioModel, "audio");
    const binding = localModelContract(route.model, "audio", route.apiFormat, route.baseUrl)?.binding || null;
    return { providerContext: { profileId: "workflow-local", profileName: "Workflow", providerType: "custom", baseUrl: context.baseUrl, apiKey: context.apiKey, authType: "bearer" as const }, binding, signal, fetcher: context.fetcher };
}

export async function requestLocalModelAudio(config: AiConfig, prompt: string, options?: { signal?: AbortSignal; requestId?: string }) {
    const model = config.model || config.audioModel;
    const params = getNativeParameterValues(config, model, "audio");
    const route = resolveModelRequestConfig(config, model, "audio");
    const scopeId = getDocumentBatchScope();
    const task = await audioAPIService.generateAudioWithPolling(
        {
            model: route.model,
            prompt,
            params,
            title: params.title as string,
            tags: params.tags as string,
            mv: params.mv as string,
            sunoAction: params.sunoAction as string,
            instrumental: params.instrumental === undefined ? undefined : String(params.instrumental) === "true",
            continueClipId: params.continueClipId as string,
            continueTaskId: params.continueTaskId as string,
            continueAt: params.continueAt as number,
            infillStartS: params.infillStartS as number,
            infillEndS: params.infillEndS as number,
        },
        {
            requestContext: localAudioContext(config, options?.signal),
            onSubmitted: async (id) => {
                const requestId = options?.requestId;
                if (!requestId || !scopeId) return;
                await notifyTaskSubmitted(id, async (remoteId) => {
                    if (
                        !(await taskStorageWriter.mutateWorkflowTask(requestId, scopeId, (current) => {
                            if (current.status !== "processing") return false;
                            current.params.localAudioTaskId = remoteId;
                            return true;
                        }))
                    )
                        throw new Error("音频任务 ID 保存失败，结果待确认");
                });
            },
        },
    );
    const result = extractAudioGenerationResult(task);
    return result.resultKind === "lyrics" ? { kind: "lyrics" as const, text: result.lyricsText || "" } : { kind: "audio" as const, clips: result.urls?.length ? result.urls : [result.url] };
}

async function saveLocalMediaTask(taskId: string | undefined, protocol: string, remoteId: string) {
    const scopeId = getDocumentBatchScope();
    if (!taskId || !scopeId) return;
    try {
        if (
            !(await taskStorageWriter.mutateWorkflowTask(taskId, scopeId, (current) => {
                if (current.status !== "processing") return false;
                current.params.localImageTask = { protocol, remoteId };
                return true;
            }))
        )
            throw new Error("图片任务 ID 保存失败，结果待确认");
    } catch {
        throw Object.assign(new SubmissionPersistenceError(remoteId), { protocol });
    }
}

export async function queryLocalImageTask(config: AiConfig, task: { protocol: string; remoteId: string }) {
    const context = localModelContext(config, "image");
    const root = context.baseUrl.replace(/\/v1$/i, "");
    let path: string;
    if (task.protocol === "async-image") path = `${context.baseUrl}/videos/${encodeURIComponent(task.remoteId)}`;
    else if (task.protocol === "mj-image-adapter") path = `${root}/mj/task/${encodeURIComponent(task.remoteId)}/fetch`;
    else if (task.protocol === "flux-image-adapter") path = `${root}/flux/v1/get_result?id=${encodeURIComponent(task.remoteId)}`;
    else return null;
    const response = await context.fetcher(path, { headers: { Authorization: `Bearer ${context.apiKey}` } });
    if (!response.ok) throw new Error(`图片任务查询失败：HTTP ${response.status}`);
    const result = await response.json();
    const status = String(result.status || "").toLowerCase();
    if (["failed", "fail", "failure", "error"].includes(status)) {
        const error = new Error(result.failReason || result.error?.message || "图片生成失败") as Error & { workflowProviderFailure?: boolean };
        error.workflowProviderFailure = true;
        throw error;
    }
    if (!["completed", "success", "succeed", "done", "ready"].includes(status)) return null;
    const urls: string[] = task.protocol === "mj-image-adapter" ? getMJImageUrls(result) : [result.video_url || result.url || result.result?.sample];
    if (!urls.length || urls.some((url) => typeof url !== "string" || !/^(https?:|data:)/.test(url))) throw new Error("图片任务成功但未返回有效结果");
    return { resultKind: "image" as const, urls };
}
