import { readWorkflowTask, runLocalWorkflowTask, recoverWorkflowTask, WorkflowTaskFailed } from "../workflow-local-task";
import axios from "axios";
import { isMiniMaxH3Model, normalizeMiniMaxH3VideoResponse, resolveVideoSubmission, extractInlineVideoUrl } from "../../../../../services/video-binding-utils";
import { prepareMiniMaxH3Submission } from "../../../../../services/minimax-h3-video-workflow";
import localforage from "localforage";
import { submitKlingRequest } from "../../../../../services/model-adapters/kling-adapter";
import { submitSeedanceRequest } from "../../../../../services/model-adapters/seedance-adapter";
import { submitSeedance2Request } from "../../../../../services/model-adapters/seedance2-adapter";
import { submitHappyHorseVideo } from "../../../../../services/model-adapters/happyhorse-adapter";
import { nativeChannel, requestNative } from "./opentu";
import { prepareNativeTask, runNativeTask } from "../../../../host/native-task-recovery";
import { getNativeParameterValues, nativeModel } from "@/integration/native-parameters";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { validateNativeReferences } from "../../../../shared/native-parameters";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null; metadata?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal; taskId?: string };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "plugin" | "native"; protocol?: "minimax-h3-v2" | "kling-text2video" | "kling-image2video"; model: string; tuziCredential?: {channelId:string;credentialId:string} };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();
const pluginVideoResultStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_task_results" });

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        if (attempt === 119) throw new Error(apiText("videoTimeout", { provider: "" }));
        await delay(2500, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

export function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (options?.taskId && !nativeChannel(config, config.model || config.videoModel, "video")) {
        await runLocalWorkflowTask(options.taskId, "video", config, config.model || config.videoModel,
            { prompt, nativeParams: config.nativeParams, images: await Promise.all(references.map(image => imageToDataUrl(image))), videos: options.videos, audios: options.audios },
            () => createVideoGenerationTask(config, prompt, references, { ...options, taskId: undefined }), () => null);
        return { id: options.taskId, provider: "native", model: config.model || config.videoModel };
    }
    const task = await createVideoGenerationTaskInternal(config,prompt,references,options);
    const channel = config.channels.find(c => c.providerKind === 'tuzi-fixed' && task.model.startsWith(`${c.id}::`));
    if (channel?.activeCredentialId) return {...task,tuziCredential:{channelId:channel.id,credentialId:channel.activeCredentialId}};
    return task;
}

