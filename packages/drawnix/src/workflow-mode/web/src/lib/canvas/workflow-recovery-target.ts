import type { CanvasNodeData, CanvasNodeImage, CanvasNodeStatus, CanvasNodeText } from '@/types/canvas';

export const WORKFLOW_MEDIA_RECOVERY_MESSAGE = '网页已刷新，正在找回生成结果…';
export const WORKFLOW_RECOVERY_MESSAGE = '结果待确认：正在查询原任务结果';
export const WORKFLOW_RECOVERY_TIMEOUT_MS = 5 * 60 * 1000;
export const WORKFLOW_RECOVERY_TIMEOUT_MESSAGE = '已等待 5 分钟，仍未取回生成结果，请到日志中查找。页面会继续尝试找回。';

export function isWorkflowMediaKind(kind: 'image' | 'text' | 'video' | 'audio'): kind is 'image' | 'video' {
    return kind === 'image' || kind === 'video';
}

export function workflowRecoveryMessage(kind: 'image' | 'text' | 'video' | 'audio', startedAt: number | undefined, now = Date.now()): string {
    if (!isWorkflowMediaKind(kind) || startedAt === undefined) return WORKFLOW_RECOVERY_MESSAGE;
    return now - startedAt >= WORKFLOW_RECOVERY_TIMEOUT_MS ? WORKFLOW_RECOVERY_TIMEOUT_MESSAGE : WORKFLOW_MEDIA_RECOVERY_MESSAGE;
}

/** Update a waiting placeholder even while its query Promise is still in flight. */
export function updateWorkflowMediaRecoveryNotice(node: CanvasNodeData, slotId: string, attemptId: string, startedAt: number, now = Date.now()): CanvasNodeData {
    const attempt = node.metadata?.workflowTasks?.[slotId];
    if (!attempt || attempt.id !== attemptId || !isWorkflowMediaKind(attempt.kind)) return node;
    const output = attempt.kind === 'image' && node.metadata?.images?.length
        ? node.metadata.images.find(item => item.id === slotId) : node.metadata;
    if (output?.status !== 'loading') return node;
    const message = workflowRecoveryMessage(attempt.kind, startedAt, now);
    if (output.errorDetails === message) return node;
    return updateWorkflowRecoveryState(node, slotId, attemptId, 'loading', message);
}

export function workflowOutputStatus(outputs: { status: CanvasNodeStatus }[]): CanvasNodeStatus {
    if (outputs.some(item => item.status === 'loading')) return 'loading';
    if (outputs.some(item => item.status === 'error')) return 'error';
    if (outputs.some(item => item.status === 'idle')) return 'idle';
    return outputs.length > 0 && outputs.every(item => item.status === 'success') ? 'success' : 'idle';
}

/** Result projection cannot create a target or replace a newer attempt. */
export function workflowRecoveryTarget(nodes: CanvasNodeData[], nodeId: string, slotId: string, attemptId: string, scopeId: string | null): CanvasNodeData | undefined {
    const node = nodes.find(item => item.id === nodeId);
    const attempt = node?.metadata?.workflowTasks?.[slotId];
    if (!node || !attempt || attempt.id !== attemptId || attempt.scopeId !== scopeId) return undefined;
    const slots = attempt.kind === 'image' ? node.metadata?.images : attempt.kind === 'text' ? node.metadata?.texts : undefined;
    if (slots?.length && !slots.some(item => item.id === slotId)) return undefined;
    return node;
}

/** An inconclusive query updates the original placeholder, not a failed/retry card. */
export function updateWorkflowRecoveryState(node: CanvasNodeData, slotId: string, attemptId: string, status: 'loading' | 'error' | 'idle', message: string, text?: string): CanvasNodeData {
    const attempt = node.metadata?.workflowTasks?.[slotId];
    if (!attempt || attempt.id !== attemptId) return node;
    const metadata = { ...node.metadata };
    const slots = attempt.kind === 'image' ? metadata.images : attempt.kind === 'text' ? metadata.texts : undefined;
    if (slots?.length && !slots.some(item => item.id === slotId && item.status !== 'success')) return node;
    if (!slots?.length && metadata.status === 'success') return node;
    if (attempt.kind === 'image') metadata.images = metadata.images?.map(item => item.id === slotId ? { ...item, status, errorDetails: message } : item);
    if (attempt.kind === 'text') {
        metadata.texts = metadata.texts?.map(item => item.id === slotId ? { ...item, status, errorDetails: message, ...(text ? { content: text } : {}) } : item);
        if (text && (!metadata.primaryTextId || metadata.primaryTextId === slotId)) metadata.content = text;
    }
    const outputs = attempt.kind === 'image' ? metadata.images : attempt.kind === 'text' ? metadata.texts : undefined;
    metadata.status = outputs?.length ? workflowOutputStatus(outputs) : status;
    metadata.errorDetails = metadata.status === 'loading' && status !== 'loading'
        ? outputs?.find(item => item.status === 'loading')?.errorDetails || WORKFLOW_RECOVERY_MESSAGE
        : message;
    return { ...node, metadata };
}

/** Replace one image attempt with every image returned by the provider. */
export function mergeWorkflowImageResults(node: CanvasNodeData, slotId: string, results: CanvasNodeImage[]): CanvasNodeData {
    if (!results.length) return node;
    const metadata = { ...node.metadata };
    const images = [...(metadata.images || [])];
    const index = images.length ? images.findIndex(image => image.id === slotId) : 0;
    // Single-image operations use the node itself as the slot. Never recreate a removed group slot.
    if (index < 0 || (!images.length && slotId !== node.id)) return node;
    images.splice(index, 1, ...results);
    const primaryId = metadata.primaryImageId === slotId ? results[0].id : metadata.primaryImageId || results[0].id;
    const primary = images.find(image => image.id === primaryId) || images[0];
    metadata.images = images;
    metadata.count = images.length;
    metadata.primaryImageId = primary?.id;
    metadata.status = workflowOutputStatus(images);
    metadata.errorDetails = metadata.status === 'success' ? undefined : images.find(image => image.status === metadata.status)?.errorDetails;
    if (primary) {
        metadata.content = primary.content;
        metadata.storageKey = primary.storageKey;
        metadata.naturalWidth = primary.naturalWidth;
        metadata.naturalHeight = primary.naturalHeight;
        metadata.bytes = primary.bytes;
        metadata.mimeType = primary.mimeType;
    }
    return { ...node, metadata };
}

/** Keep every original slot, including incomplete text, so it can be recovered. */
export function mergeWorkflowTextResults(node: CanvasNodeData, results: CanvasNodeText[]): CanvasNodeData {
    if (!node.metadata?.texts?.some(slot => results.some(result => result.id === slot.id))) return node;
    const texts = node.metadata?.texts?.map(slot => results.find(result => result.id === slot.id) || slot) || [];
    const primary = texts.find(slot => slot.id === node.metadata?.primaryTextId) || texts[0];
    const status = workflowOutputStatus(texts);
    return { ...node, metadata: { ...node.metadata, texts, primaryTextId: primary?.id, content: primary?.content || '', status,
        errorDetails: status === 'loading' ? WORKFLOW_RECOVERY_MESSAGE : status === 'error' ? '部分文本未完成，请查看对应结果。' : undefined } };
}
