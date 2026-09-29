import { nanoid } from 'nanoid';
import type { BatchRun, BatchSnapshot, BatchWorkItem, DocumentBatch } from '@/types/document-batch';
import { claimBatchTicket, getDocumentBatch, listBatchItems, planBatch, projectBatchItem, setBatchActive } from './document-batch-repository';
import { loadBatchReference, blobDataUrl } from './document-batch-export';
import { taskQueueService } from '../../../../services/task-queue-service';
import { documentBatchTaskBridge as bridge } from '../../../../services/document-batch-task-bridge';
import type { GenerationParams, Task } from '../../../../types/shared/core.types';
import { readNativeModels } from '../../../host/native-models';
import { resolveNativeParameters, validateNativeReferences } from '../../../shared/native-parameters';
import { getDocumentBatchScope } from './document-batch-scope';
import { assertDocumentBatchSubmissionEnabled, documentBatchSubmissionEnabled } from './document-batch-feature';
import { resolveBatchImageModel } from './document-batch-models';

export async function prepareBatchGeneration(batch: DocumentBatch, rowIds: string[], commandId = nanoid()): Promise<BatchRun> {
    assertDocumentBatchSubmissionEnabled();
    const scope = getDocumentBatchScope();
    if (!scope || scope !== batch.scopeId) throw new Error('批次作用域已变化，请重新加载');
    const rows = batch.rows.filter(r => rowIds.includes(r.id));
    if (!rows.length) throw new Error('请选择任务行');
    const catalog = await readNativeModels();
    const snapshots: Array<{ snapshot: BatchSnapshot; count: number }> = [];
    for (const row of rows) {
        if (row.status !== 'ready' || !row.prompt.trim() || row.diagnostics.length) throw new Error(`任务「${row.title}」仍有待确认问题`);
        const settings = { ...batch.defaults, ...row.overrides };
        const model = String(settings.model || '');
        const resolved = resolveBatchImageModel(catalog.channels, model);
        if (!resolved) throw new Error(`任务「${row.title}」模型渠道不支持批量生成或已失效，请重新选择 OpenTu 图片模型`);
        const { channel, entry } = resolved;
        if (row.references.length > 16) throw new Error('每行最多 16 张参考图');
        validateNativeReferences(entry.referenceInputs || {}, { images: row.references.map(r => r.id) });
        let saved: Record<string, Record<string, string | number | boolean>>;
        try { saved = JSON.parse(settings.nativeParams || '{}'); if (!saved || Array.isArray(saved) || typeof saved !== 'object') throw new Error(); }
        catch { throw new Error(`任务「${row.title}」参数记录无效`); }
        const supplied = { ...(saved[`image::${model}`] || {}) };
        // Quantity is split into durable work items, never multiplied inside each request.
        for (const key of ['n', 'count']) if (entry.parameters?.some(p => p.id === key)) supplied[key] = 1;
        const params = resolveNativeParameters(entry.parameters || [], supplied);
        const references = [];
        for (const ref of row.references) {
            if (!ref.blob) throw new Error('请先明确加载并核对外部参考图片');
            references.push(await loadBatchReference(ref));
        }
        const profileId = channel.opentuProfileId ?? null;
        snapshots.push({ snapshot: { rowId: row.id, title: row.title, prompt: row.prompt, source: row.source, references, model, modelId: entry.name, profileId, params, routeFingerprint: `${profileId || 'default'}:${entry.name}` }, count: Number(settings.count ?? 1) });
    }
    if (getDocumentBatchScope() !== scope) throw new Error('账号已切换，未创建计划');
    return planBatch(batch, snapshots, commandId);
}

export async function batchImageParams(item: BatchWorkItem): Promise<GenerationParams> {
    const params = item.snapshot.params;
    const referenceImages = await Promise.all(item.snapshot.references.map(async r => blobDataUrl((await loadBatchReference(r)).blob!)));
    return {
        prompt: item.snapshot.prompt, model: item.snapshot.modelId,
        modelRef: { profileId: item.snapshot.profileId, modelId: item.snapshot.modelId },
        referenceImages, autoInsertToCanvas: false, count: 1,
        generationMode: referenceImages.length ? 'image_to_image' : 'text_to_image',
        size: params.size === undefined ? undefined : String(params.size),
        resolution: params.resolution, quality: params.quality, params,
        background: params.background as GenerationParams['background'],
        outputFormat: params.output_format as GenerationParams['outputFormat'],
        outputCompression: params.output_compression as number | undefined,
        inputFidelity: params.input_fidelity as GenerationParams['inputFidelity'],
    };
}
const identity = (item: BatchWorkItem) => ({ scopeId: item.scopeId, batchId: item.batchId, workItemId: item.id, attemptId: item.attemptId, epoch: item.epoch });
export function batchTaskProjection(task: Task): Pick<BatchWorkItem, 'state' | 'results' | 'error'> {
    const urls = task.result?.urls?.length ? task.result.urls : task.result?.url ? [task.result.url] : [];
    const succeeded = task.status === 'completed' && urls.length > 0;
    // Transport failures and timeouts do not prove that a provider rejected a POST.
    const failed = task.status === 'failed' && !task.params.imageSubmissionAttempted;
    const blocked = Boolean(task.params.recoveryError);
    return { state: succeeded ? 'succeeded' : failed ? 'failed' : blocked ? 'uncertain' : task.status === 'processing' ? 'polling' : 'uncertain', results: urls.map((url, i) => ({ id: `${task.params.documentBatch!.attemptId}-${i}`, url })), error: task.error?.message || String(task.params.recoveryError || '') || undefined };
}

