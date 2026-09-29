export type WorkflowTaskTarget = { targetId: string; projectId?: string; nodeId?: string; slotId?: string; logId?: string };
const targets = new Map<string, WorkflowTaskTarget>();
/** The caller has already persisted this projection before registering the target. */
export function registerWorkflowTaskTarget(id: string, target: WorkflowTaskTarget) { targets.set(id, target); }
export function takeWorkflowTaskTarget(id: string): WorkflowTaskTarget {
    const target = targets.get(id) || { targetId: id };
    targets.delete(id);
    return target;
}
