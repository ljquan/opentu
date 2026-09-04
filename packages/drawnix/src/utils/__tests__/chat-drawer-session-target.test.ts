import { describe, expect, it } from 'vitest';
import { resolveWorkflowSessionTarget } from '../chat-drawer-session-target';

describe('chat drawer workflow session target', () => {
  it('appends workflow messages to the active session when requested', () => {
    expect(resolveWorkflowSessionTarget('session-1', true)).toEqual({
      mode: 'append',
      sessionId: 'session-1',
    });
  });

  it('prefers the explicit target session when provided', () => {
    expect(resolveWorkflowSessionTarget('session-1', true, 'session-2')).toEqual({
      mode: 'append',
      sessionId: 'session-2',
    });
  });

  it('creates a session when no active session exists', () => {
    expect(resolveWorkflowSessionTarget(null, true)).toEqual({
      mode: 'create',
    });
  });

  it('preserves the existing new-session behavior by default', () => {
    expect(resolveWorkflowSessionTarget('session-1')).toEqual({
      mode: 'create',
    });
  });
});
