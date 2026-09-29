import { useCallback, useEffect, useState } from 'react';

const isWorkflow = () => window.location.pathname === '/workflow' || window.location.pathname === '/workflow/';

export function useWorkflowRoute(boardId?: string | null) {
  const [open, setOpen] = useState(isWorkflow);
  useEffect(() => {
    const sync = () => setOpen(isWorkflow());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const enter = useCallback(() => {
    if (!isWorkflow()) {
      const returnUrl = window.location.pathname + window.location.search + window.location.hash;
      window.history.pushState({ ...window.history.state, workflowReturnUrl: returnUrl }, '', '/workflow');
    }
    setOpen(true);
  }, []);

  const exit = useCallback(() => {
    const stored = window.history.state?.workflowReturnUrl;
    const fallback = boardId ? '/?board=' + encodeURIComponent(boardId) : '/';
    // Only restore ordinary same-origin board URLs.
    const returnUrl = typeof stored === 'string' && (stored === '/' || stored.startsWith('/?')) ? stored : fallback;
    window.history.pushState({ boardId }, '', returnUrl);
    setOpen(false);
  }, [boardId]);

  return { open, enter, exit };
}
