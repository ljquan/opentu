import { describe, expect, it } from 'vitest';
import { WORKFLOW_MEDIA_RECOVERY_MESSAGE, WORKFLOW_RECOVERY_TIMEOUT_MESSAGE, WORKFLOW_RECOVERY_MESSAGE, mergeWorkflowImageResults, mergeWorkflowTextResults, updateWorkflowRecoveryState, updateWorkflowMediaRecoveryNotice, workflowOutputStatus, workflowRecoveryMessage, workflowRecoveryTarget } from '../src/lib/canvas/workflow-recovery-target';
import { CanvasNodeType, type CanvasNodeData } from '../src/types/canvas';
import { resetInterruptedGeneration } from '../src/lib/canvas/canvas-generation-helpers';
const slot = { id: 'slot', content: '', status: 'loading' as const, naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: '' };
const node: CanvasNodeData = { id: 'node', type: CanvasNodeType.Image, title: 'image', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { images: [slot], workflowTasks: { slot: { id: 'attempt', scopeId: 'owner', kind: 'image' } } } };
describe('workflow canvas projection identity', () => {
    it('preserves text and status for empty or unmatched recovery results', () => {
        const original: CanvasNodeData = { ...node, metadata: { content: 'Received text', status: 'loading' } };
        expect(mergeWorkflowTextResults(original, [])).toBe(original);
        expect(mergeWorkflowTextResults(original, [{ id: 'other', content: 'late', status: 'success' }])).toBe(original);
        const slotted = { ...original, metadata: { ...original.metadata, texts: [{ id: 'text', content: 'Saved', status: 'loading' as const }] } };
        expect(mergeWorkflowTextResults(slotted, [])).toBe(slotted);
        expect(mergeWorkflowTextResults(slotted, [{ id: 'other', content: 'late', status: 'success' }])).toBe(slotted);
        expect(workflowOutputStatus([])).toBe('idle');
    });
    it('keeps a replaced primary image selected when the returned id changes', () => {
        const source = { ...node, metadata: { ...node.metadata, primaryImageId: slot.id, images: [{ ...slot, id: 'sibling' }, slot] } };
        const result = { ...slot, id: 'new-result', content: 'https://result.test/a.png', status: 'success' as const };
        expect(mergeWorkflowImageResults(source, slot.id, [result]).metadata).toMatchObject({ primaryImageId: 'new-result', content: result.content });
    });
    const mjResults = Array.from({ length: 4 }, (_, index) => ({ ...slot, id: index ? `mj-${index}` : slot.id, status: 'success' as const, content: `blob:mj-${index}`, storageKey: `image:mj-${index}`, naturalWidth: 1200, naturalHeight: 800, bytes: 100, mimeType: 'image/jpeg' }));

    it('keeps all four MJ images and their cache keys through a saved canvas round trip', () => {
        const merged = mergeWorkflowImageResults(node, slot.id, mjResults);
        const [restored] = resetInterruptedGeneration(JSON.parse(JSON.stringify([merged])));
        expect(restored.metadata).toMatchObject({ images: mjResults, primaryImageId: slot.id, count: 4, status: 'success', content: mjResults[0].content, storageKey: mjResults[0].storageKey, naturalWidth: 1200, naturalHeight: 800, workflowTasks: node.metadata?.workflowTasks });
        expect(node.metadata?.images).toEqual([slot]);
    });

    it('replaces a retried slot without dropping completed or pending siblings or changing the selected primary', () => {
        const done = { ...mjResults[0], id: 'done' };
        const pending = { ...slot, id: 'pending', errorDetails: WORKFLOW_MEDIA_RECOVERY_MESSAGE };
        const source = { ...node, metadata: { ...node.metadata, primaryImageId: done.id, images: [done, slot, pending] } };
        const merged = mergeWorkflowImageResults(source, slot.id, mjResults);
        expect(merged.metadata).toMatchObject({ images: [done, ...mjResults, pending], count: 6, primaryImageId: done.id, content: done.content, status: 'loading', errorDetails: WORKFLOW_MEDIA_RECOVERY_MESSAGE });
    });

    it('uses the first completed image even when an earlier request is still waiting', () => {
        const pending = { ...slot, id: 'pending' };
        const source = { ...node, metadata: { ...node.metadata, images: [pending, slot] } };
        expect(mergeWorkflowImageResults(source, slot.id, mjResults).metadata).toMatchObject({ primaryImageId: slot.id, content: mjResults[0].content, status: 'loading' });
    });

    it('retains a failed sibling and its error when an MJ result completes', () => {
        const failed = { ...slot, id: 'failed', status: 'error' as const, errorDetails: 'provider rejected' };
        const source = { ...node, metadata: { ...node.metadata, images: [slot, failed] } };
        expect(mergeWorkflowImageResults(source, slot.id, mjResults).metadata).toMatchObject({ images: [...mjResults, failed], count: 5, status: 'error', errorDetails: 'provider rejected' });
    });

    it('creates an image group for single-node edit results', () => {
        const source = { ...node, metadata: { status: 'loading' as const } };
        const results = mjResults.map((image, index) => index ? image : { ...image, id: node.id });
        expect(mergeWorkflowImageResults(source, node.id, results).metadata).toMatchObject({ images: results, count: 4, primaryImageId: node.id, status: 'success' });
    });

    it('does not recreate a removed image slot or replace a target with an empty response', () => {
        const removed = { ...node, metadata: { images: [{ ...slot, id: 'other' }] } };
        expect(mergeWorkflowImageResults(removed, slot.id, mjResults)).toBe(removed);
        expect(mergeWorkflowImageResults(node, slot.id, [])).toBe(node);
    });

    it.each(['image', 'video'] as const)('does not label a current-page %s attempt as refreshed without a restoration clock', kind => {
        expect(workflowRecoveryMessage(kind, undefined, 0)).toBe(WORKFLOW_RECOVERY_MESSAGE);
        expect(workflowRecoveryMessage(kind, undefined, 600_000)).toBe(WORKFLOW_RECOVERY_MESSAGE);
        expect(workflowRecoveryMessage(kind, 0, 299_999)).toBe(WORKFLOW_MEDIA_RECOVERY_MESSAGE);
        expect(workflowRecoveryMessage(kind, 0, 300_000)).toBe(WORKFLOW_RECOVERY_TIMEOUT_MESSAGE);
    });

    it.each(['image', 'video'] as const)('reminds about logs after five minutes recovering %s, independently of the query response', kind => {
        const startedAt = 10_000;
        const source: CanvasNodeData = kind === 'image' ? node : { ...node, type: CanvasNodeType.Video, metadata: { status: 'loading', workflowTasks: { slot: { id: 'attempt', scopeId: 'owner', kind } } } };
        const restored = updateWorkflowMediaRecoveryNotice(source, 'slot', 'attempt', startedAt, startedAt);
        expect(restored.metadata?.errorDetails).toBe(WORKFLOW_MEDIA_RECOVERY_MESSAGE);
        expect(updateWorkflowMediaRecoveryNotice(restored, 'slot', 'attempt', startedAt, startedAt + 299_999)).toBe(restored);
        const reminder = updateWorkflowMediaRecoveryNotice(restored, 'slot', 'attempt', startedAt, startedAt + 300_000);
        expect(reminder.metadata).toMatchObject({ status: 'loading', errorDetails: WORKFLOW_RECOVERY_TIMEOUT_MESSAGE, workflowTasks: source.metadata?.workflowTasks });
        if (kind === 'image') expect(reminder.metadata?.images?.[0]).toMatchObject({ id: 'slot', content: '', status: 'loading', errorDetails: WORKFLOW_RECOVERY_TIMEOUT_MESSAGE });
        expect(updateWorkflowMediaRecoveryNotice(reminder, 'slot', 'attempt', startedAt, startedAt + 600_000)).toBe(reminder);
    });

    it('never overwrites success, confirmed failure, unavailable text, removed slots or newer attempts with a timed notice', () => {
        const complete = { ...node, metadata: { ...node.metadata, status: 'success' as const, images: [{ ...slot, status: 'success' as const, content: 'https://example.test/done.png' }] } };
        const failed = updateWorkflowRecoveryState(node, 'slot', 'attempt', 'error', 'provider rejected');
        const removed = { ...node, metadata: { ...node.metadata, status: 'loading' as const, images: [{ ...slot, id: 'other' }] } };
        const unavailable: CanvasNodeData = { ...node, type: CanvasNodeType.Text, metadata: { status: 'idle', texts: [{ id: 'slot', content: 'Saved prefix', status: 'idle' }], workflowTasks: { slot: { id: 'attempt', scopeId: 'owner', kind: 'text' } } } };
        for (const current of [complete, failed, removed, unavailable]) expect(updateWorkflowMediaRecoveryNotice(current, 'slot', 'attempt', 0, 300_000)).toBe(current);
        expect(updateWorkflowMediaRecoveryNotice(node, 'slot', 'old', 0, 300_000)).toBe(node);
        expect(workflowRecoveryMessage('text', 0, 300_000)).toBe(WORKFLOW_RECOVERY_MESSAGE);
        expect(workflowRecoveryMessage('audio', 0, 300_000)).toBe(WORKFLOW_RECOVERY_MESSAGE);
    });

    it('preserves the log reminder on a pending image when a sibling fails', () => {
        const pending = { ...slot, id: 'second', errorDetails: WORKFLOW_RECOVERY_TIMEOUT_MESSAGE };
        const source = { ...node, metadata: { ...node.metadata, images: [slot, pending] } };
        const failed = updateWorkflowRecoveryState(source, 'slot', 'attempt', 'error', 'provider rejected');
        expect(failed.metadata).toMatchObject({ status: 'loading', errorDetails: WORKFLOW_RECOVERY_TIMEOUT_MESSAGE });
        expect(failed.metadata?.images?.[1]).toBe(pending);
    });

    it('stops the unavailable text spinner while preserving partial text, siblings and task identity', () => {
        const text = { id: 'slot', content: 'Received prefix', status: 'loading' as const };
        const done = { id: 'done', content: 'Full answer', status: 'success' as const };
        const source: CanvasNodeData = { ...node, type: CanvasNodeType.Text, metadata: { status: 'loading', primaryTextId: 'slot', texts: [text, done], workflowTasks: { slot: { id: 'attempt', scopeId: 'owner', kind: 'text' } } } };
        const unavailable = updateWorkflowRecoveryState(source, 'slot', 'attempt', 'idle', '无法自动找回', text.content);
        expect(unavailable.metadata).toMatchObject({ status: 'idle', content: 'Received prefix', errorDetails: '无法自动找回', workflowTasks: source.metadata?.workflowTasks });
        expect(unavailable.metadata?.texts).toEqual([{ ...text, status: 'idle', errorDetails: '无法自动找回' }, done]);
        expect(resetInterruptedGeneration([unavailable])[0]).toEqual(unavailable);
        expect(workflowOutputStatus([{ status: 'idle' }, { status: 'success' }])).toBe('idle');
        expect(workflowOutputStatus([{ status: 'idle' }, { status: 'loading' }])).toBe('loading');
        expect(workflowOutputStatus([{ status: 'idle' }, { status: 'error' }])).toBe('error');
    });
    it('keeps every text slot and its partial content while siblings finish', () => {
        const pending = { id: 'pending', status: 'loading' as const, content: 'Partial answer' };
        const done = { id: 'done', status: 'success' as const, content: 'Completed answer' };
        const textNode: CanvasNodeData = { ...node, type: CanvasNodeType.Text, metadata: { primaryTextId: 'pending', texts: [pending, done], workflowTasks: { pending: { id: 'attempt', scopeId: 'owner', kind: 'text' } } } };
        const merged = mergeWorkflowTextResults(textNode, [done, pending]);
        expect(merged.metadata).toMatchObject({ status: 'loading', content: 'Partial answer', texts: [pending, done] });
        const [restored] = resetInterruptedGeneration(JSON.parse(JSON.stringify([merged])));
        expect(workflowRecoveryTarget([restored], 'node', 'pending', 'attempt', 'owner')).toBe(restored);
        expect(restored.metadata?.texts?.[0].errorDetails).toBe(WORKFLOW_RECOVERY_MESSAGE);
        const progress = updateWorkflowRecoveryState(restored, 'pending', 'attempt', 'loading', WORKFLOW_RECOVERY_MESSAGE, 'Recovered prefix');
        expect(progress.metadata?.content).toBe('Recovered prefix');
        expect(progress.metadata?.texts?.[0]).toMatchObject({ status: 'loading', content: 'Recovered prefix' });
        expect(progress.metadata?.texts?.[1]).toEqual(done);
        expect(mergeWorkflowTextResults(progress, [{ ...pending, status: 'success', content: 'Full answer' }]).metadata?.status).toBe('success');
    });

    it.each(['video', 'audio'] as const)('restores the original %s placeholder after refresh', kind => {
        const media: CanvasNodeData = { ...node, type: kind === 'video' ? CanvasNodeType.Video : CanvasNodeType.Audio, metadata: { status: 'loading', workflowTasks: { slot: { id: 'attempt', scopeId: 'owner', kind } } } };
        const [restored] = resetInterruptedGeneration(JSON.parse(JSON.stringify([media])));
        expect(restored.metadata).toMatchObject({ status: 'loading', workflowTasks: media.metadata?.workflowTasks });
        expect(updateWorkflowRecoveryState(restored, 'slot', 'attempt', 'loading', '网络暂时中断').metadata?.status).toBe('loading');
    });
    it('finds only the same attempt and owner', () => expect(workflowRecoveryTarget([node], 'node', 'slot', 'attempt', 'owner')).toBe(node));
    it('never recreates a deleted node', () => expect(workflowRecoveryTarget([], 'node', 'slot', 'attempt', 'owner')).toBeUndefined());
    it('rejects an old attempt after retry', () => expect(workflowRecoveryTarget([node], 'node', 'slot', 'old', 'owner')).toBeUndefined());
    it('rejects a response after account switch', () => expect(workflowRecoveryTarget([node], 'node', 'slot', 'attempt', 'other')).toBeUndefined());
    it('rejects a deleted output without changing siblings', () => {
        const changed = { ...node, metadata: { ...node.metadata, images: [{ id: 'other', content: 'https://example.test/done.png', status: 'success' as const }] } };
        expect(workflowRecoveryTarget([changed], 'node', 'slot', 'attempt', 'owner')).toBeUndefined();
        expect(changed.metadata.images[0].content).toBe('https://example.test/done.png');
    });

    it('keeps a refreshed pending image animated while the provider is still being queried', () => {
        const refreshed = updateWorkflowRecoveryState(node, 'slot', 'attempt', 'loading', WORKFLOW_MEDIA_RECOVERY_MESSAGE);
        expect(refreshed.metadata?.status).toBe('loading');
        expect(refreshed.metadata?.images?.[0]).toMatchObject({ status: 'loading', errorDetails: WORKFLOW_MEDIA_RECOVERY_MESSAGE });
    });

    it('only projects a confirmed failure as an error card', () => {
        const failed = updateWorkflowRecoveryState(node, 'slot', 'attempt', 'error', '上游明确失败');
        expect(failed.metadata?.status).toBe('error');
        expect(failed.metadata?.images?.[0]).toMatchObject({ status: 'error', errorDetails: '上游明确失败' });
    });

    it('keeps mixed outputs loading until every output has a terminal status', () => {
        expect(workflowOutputStatus([{ status: 'success' }, { status: 'loading' }])).toBe('loading');
        expect(workflowOutputStatus([{ status: 'success' }, { status: 'error' }])).toBe('error');
        expect(workflowOutputStatus([{ status: 'success' }, { status: 'success' }])).toBe('success');
    });

    it('restores the original waiting slot and preserves completed siblings across refresh', () => {
        const done = { ...slot, id: 'done', content: 'https://example.test/done.png', status: 'success' as const };
        const snapshot = JSON.parse(JSON.stringify({ ...node, metadata: { ...node.metadata, status: 'loading', images: [done, slot] } }));
        const [restored] = resetInterruptedGeneration([snapshot]);
        expect(restored.metadata?.images?.[0]).toEqual(done);
        expect(restored.metadata?.images?.[1]).toMatchObject({ id: 'slot', status: 'loading', errorDetails: WORKFLOW_MEDIA_RECOVERY_MESSAGE });
        expect(restored.metadata?.workflowTasks).toEqual(node.metadata?.workflowTasks);
        expect(restored.metadata?.status).toBe('loading');
    });

    it('replaces an old local timeout card with a waiting slot without losing its task identity', () => {
        const expired = updateWorkflowRecoveryState(node, 'slot', 'attempt', 'error', '查询期限已到');
        const waiting = updateWorkflowRecoveryState(expired, 'slot', 'attempt', 'loading', WORKFLOW_MEDIA_RECOVERY_MESSAGE);
        expect(waiting.metadata?.status).toBe('loading');
        expect(waiting.metadata?.images?.[0].status).toBe('loading');
        expect(waiting.metadata?.workflowTasks).toEqual(node.metadata?.workflowTasks);
    });

    it('keeps another pending output visible when one provider result fails', () => {
        const pending = { ...slot, id: 'second', status: 'loading' as const };
        const snapshot = { ...node, metadata: { ...node.metadata, images: [slot, pending] } };
        const failed = updateWorkflowRecoveryState(snapshot, 'slot', 'attempt', 'error', 'provider rejected');
        expect(failed.metadata?.status).toBe('loading');
        expect(failed.metadata?.images?.[0].status).toBe('error');
        expect(failed.metadata?.images?.[1]).toEqual(pending);
    });

    it('ignores a late waiting update after the slot has completed or been replaced', () => {
        const complete = { ...node, metadata: { ...node.metadata, images: [{ ...slot, status: 'success' as const, content: 'https://example.test/done.png' }] } };
        expect(updateWorkflowRecoveryState(complete, 'slot', 'attempt', 'loading', WORKFLOW_MEDIA_RECOVERY_MESSAGE)).toBe(complete);
        expect(updateWorkflowRecoveryState(node, 'slot', 'old-attempt', 'loading', WORKFLOW_MEDIA_RECOVERY_MESSAGE)).toBe(node);
    });

    it('does not claim an interrupted legacy node without a task id is queryable', () => {
        const [restored] = resetInterruptedGeneration([{ ...node, metadata: { status: 'loading' } }]);
        expect(restored.metadata).toMatchObject({ status: 'error', errorDetails: expect.stringContaining('结果待确认') });
    });
});
