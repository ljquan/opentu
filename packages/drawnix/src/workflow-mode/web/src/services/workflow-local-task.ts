import { takeWorkflowTaskTarget } from "./workflow-task-target";
import { taskStorageWriter } from '../../../../services/media-executor/task-storage-writer';
import { getDocumentBatchScope } from './document-batch-scope';
import { resolveModelRequestConfig, resolveModelScript, type AiConfig, type ModelCapability } from '@/stores/use-config-store';
import type { GenerationResult } from '../../../shared/generation-bridge';
import { queryWorkflowImageResult } from './api/image-recovery';
import { SubmissionPersistenceError } from '../../../../services/submission-persistence';

export class WorkflowTaskFailed extends Error {
    name = 'WorkflowTaskFailed';
}

export const TEXT_RECOVERY_UNAVAILABLE_MESSAGE = '无法自动找回：该渠道不支持查询此文本任务。已收到的内容已保留，重新生成会创建新请求。';

/** Recovery is unavailable; this says nothing about the provider's generation outcome. */
export class WorkflowRecoveryUnavailable extends Error {
    name = 'WorkflowRecoveryUnavailable';
    code = 'text_recovery_unavailable';
}

const active = new Set<string>();
const recovering = new Map<string, Promise<GenerationResult | null>>();

