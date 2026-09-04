export type WorkflowSessionTarget =
  | { mode: 'append'; sessionId: string }
  | { mode: 'create' };

export function resolveWorkflowSessionTarget(
  activeSessionId: string | null,
  appendToCurrentSession?: boolean,
  appendToSessionId?: string | null
): WorkflowSessionTarget {
  if (appendToSessionId) {
    return { mode: 'append', sessionId: appendToSessionId };
  }

  if (appendToCurrentSession && activeSessionId) {
    return { mode: 'append', sessionId: activeSessionId };
  }

  return { mode: 'create' };
}
