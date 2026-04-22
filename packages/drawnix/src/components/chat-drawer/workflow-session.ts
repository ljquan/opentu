export interface ResolveWorkflowSessionOptions {
  activeSessionId: string | null;
  continueInCurrentSession?: boolean;
}

export interface ResolveWorkflowSessionResult {
  reuseExistingSession: boolean;
  targetSessionId: string | null;
}

export function resolveWorkflowSession(
  options: ResolveWorkflowSessionOptions
): ResolveWorkflowSessionResult {
  if (options.continueInCurrentSession && options.activeSessionId) {
    return {
      reuseExistingSession: true,
      targetSessionId: options.activeSessionId,
    };
  }

  return {
    reuseExistingSession: false,
    targetSessionId: null,
  };
}
