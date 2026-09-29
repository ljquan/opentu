/** Shared history for the OpenTu canvas and the workflow's nested pages. */
export const WORKFLOW_NAVIGATION = 'opentu:workflow-navigation';

let navigationSnapshot: { href: string; state: unknown } | undefined;
export function getWorkflowNavigationSnapshot() {
  const href = window.location.href;
  const state: unknown = window.history.state;
  if (!navigationSnapshot || navigationSnapshot.href !== href || navigationSnapshot.state !== state)
    navigationSnapshot = { href, state };
  return navigationSnapshot;
}

export function isWorkflowPath(pathname = window.location.pathname) {
  return pathname === '/workflow' || pathname.startsWith('/workflow/');
}

export function subscribeWorkflowNavigation(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(WORKFLOW_NAVIGATION, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(WORKFLOW_NAVIGATION, listener);
  };
}

export function navigateWorkflow(path: string, replace = false, state?: unknown) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !isWorkflowPath(url.pathname)) {
    throw new Error('无效的工作流页面地址');
  }
  // React Router state and the original board URL have separate owners.
  const nextState = { ...window.history.state, usr: state };
  window.history[replace ? 'replaceState' : 'pushState'](nextState, '', url);
  window.dispatchEvent(new Event(WORKFLOW_NAVIGATION));
}
