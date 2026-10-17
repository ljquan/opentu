import { useCallback, useEffect, useState } from 'react';
import { drawnixWorkspaceRuntime } from '../infrastructure/drawnix-workspace-runtime';
import type { WorkspaceRuntimeSnapshot } from '../domain/workspace-model';

const EMPTY_SNAPSHOT: WorkspaceRuntimeSnapshot = {
  boards: [],
  tasks: [],
  activities: [],
  updatedAt: 0,
};

export function useWorkspaceRuntime() {
  const [snapshot, setSnapshot] = useState<WorkspaceRuntimeSnapshot>(
    drawnixWorkspaceRuntime.getSnapshot() || EMPTY_SNAPSHOT
  );

  useEffect(() => drawnixWorkspaceRuntime.subscribe(setSnapshot), []);

  const refresh = useCallback(() => drawnixWorkspaceRuntime.refresh(), []);
  const cancelTask = useCallback(
    (taskId: string) => drawnixWorkspaceRuntime.cancelTask(taskId),
    []
  );
  const retryTask = useCallback(
    (taskId: string) => drawnixWorkspaceRuntime.retryTask(taskId),
    []
  );

  return { ...snapshot, refresh, cancelTask, retryTask };
}