/** Read-only reconciliation never consumes a new submission ticket. */
export async function reconcileBatchItems(batchId: string, scopeId: string): Promise<void> {
    const guard = () => getDocumentBatchScope() === scopeId;
    if (!guard()) return;
    for (const item of await listBatchItems(batchId, scopeId)) {
        if (!guard() || !item.ticket || ['succeeded', 'failed', 'cancelled'].includes(item.state)) continue;
        const task = await bridge.getPersisted(item.taskId, scopeId);
        if (!guard()) return;
        if (!task) { await projectBatchItem(item, { state: 'uncertain', error: '提交窗口中断，无法确认是否受理；不会自动重发' }); continue; }
        bridge.bindScope(item.taskId, identity(item), guard);
        await projectBatchItem(item, batchTaskProjection(task));
        if (task.status === 'processing' && !taskQueueService.isTaskExecutionActive(item.taskId)) await bridge.recover(item.taskId, scopeId);
    }
}

export async function startBatchSubmission(batchId: string, scopeId: string, owner = nanoid(), onUpdate?: (item: BatchWorkItem) => void, onError?: (error: unknown) => void): Promise<() => void> {
    assertDocumentBatchSubmissionEnabled();
    const scopeGuard = () => getDocumentBatchScope() === scopeId;
    if (!scopeGuard()) throw new Error('账号已切换');
    if (!await getDocumentBatch(batchId, scopeId)) throw new Error('批次不存在或已删除');
    await reconcileBatchItems(batchId, scopeId);
    if (!scopeGuard()) throw new Error('账号已切换');
    await setBatchActive(batchId, scopeId, true, owner);
    let stopped = false, refreshing = false;
    const report = (error: unknown) => { stopped = true; void setBatchActive(batchId, scopeId, false, owner).catch(() => undefined); onError?.(error); };
    const refresh = async () => {
        if (stopped || refreshing || !scopeGuard()) return;
        refreshing = true;
        try {
            await reconcileBatchItems(batchId, scopeId);
            for (const item of await listBatchItems(batchId, scopeId)) {
                onUpdate?.(item);
                if (stopped || !scopeGuard()) break;
                if (item.state !== 'queued') continue;
                try {
                    const params = await batchImageParams(item);
                    if (stopped || !scopeGuard()) break;
                    await bridge.prepare(item.taskId, params, identity(item));
                    const external = taskQueueService.getAllTasks().filter(t => !t.params.documentBatch && t.status === 'processing' && t.params.modelRef?.profileId === item.snapshot.profileId).length;
                    const started = await bridge.start({ taskId: item.taskId, metadata: identity(item), scopeGuard, claimTicket: () => stopped || !documentBatchSubmissionEnabled() ? false : claimBatchTicket(item, owner, scopeGuard, external) });
                    if (started === 'rejected') {
                        const current = (await listBatchItems(batchId, scopeId)).find(i => i.id === item.id);
                        if (current?.ticket) await projectBatchItem(item, { state: 'uncertain', error: '提交票据已消费但未能启动任务；不会自动重发' });
                    }
                } catch (error) {
                    const current = (await listBatchItems(batchId, scopeId)).find(i => i.id === item.id);
                    await projectBatchItem(item, { state: current?.ticket ? 'uncertain' : 'failed', error: error instanceof Error ? error.message : '任务准备失败' });
                }
            }
        } catch (error) { report(error); }
        finally { refreshing = false; }
    };
    const subscription = taskQueueService.observeTaskUpdates().subscribe(event => {
        const meta = event.task.params.documentBatch;
        if (!scopeGuard() || meta?.batchId !== batchId || meta.scopeId !== scopeId || !meta.dispatchTicket) return;
        void projectBatchItem({ id: meta.workItemId, batchId, scopeId, attemptId: meta.attemptId, epoch: meta.epoch } as BatchWorkItem, batchTaskProjection(event.task)).catch(report);
    });
    const timer = window.setInterval(() => void refresh(), 1000);
    void refresh();
    return () => { stopped = true; window.clearInterval(timer); subscription.unsubscribe(); void setBatchActive(batchId, scopeId, false, owner).catch(onError || (() => undefined)); };
}
export { listBatchItems, setBatchActive };
