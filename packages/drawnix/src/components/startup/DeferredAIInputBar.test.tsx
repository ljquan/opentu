// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeferredAIInputBar } from './DeferredAIInputBar';

const mocks = vi.hoisted(() => ({
  aiInputBar: vi.fn(() => null),
}));

vi.mock('../../contexts/WorkflowContext', () => ({
  WorkflowProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../contexts/ModelHealthContext', () => ({
  ModelHealthProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock('../ai-input-bar/AIInputBar', () => ({
  AIInputBar: mocks.aiInputBar,
}));

describe('DeferredAIInputBar', () => {
  it('passes the normal board identity without legacy workflow bindings', () => {
    render(
      <DeferredAIInputBar
        isDataReady
        currentBoardId="workflow-local"
        activationKey={0}
      />
    );

    expect(mocks.aiInputBar).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBoardId: 'workflow-local',
      }),
      expect.anything()
    );
  });
});
