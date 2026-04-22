import { describe, expect, it } from 'vitest';
import { resolveWorkflowSession } from '../workflow-session';

describe('resolveWorkflowSession', () => {
  it('在允许续接且存在当前会话时复用当前会话', () => {
    expect(
      resolveWorkflowSession({
        activeSessionId: 'session-1',
        continueInCurrentSession: true,
      })
    ).toEqual({
      reuseExistingSession: true,
      targetSessionId: 'session-1',
    });
  });

  it('未显式续接时仍创建新会话', () => {
    expect(
      resolveWorkflowSession({
        activeSessionId: 'session-1',
        continueInCurrentSession: false,
      })
    ).toEqual({
      reuseExistingSession: false,
      targetSessionId: null,
    });
  });

  it('没有当前会话时返回创建新会话', () => {
    expect(
      resolveWorkflowSession({
        activeSessionId: null,
        continueInCurrentSession: true,
      })
    ).toEqual({
      reuseExistingSession: false,
      targetSessionId: null,
    });
  });
});