async function createVideoGenerationTaskInternal(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel, "video");
    const script = resolveModelScript(config, selectedModel, "video");
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    if (nativeChannel(config, selectedModel, "video")) {
        const params = getNativeParameterValues(config, selectedModel, "video");
        validateNativeReferences(nativeModel(config, "video", selectedModel)?.referenceInputs || {}, {
            images: references.map((item) => item.dataUrl), videos: options?.videos?.map((item) => item.url), audios: options?.audios?.map((item) => item.url),
        });
        const taskId = options?.taskId || nanoid();
        const request = {
            capability: "video" as const, prompt, images: await Promise.all(references.map((image) => imageToDataUrl(image))),
            videos: await Promise.all((options?.videos || []).map(async (item) => item.url.startsWith("blob:") || (!item.url && item.storageKey) ? readFileAsDataUrl(await referenceMediaToFile(item, "ref.mp4", "invalidReferenceVideo", options)) : item.url)),
            audios: await Promise.all((options?.audios || []).map(async (item) => item.url.startsWith("blob:") || (!item.url && item.storageKey) ? readFileAsDataUrl(await referenceMediaToFile(item, "ref.mp3", "invalidReferenceAudio", options)) : item.url)),
            params,
        };
        if (!options?.taskId) {
            const result = await requestNative(config, selectedModel, request, options?.signal);
            const media = { url: result.urls![0], mimeType: "video/mp4" };
            pluginVideoResults.set(taskId, media);
            await pluginVideoResultStore.setItem(taskId, media);
            return { id: taskId, provider: "plugin", model: selectedModel };
        }
        await prepareNativeTask(taskId, { ...request, channelId: nativeChannel(config, selectedModel, "video")!.id, model: modelOptionName(selectedModel) });
        void runNativeTask(taskId, options?.signal || new AbortController().signal).catch(() => undefined);
        return { id: taskId, provider: "native", model: selectedModel };
    }
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    const contract = nativeModel(config, "video", selectedModel);
    const params = contract ? getNativeParameterValues(config, selectedModel, "video") : undefined;
    if (contract && params) {
        validateNativeReferences(contract.referenceInputs || {}, { images: references.map(item => item.dataUrl || item.url || item.storageKey || ""), videos: options?.videos?.map(item => item.url || item.storageKey || ""), audios: options?.audios?.map(item => item.url || item.storageKey || "") });
        const context = { baseUrl: requestConfig.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") + "/v1", apiKey: requestConfig.apiKey, signal: options?.signal, fetcher: (url: RequestInfo | URL, init?: RequestInit) => fetch(withLocalProxy(String(url)), init) };
        if (contract.adapterId && contract.adapterId !== "gemini-video-adapter") {
            const images = await Promise.all(references.map(image => imageToDataUrl(image)));
            const mediaUrls = async (items: (ReferenceVideo | ReferenceAudio)[], audio = false) => Promise.all(items.map(async item => item.url.startsWith("blob:") || (!item.url && item.storageKey) ? readFileAsDataUrl(await referenceMediaToFile(item, audio ? "ref.mp3" : "ref.mp4", audio ? "invalidReferenceAudio" : "invalidReferenceVideo", options)) : item.url));
            const videos = await mediaUrls(options?.videos || []);
            const audios = await mediaUrls(options?.audios || [], true);
            const request = { model: requestConfig.model, prompt, referenceImages: images, size: params.size === undefined ? undefined : String(params.size), duration: params.duration === undefined ? undefined : Number(params.duration), params: { ...params, input_videos: videos, input_video: videos[0], input_audios: audios } };
            if (contract.adapterId === "kling-video-adapter") {
                if (params.klingAction2 === "text2video" && images.length) throw new Error("文生视频模式不接受参考图片");
                const result = await submitKlingRequest(context, request);
                return { id: result.taskId, provider: "openai", protocol: `kling-${result.action2}`, model: selectedModel };
            }
            let created;
            if (contract.adapterId === "seedance-video-adapter") created = (await submitSeedanceRequest(context, request)).submitResult;
            else if (contract.adapterId === "seedance-2-video-adapter") created = (await submitSeedance2Request(context, request)).submitted;
            else if (contract.adapterId === "happyhorse-video-adapter") created = await submitHappyHorseVideo(context, request);
            else throw new Error("当前视频适配器尚未接入工作流");
            if (created.status === "failed" || created.status === "error") throw videoTaskFailed(readApiErrorMessage(created.error) || apiText("videoGenerationFailed"));
            const id = ('task_id' in created && created.task_id) || created.id;
            if (!id) throw new Error(apiText("noVideoTaskId"));
            return { id, provider: "openai", model: selectedModel };
        }
    }
    if (contract && params && isMiniMaxH3Model(requestConfig.model)) {
        validateNativeReferences(contract.referenceInputs || {}, { images: references.map(item => item.dataUrl), videos: options?.videos?.map(item => item.url), audios: options?.audios?.map(item => item.url) });
        let prepared;
        try {
            prepared = await prepareMiniMaxH3Submission({
                prompt, duration: params.duration as string, size: String(params.size), ratio: params.ratio, params,
                referenceImages: await Promise.all(references.map((image) => imageToDataUrl(image))),
                referenceVideos: await Promise.all((options?.videos || []).map(async (item) => item.url.startsWith("blob:") || (!item.url && item.storageKey) ? readFileAsDataUrl(await referenceMediaToFile(item, "ref.mp4", "invalidReferenceVideo", options)) : item.url)),
            }, {
                provider: { profileId: "workflow-local", profileName: "Workflow", providerType: "custom", baseUrl: requestConfig.baseUrl, apiKey: requestConfig.apiKey, authType: "bearer" },
                signal: options?.signal, fetcher: (url, init) => fetch(withLocalProxy(String(url)), init),
            });
        } catch (error) {
            throw Object.assign(new Error(`提示词增强请求失败：${readAxiosError(error, "请求失败")}`), { cause: error });
        }
        let response;
        try {
            response = await axios.post(minimaxUrl(requestConfig, prepared.path), prepared.body, { headers: aiHeaders(requestConfig, "application/json"), signal: options?.signal });
        } catch (error) {
            throw Object.assign(new Error(readAxiosError(error, "MiniMax-H3 视频请求失败")), { cause: error });
        }
        const created = normalizeMiniMaxH3VideoResponse(response.data);
        if (created.status === "failed") throw videoTaskFailed(created.error?.message || apiText("videoGenerationFailed"));
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", protocol: "minimax-h3-v2", model: selectedModel };
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options, params);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "native") {
        const saved = await readWorkflowTask(task.id);
        if (!saved) throw new Error("任务不存在或账号已切换");
        const result = await recoverWorkflowTask(task.id, config).catch(error => {
            if (error instanceof WorkflowTaskFailed) throw videoTaskFailed(error.message);
            throw error;
        });
        if (!result) {
            if (saved.params.videoTask || saved.remoteId) return { status: "pending" };
        }
        if (!result?.urls?.[0]) throw new Error("结果待确认：保留原渠道配置后继续查询，不会自动重新生成");
        return { status: "completed", result: { url: result.urls[0], mimeType: "video/mp4" } };
    }
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id) || await pluginVideoResultStore.getItem<VideoGenerationResult>(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model, "video");
    if (task.tuziCredential) {
        const channel = config.channels.find(c => c.id === task.tuziCredential?.channelId && c.providerKind === 'tuzi-fixed');
        const credential = channel?.credentials?.find(c => c.id === task.tuziCredential?.credentialId);
        if (!credential?.apiKey) throw new Error('原任务使用的 Tuzi Key 已移除或修改，无法使用其他 Key 查询');
        requestConfig.baseUrl = 'https://api.tu-zi.com'; requestConfig.apiFormat = 'openai';requestConfig.apiKey = credential.apiKey;
    } else if (config.channels.some(c=>c.providerKind==='tuzi-fixed' && task.model.startsWith(`${c.id}::`))) {
        throw new Error('该 Tuzi 任务缺少原 Key 标识，不能使用当前 Key 猜测恢复');
    }
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.protocol === "kling-text2video" || task.protocol === "kling-image2video") {
        const action = task.protocol.slice("kling-".length);
        const { data: payload } = await axios.get(minimaxUrl(requestConfig, `/kling/v1/videos/${action}/${encodeURIComponent(task.id)}`), { headers: aiHeaders(requestConfig), signal: options?.signal });
        if (payload.code !== undefined && Number(payload.code) !== 0) return { status: "failed", error: payload.message || apiText("videoGenerationFailed") };
        const result = payload.data;
        if (result?.task_status === "failed") return { status: "failed", error: result.task_status_msg || apiText("videoGenerationFailed") };
        const url = result?.task_result?.videos?.[0]?.url;
        if (result?.task_status === "succeed" && url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        return { status: "pending" };
    }
    if (task.protocol === "minimax-h3-v2") {
        const response = await axios.get(minimaxUrl(requestConfig, `/v2/query/video_generation/${encodeURIComponent(task.id)}`), { headers: aiHeaders(requestConfig), signal: options?.signal });
        const video = normalizeMiniMaxH3VideoResponse(response.data, task.id);
        if (video.status === "failed") return { status: "failed", error: video.error?.message || apiText("videoGenerationFailed") };
        const url = videoResultUrl(video as VideoResponse);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        return { status: "pending" };
    }
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    if (result.url?.startsWith('blob:')) {
        result.blob = await (await fetch(result.url)).blob();
        delete result.url;
    }
    pluginVideoResults.set(id, result);
    await pluginVideoResultStore.setItem(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

function minimaxUrl(config: AiConfig, path: string) {
    return withLocalProxy(`${config.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "")}${path}`);
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions, params?: Record<string, string | number | boolean>): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const body = new FormData();
    const submission = params ? resolveVideoSubmission(modelOptionName(model), params.duration === undefined ? undefined : String(params.duration), undefined, params) : undefined;
    body.append("model", submission?.model || modelOptionName(model));
    body.append("prompt", prompt);
    if (!submission) body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    else if (submission.duration) body.append(submission.durationField, submission.duration);
    body.append("size", params?.size !== undefined ? String(params.size) : normalizeVideoSize(config.size, config.vquality) || "1280x720");
    if (!params) {
        body.append("resolution_name", normalizeVideoResolution(config.vquality));
        body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
        body.append("watermark", String(boolConfig(config.videoWatermark, false)));
        body.append("mode", mode);
    }
    if (params) {
        images.forEach(file => body.append("input_reference", file, "ref.png"));
    } else if (mode === "frames") {
        if (images[0]) body.append("first_frame", images[0], "first.png");
        if (images[1]) body.append("last_frame", images[1], "last.png");
    } else {
        images.forEach((file) => body.append("image[]", file, "ref.png"));
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = extractInlineVideoUrl(video) || videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (["completed", "complete", "succeeded", "succeed", "success", "done"].includes(String(video.status || "").toLowerCase())) {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (["failed", "failure", "error", "cancelled", "canceled"].includes(String(video.status || "").toLowerCase())) return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                resolution: normalizeVideoResolution(config.vquality),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url, payload.metadata?.video_url, payload.metadata?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
