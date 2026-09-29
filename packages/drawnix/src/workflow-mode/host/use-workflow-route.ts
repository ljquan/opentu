import { useCallback, useSyncExternalStore } from 'react';
import { isWorkflowPath, subscribeWorkflowNavigation, WORKFLOW_NAVIGATION } from './workflow-navigation';

export function useWorkflowRoute(boardId?: string | null) {
  const open = useSyncExternalStore(subscribeWorkflowNavigation, isWorkflowPath, () => false);

  const enter = useCallback(() => {
    if (!isWorkflowPath()) {
      const returnUrl = window.location.pathname + window.location.search + window.location.hash;
      window.history.pushState({ ...window.history.state, workflowReturnUrl: returnUrl }, '', '/workflow');
      window.dispatchEvent(new Event(WORKFLOW_NAVIGATION));
    }
  }, []);

  const exit = useCallback(() => {
    const stored = window.history.state?.workflowReturnUrl;
    const fallback = boardId ? '/?board=' + encodeURIComponent(boardId) : '/';
    const returnUrl = typeof stored === 'string' && (stored === '/' || stored.startsWith('/?')) ? stored : fallback;
    window.history.pushState({ boardId }, '', returnUrl);
    window.dispatchEvent(new Event(WORKFLOW_NAVIGATION));
  }, [boardId]);

  return { open, enter, exit };
}