export async function workflowRouteIdentity(config: AiConfig, model: string, kind: ModelCapability) {
    const route = resolveModelRequestConfig(config, model, kind);
    const bytes = new TextEncoder().encode(JSON.stringify([route.baseUrl, route.apiKey, route.apiFormat, route.model, resolveModelScript(config, model, kind)]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Use the shared atomic claim; an interrupted synchronous call is never resubmitted. */
export async function runLocalWorkflowTask<T>(id: string, kind: ModelCapability, config: AiConfig, model: string, input: unknown, run: () => Promise<T>, result: (value: T) => GenerationResult | null): Promise<T> {
    const scopeId = getDocumentBatchScope();
    if (!scopeId) throw new Error('账号配置尚未就绪');
    const routeIdentity = await workflowRouteIdentity(config, model, kind);
    input = await durableWorkflowValue(input);
    const now = Date.now();
    await taskStorageWriter.prepareWorkflowTask({ id, type: kind === 'text' ? 'chat' : kind, status: 'pending', createdAt: now, updatedAt: now, params: {
        prompt: '', model, localInput: input, submissionRequestId: id, credentialId: config.channels.find(channel => model.startsWith(`${channel.id}::`))?.activeCredentialId,
        workflow: { scopeId, ...takeWorkflowTaskTarget(id), attemptId: id, routeIdentity },
    } });
    if (scopeId !== getDocumentBatchScope()) throw new Error('账号已切换');
    if (!await taskStorageWriter.claimWorkflowTask(id, scopeId)) throw new Error('任务已经提交，不会重复生成');
    active.add(id);
    try {
        const value = await run();
        const output = result(value);
        if (output?.urls) output.urls = await Promise.all(output.urls.map(async url => {
            if (!url.startsWith('blob:')) return url;
            const blob = await (await fetch(url)).blob();
            return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
        }));
        if (scopeId !== getDocumentBatchScope()) throw new Error('账号已切换');
        if (!await taskStorageWriter.mutateWorkflowTask(id, scopeId, task => {
            if (task.status !== 'processing') return false;
            if (output) { task.params.nativeResult = output; task.status = 'completed'; task.completedAt = Date.now(); }
            else { task.params.videoTask = value; }
            return true;
        })) throw new Error('结果保存失败，原尝试已保留');
        return value;
    } catch (error) {
        // Explicit HTTP/provider rejections are final submission failures. Persist them so a reload can show the real error
        // instead of treating the task as an unknown remote submission.
        if (error instanceof SubmissionPersistenceError) {
            await taskStorageWriter.mutateWorkflowTask(id, scopeId, task => {
                if (task.status !== 'processing') return false;
                if (kind === 'audio') task.params.localAudioTaskId = error.remoteId;
                if (kind === 'image' && error.protocol) task.params.localImageTask = { protocol: error.protocol, remoteId: error.remoteId };
                task.error = { code: error.code, message: error.message };
                return true;
            }).catch(() => false);
        } else if (isDefinitiveSubmissionFailure(error) || isWorkflowProviderFailure(error)) {
            const message = safeWorkflowErrorMessage(error, [resolveModelRequestConfig(config, model, kind).apiKey]);
            await taskStorageWriter.mutateWorkflowTask(id, scopeId, task => {
                if (task.status !== 'processing') return false;
                if (!isWorkflowProviderFailure(error) && (task.params.videoTask || task.params.localImageTask || task.params.localAudioTaskId || task.params.localTextResponseId)) return false;
                task.status = 'failed';
                task.error = { code: 'workflow_submission_failed', message };
                task.completedAt = Date.now();
                task.executionPhase = undefined;
                return true;
            });
        } else if (kind === 'text' && resolveModelRequestConfig(config, model, kind).apiFormat !== 'gemini') {
            // Keep the original transport error when the request ended before a
            // Responses id was received. Recovery must not reinterpret that
            // unknown outcome as an unsupported GET contract.
            const message = safeWorkflowErrorMessage(error, [resolveModelRequestConfig(config, model, kind).apiKey]);
            await taskStorageWriter.mutateWorkflowTask(id, scopeId, task => {
                if (task.status !== 'processing') return false;
                task.params.recoveryError = message;
                return true;
            }).catch(() => false);
        }
        throw error;
    } finally { active.delete(id); }
}

/** Recover only a persisted result or an explicit provider query contract. */
export async function readWorkflowTask(id: string) {
    const task = await taskStorageWriter.getTask(id);
    const owner = task?.params.workflow as { scopeId?: string } | undefined;
    return owner?.scopeId && owner.scopeId === getDocumentBatchScope() ? task : null;
}

/** Save received text before displaying it; never store credentials with the output. */
export async function persistWorkflowText(id: string, scopeId: string, progress: { text?: string; responseId?: string }) {
    if (scopeId !== getDocumentBatchScope()) throw new Error('账号已切换');
    if (!await taskStorageWriter.mutateWorkflowTask(id, scopeId, task => {
        if (task.status !== 'processing') return false;
        if (progress.responseId) {
            if (task.params.localTextResponseId && task.params.localTextResponseId !== progress.responseId) return false;
            task.params.localTextResponseId = progress.responseId;
        }
        if (progress.text !== undefined) task.params.textProgress = progress.text;
        return true;
    })) throw new Error('文本进度保存失败，原任务已保留');
}

export function isWorkflowProviderFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { workflowProviderFailure?: boolean; cause?: unknown };
    return value.workflowProviderFailure === true || Boolean(value.cause && value.cause !== error && isWorkflowProviderFailure(value.cause));
}

export async function recoverWorkflowTask(id: string, config: AiConfig): Promise<GenerationResult | null> {
    const key = `${getDocumentBatchScope()}:${id}`;
    const existing = recovering.get(key);
    if (existing) return existing;
    const work = recoverStoredWorkflowTask(id, config).finally(() => recovering.delete(key));
    recovering.set(key, work);
    return work;
}

async function recoverStoredWorkflowTask(id: string, config: AiConfig): Promise<GenerationResult | null> {
    const task = await readWorkflowTask(id);
    const owner = task?.params.workflow as { scopeId: string; routeIdentity: string } | undefined;
    if (!task || !owner || owner.scopeId !== getDocumentBatchScope()) return null;
    if (!('localInput' in task.params)) {
        const { recoverNativeTask } = await import('../../../host/native-task-recovery');
        return recoverNativeTask(id);
    }
    if (task.status === 'completed') return task.params.nativeResult as GenerationResult;
    if (task.status === 'failed') throw new WorkflowTaskFailed(task.error?.message || '生成请求失败');
    if (task.status !== 'processing' || active.has(id)) return null;
    if (typeof task.params.textRecoveryUnavailable === 'string') throw new WorkflowRecoveryUnavailable(task.params.textRecoveryUnavailable);
    const kind = task.type === 'chat' ? 'text' : task.type as ModelCapability;
    // A local waiting timeout never expires a durable provider/request id.
    const model = String(task.params.model);
    const credentialId = task.params.credentialId as string | undefined;
    const originalConfig = credentialId ? { ...config, channels: config.channels.map(channel => model.startsWith(`${channel.id}::`) ? { ...channel, activeCredentialId: credentialId } : channel) } : config;
    if (await workflowRouteIdentity(originalConfig, model, kind) !== owner.routeIdentity) throw new WorkflowRecoveryUnavailable('等待原配置：原渠道或 Key 已修改');
    const route = resolveModelRequestConfig(originalConfig, model, kind);
    const fail = async (error: unknown): Promise<never> => {
        const message = safeWorkflowErrorMessage(error, [route.apiKey]);
        if (getDocumentBatchScope() !== owner.scopeId) throw new Error('账号已切换');
        await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
            if (current.status !== 'processing') return false;
            current.status = 'failed'; current.completedAt = Date.now();
            current.error = { code: 'workflow_provider_failed', message };
            return true;
        });
        throw new WorkflowTaskFailed(message);
    };
    let result: GenerationResult;
    if (kind === 'text' && task.params.localTextResponseId) {
        const { queryTextResponse } = await import('./api/image');
        const state = await queryTextResponse(route, String(task.params.localTextResponseId));
        if (getDocumentBatchScope() !== owner.scopeId) return null;
        if (state.status === 'unavailable') {
            await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
                if (current.status !== 'processing') return false;
                current.params.textRecoveryUnavailable = TEXT_RECOVERY_UNAVAILABLE_MESSAGE;
                return true;
            });
            throw new WorkflowRecoveryUnavailable(TEXT_RECOVERY_UNAVAILABLE_MESSAGE);
        }
        if (state.content) await persistWorkflowText(id, owner.scopeId, { text: state.content });
        if (state.status === 'failed') return fail(new Error(state.error));
        if (state.status !== 'completed') return null;
        result = { resultKind: 'text', text: state.content };
    } else if (kind === 'image' && task.params.localImageTask) {
        const { queryLocalImageTask } = await import('./api/local-model');
        const output = await queryLocalImageTask({ ...originalConfig, model }, task.params.localImageTask as { protocol: string; remoteId: string }).catch(async error => {
            if ((error as { workflowProviderFailure?: boolean })?.workflowProviderFailure && getDocumentBatchScope() === owner.scopeId) {
                const message = safeWorkflowErrorMessage(error, [route.apiKey]);
                await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
                    if (current.status !== 'processing') return false;
                    current.status = 'failed'; current.completedAt = Date.now();
                    current.error = { code: 'workflow_provider_failed', message };
                    return true;
                });
                throw new WorkflowTaskFailed(message);
            }
            throw error;
        });
        if (!output) return null;
        result = output;
    } else if (kind === 'audio' && task.params.localAudioTaskId) {
        const { audioAPIService, extractAudioGenerationResult } = await import('../../../../services/audio-api-service');
        const { localAudioContext } = await import('./api/local-model');
        const state = await audioAPIService.queryAudioTask(String(task.params.localAudioTaskId), model, localAudioContext({ ...originalConfig, model }));
        if (['failed', 'error'].includes(state.status.toLowerCase())) return fail(new Error(state.failReason || '音频生成失败'));
        if (!['success', 'succeeded', 'completed', 'complete'].includes(state.status.toLowerCase())) return null;
        const output = extractAudioGenerationResult(state);
        result = output.resultKind === 'lyrics' ? { resultKind: 'lyrics', text: output.lyricsText || '' } : { resultKind: 'audio', urls: output.urls?.length ? output.urls : [output.url] };
    } else if (kind === 'video' && task.params.videoTask) {
        const { pollVideoGenerationTask } = await import('./api/video');
        const state = await pollVideoGenerationTask(originalConfig, task.params.videoTask as import('./api/video').VideoGenerationTask);
        if (state.status === 'failed') {
            const message = safeWorkflowErrorMessage(new Error(state.error), [route.apiKey]);
            if (getDocumentBatchScope() !== owner.scopeId) return null;
            await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
                if (current.status !== 'processing') return false;
                current.status = 'failed'; current.completedAt = Date.now();
                current.error = { code: 'workflow_provider_failed', message };
                return true;
            });
            throw new WorkflowTaskFailed(message);
        }
        if (state.status !== 'completed') return null;
        const output = state.result;
        result = { resultKind: 'video', urls: [output.url || await blobDataUrl(output.blob!)] };
    } else {
        const { isTuziRequestRecoveryBaseUrl } = await import('../../../../services/provider-routing/tuzi-api-endpoints');
        if (kind === 'text' && typeof task.params.recoveryError === 'string' && !task.params.localTextResponseId) return null;
        if (kind !== 'image' || route.apiFormat !== 'openai' || resolveModelScript(originalConfig, model, kind) || !isTuziRequestRecoveryBaseUrl(route.baseUrl)) {
            throw new WorkflowRecoveryUnavailable(kind === 'text' ? TEXT_RECOVERY_UNAVAILABLE_MESSAGE : '原任务没有可用查询标识，无法安全找回；不会自动重发');
        }
        const payload = await queryWorkflowImageResult(route.baseUrl, route.apiKey, String(task.params.submissionRequestId || id));
        if (getDocumentBatchScope() !== owner.scopeId) return null;
        if (payload?.request_id && payload.request_id !== id || payload?.requestId && payload.requestId !== id) throw new Error('查询结果与原任务不匹配');
        if (payload?.status === 'failed') {
            const message = safeWorkflowErrorMessage(new Error(payload.error?.message || payload.message || '供应商确认生成失败'), [route.apiKey]);
            await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
                if (current.status !== 'processing') return false;
                current.status = 'failed'; current.completedAt = Date.now();
                current.error = { code: 'workflow_provider_failed', message };
                return true;
            });
            throw new WorkflowTaskFailed(message);
        }
        if (payload?.status !== 'succeeded') return null;
        const urls = Array.isArray(payload.data) ? payload.data.map((item: { url?: string }) => item.url).filter((url: unknown): url is string => typeof url === 'string' && /^https?:\/\//.test(url)) : [];
        if (!urls.length) return null;
        result = { resultKind: 'image', urls };
    }
    if (getDocumentBatchScope() !== owner.scopeId) return null;
    if (!await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
        if (current.status !== 'processing') return false;
        current.status = 'completed'; current.completedAt = Date.now(); current.params.nativeResult = result;
        return true;
    })) return null;
    return result;
}

export function isDefinitiveSubmissionFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { response?: { status?: number }; httpStatus?: number; cause?: unknown; apiErrorBody?: string };
    // A lost response or server timeout is not proof that generation failed.
    const status = value.response?.status ?? value.httpStatus;
    return (typeof status === 'number' && status >= 400 && status < 500 && ![408, 425].includes(status))
        || Boolean(value.apiErrorBody?.includes('model_price_error'))
        || Boolean(value.cause && value.cause !== error && isDefinitiveSubmissionFailure(value.cause));
}

export function safeWorkflowErrorMessage(error: unknown, secrets: string[] = []): string {
    const value = error as { response?: { data?: { error?: { message?: string } | string; message?: string } } };
    const payload = value?.response?.data;
    let message = (typeof payload?.error === 'string' ? payload.error : payload?.error?.message) || payload?.message
        || (error instanceof Error ? error.message : '生成请求失败');
    for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[redacted]');
    return message.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]').replace(/\bsk-[a-zA-Z0-9_-]+/g, '[redacted]');
}

function blobDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}

export async function durableWorkflowValue<T>(value: T): Promise<T> {
    if (typeof value === 'string' && value.startsWith('blob:')) return await blobDataUrl(await (await fetch(value)).blob()) as T;
    if (Array.isArray(value)) return await Promise.all(value.map(durableWorkflowValue)) as T;
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await durableWorkflowValue(item)]));
        return Object.fromEntries(entries) as T;
    }
    return value;
}
