import { takeWorkflowTaskTarget } from "../web/src/services/workflow-task-target";
import { WorkflowTaskFailed, WorkflowRecoveryUnavailable, durableWorkflowValue, isDefinitiveSubmissionFailure, isWorkflowProviderFailure, safeWorkflowErrorMessage } from "../web/src/services/workflow-local-task";
import { taskStorageWriter, registerWorkflowTaskGuard, type SWTask } from '../../services/media-executor/task-storage-writer';
import { createTaskInvocationRouteSnapshot, assertTaskInvocationRouteAvailable, resolveTaskInvocationRouteModel } from '../../services/task-invocation-route';
import { getAdapterContextFromSettings, GPT_IMAGE_EDIT_REQUEST_SCHEMAS, type AdapterContext } from '../../services/model-adapters';
import { readNativeModels } from './native-models';
import { generateNative } from './native-generation';
import type { GenerationRequest, GenerationResult } from '../shared/generation-bridge';
import { getDocumentBatchScope, subscribeDocumentBatchScope } from '../web/src/services/document-batch-scope';
import { imageGenerationRecoveryService } from '../../services/image-generation-recovery-service';
import { TaskExecutionPhase, type Task } from '../../types/task.types';
import { SubmissionPersistenceError } from '../../services/submission-persistence';

const active = new Map<string, Promise<GenerationResult | null>>();

const contextIdentity = (context: AdapterContext) => JSON.stringify([context.baseUrl, context.apiKey, context.authType, context.extraHeaders, context.binding]);
const routeOptions = (request: GenerationRequest) => request.capability === 'image' && request.images.length ? { preferredRequestSchema: GPT_IMAGE_EDIT_REQUEST_SCHEMAS } : {};

async function routeIdentity(request: GenerationRequest) {
  const channel = (await readNativeModels()).channels.find(c => c.id === request.channelId);
  if (!channel) throw new Error('等待原渠道配置');
  const modelRef = { profileId: channel.opentuProfileId ?? null, modelId: request.model };
  const context = getAdapterContextFromSettings(request.capability, modelRef, routeOptions(request));
  const identity = contextIdentity(context);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return { modelRef, identity, fingerprint: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
}

export async function prepareNativeTask(id: string, request: GenerationRequest): Promise<void> {
  const scopeId = getDocumentBatchScope();
  if (!scopeId) throw new Error('账号配置尚未就绪');
  request = await durableWorkflowValue(request);
  const route = await routeIdentity(request);
  if (getDocumentBatchScope() !== scopeId) throw new Error('账号已切换');
  const now = Date.now();
  await taskStorageWriter.prepareWorkflowTask({
    id, type: request.capability === 'text' ? 'chat' : request.capability, status: 'pending',
    params: { prompt: request.prompt, model: request.model, modelRef: route.modelRef,
      nativeRequest: request, submissionRequestId: id, autoInsertToCanvas: false,
      workflow: { scopeId, ...takeWorkflowTaskTarget(id), attemptId: id, routeIdentity: route.fingerprint } },
    invocationRoute: createTaskInvocationRouteSnapshot(request.capability, route.modelRef, { metadataPolicy: 'capabilities-only' }),
    createdAt: now, updatedAt: now,
  });
}

export async function readNativeTask(id: string): Promise<SWTask | null> {
  const task = await taskStorageWriter.getTask(id);
  const owner = task?.params.workflow as { scopeId?: string } | undefined;
  return owner?.scopeId === getDocumentBatchScope() ? task : null;
}

export function runNativeTask(id: string, signal: AbortSignal): Promise<GenerationResult> {
  if (active.has(id)) return Promise.reject(new Error('任务已经提交，不会重复生成'));
  const work = executePreparedTask(id, signal).finally(() => active.delete(id));
  active.set(id, work);
  return work;
}

async function executePreparedTask(id: string, signal: AbortSignal): Promise<GenerationResult> {
  const task = await readNativeTask(id);
  if (!task) throw new Error('任务不存在或账号已切换');
  const request = task.params.nativeRequest as GenerationRequest;
  const scopeId = getDocumentBatchScope()!;
  signal.throwIfAborted();
  const owner = task.params.workflow as { routeIdentity: string };
  const submissionRoute = await routeIdentity(request);
  if (submissionRoute.fingerprint !== owner.routeIdentity || scopeId !== getDocumentBatchScope()) throw new WorkflowRecoveryUnavailable("等待原配置：渠道或账号已切换");
  if (!await taskStorageWriter.claimWorkflowTask(id, scopeId)) throw new Error('任务已经提交，不会重复生成');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const unsubscribe = subscribeDocumentBatchScope(() => { if (getDocumentBatchScope() !== scopeId) controller.abort(); });
  const work = generateNative(request, controller.signal, {
    requestId: id,
    assertAvailable: context => {
      controller.signal.throwIfAborted();
      const current = getAdapterContextFromSettings(request.capability, submissionRoute.modelRef, routeOptions(request));
      if (getDocumentBatchScope() !== scopeId || contextIdentity(current) !== submissionRoute.identity || (context && contextIdentity(context) !== submissionRoute.identity)) throw new WorkflowRecoveryUnavailable('账号或渠道已切换，未继续提交');
    },
    onSubmitted: async remoteId => {
      if (getDocumentBatchScope() !== scopeId) throw new Error('账号已切换');
      if (!await taskStorageWriter.mutateWorkflowTask(id, scopeId, current => {
        if (current.status !== 'processing') return false;
        current.remoteId = remoteId;
        current.executionPhase = 'polling';
        return true;
      })) throw new Error('远端任务标识保存失败');
    },
  }).then(async result => {
    result = await durableWorkflowValue(result);
    if (getDocumentBatchScope() !== scopeId) throw new Error('账号已切换');
    if (!await taskStorageWriter.mutateWorkflowTask(id, scopeId, current => {
      if (current.status !== 'processing') return false;
      current.status = 'completed';
      current.completedAt = Date.now();
      current.params.nativeResult = result;
      current.result = { url: result.urls?.[0] || '', urls: result.urls, chatResponse: result.text, format: request.capability, size: 0 };
      return true;
    })) throw new Error("结果持久化失败，原任务已保留");
    return result;
  });
  try { return await work; }
  catch (error) {
    if (error instanceof SubmissionPersistenceError) {
      // Salvage the accepted id if storage has recovered. Never mark this as a rejected POST.
      await taskStorageWriter.mutateWorkflowTask(id, scopeId, current => {
        if (current.status !== 'processing') return false;
        current.remoteId = error.remoteId;
        current.error = { code: error.code, message: error.message };
        return true;
      }).catch(() => false);
    } else if (isDefinitiveSubmissionFailure(error) || isWorkflowProviderFailure(error)) {
      const message = safeWorkflowErrorMessage(error);
      await taskStorageWriter.mutateWorkflowTask(id, scopeId, current => {
        if (current.status !== 'processing' || (current.remoteId && !isWorkflowProviderFailure(error))) return false;
        current.status = 'failed';
        current.error = { code: 'workflow_submission_failed', message };
        current.completedAt = Date.now();
        current.executionPhase = undefined;
        return true;
      });
    }
    throw error;
  } finally { unsubscribe(); signal.removeEventListener('abort', abort); }
}

/** Recovery is query-only. A missing query contract never grants a new POST. */
export function recoverNativeTask(id: string): Promise<GenerationResult | null> {
  if (active.has(id)) return active.get(id)!;
  const work = recoverPreparedTask(id).finally(() => active.delete(id));
  active.set(id, work);
  return work;
}

async function recoverPreparedTask(id: string): Promise<GenerationResult | null> {
  const task = await readNativeTask(id);
  if (!task) return null;
  if (task.status === 'completed') return task.params.nativeResult as GenerationResult;
  if (task.status === 'failed') throw new WorkflowTaskFailed(task.error?.message || '生成请求失败');
  if (task.status !== 'processing') return null;
  const request = task.params.nativeRequest as GenerationRequest;
  const owner = task.params.workflow as { scopeId: string; routeIdentity: string };
  if ((await routeIdentity(request)).fingerprint !== owner.routeIdentity) throw new WorkflowRecoveryUnavailable('等待原配置：原渠道或 Key 已修改');
  assertTaskInvocationRouteAvailable(request.capability, task as unknown as Task);
  if (getDocumentBatchScope() !== owner.scopeId) return null;
  const assertAvailable = async () => {
    if (getDocumentBatchScope() !== owner.scopeId || (await routeIdentity(request)).fingerprint !== owner.routeIdentity) throw new WorkflowRecoveryUnavailable('等待原配置：账号或渠道已切换');
  };
  const unbind = registerWorkflowTaskGuard(id, () => getDocumentBatchScope() === owner.scopeId);
  const work = (async () => {
    let result: GenerationResult;
    if (task.remoteId) {
      const { taskQueueService } = await import('../../services/task-queue-service');
      await taskQueueService.restoreTasks([task as unknown as Task]);
      const { generationAPIService } = await import('../../services/generation-api-service');
      const model = resolveTaskInvocationRouteModel(task as unknown as Task);
      const output = task.type === 'image'
        ? await generationAPIService.resumeAsyncImageGeneration(id, task.remoteId, model, id, assertAvailable)
        : task.type === 'video'
        ? await generationAPIService.resumeVideoGeneration(id, task.remoteId, model, assertAvailable)
        : task.type === 'audio'
        ? await generationAPIService.resumeAudioGeneration(id, task.remoteId, model, assertAvailable)
        : null;
      if (!output) return null;
      result = output.resultKind === 'lyrics'
        ? { text: output.lyricsText || '', resultKind: 'lyrics' }
        : { urls: output.urls?.length ? output.urls : [output.url], resultKind: request.capability as 'image' | 'video' | 'audio' };
    } else if (task.type === 'image') {
      // The persisted startedAt belongs to the original browser session. On a
      // reload, give the query-only recovery its own polling window so a task
      // that is still generating is not discarded before the provider is
      // queried. The original request id and route remain unchanged.
      const restored = { ...task, startedAt: Date.now(), executionPhase: TaskExecutionPhase.POLLING } as unknown as Task;
      let unsubscribe = () => { /* Bound before recovery starts. */ };
      const output = await new Promise<GenerationResult | null>((resolve, reject) => {
        const stop = () => { imageGenerationRecoveryService.stop(id); resolve(null); };
        unsubscribe = subscribeDocumentBatchScope(() => { if (getDocumentBatchScope() !== owner.scopeId) stop(); });
        const started = imageGenerationRecoveryService.start(restored, {
          assertAvailable,
          onSucceeded: output => { resolve({ urls: output.urls, resultKind: 'image' }); },
          onFailed: async error => {
            if (error.kind === 'timeout') { resolve(null); return; }
            if (error.kind !== 'upstream') { reject(new Error(error.message)); return; }
            if (getDocumentBatchScope() !== owner.scopeId) { resolve(null); return; }
            const message = safeWorkflowErrorMessage(new Error(error.message));
            await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
              if (current.status !== 'processing') return false;
              current.status = 'failed'; current.completedAt = Date.now();
              current.error = { code: 'workflow_provider_failed', message };
              return true;
            });
            reject(new WorkflowTaskFailed(message));
          },
        });
        if (started.status !== 'started') reject(new WorkflowRecoveryUnavailable('原渠道不支持查询此图片任务；不会自动重发'));
      }).finally(() => { unsubscribe(); });
      if (!output) return null;
      result = output;
    } else {
      throw new WorkflowRecoveryUnavailable('原任务没有远端任务标识，无法安全查询；不会自动重发');
    }
    if (getDocumentBatchScope() !== owner.scopeId) return null;
    if (!await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
      if (current.status !== 'processing') return false;
      current.status = 'completed'; current.completedAt = Date.now();
      current.params.nativeResult = result;
      current.result = { url: result.urls?.[0] || '', urls: result.urls, format: request.capability, size: 0 };
      return true;
    })) return null;
    return result;
  })();
  try { return await work; }
  catch (error) {
    if (isWorkflowProviderFailure(error) && getDocumentBatchScope() === owner.scopeId) {
      const message = safeWorkflowErrorMessage(error);
      await taskStorageWriter.mutateWorkflowTask(id, owner.scopeId, current => {
        if (current.status !== 'processing') return false;
        current.status = 'failed'; current.completedAt = Date.now();
        current.error = { code: 'workflow_provider_failed', message };
        return true;
      });
      throw new WorkflowTaskFailed(message);
    }
    // A polling window ending is not an upstream rejection. Keep the durable
    // image task processing so the next scan can query the same remote id.
    if (error instanceof Error && !(error instanceof WorkflowTaskFailed) && ['TIMEOUT', '图片生成超时', '视频生成超时，请稍后重试', 'Suno 生成超时，请稍后重试'].includes(error.message)) return null;
    throw error;
  }
  finally { unbind(); }
}
