import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedGenerationParams } from '../../utils/ai-input-parser';
import { useWorkflowSubmission } from '../useWorkflowSubmission';

const mocks = vi.hoisted(() => ({
  sendWorkflowMessage: vi.fn(),
  startWorkflow: vi.fn(),
}));
vi.mock('../../contexts/ChatDrawerContext', () => ({
  useChatDrawerControl: () => ({
    sendWorkflowMessage: mocks.sendWorkflowMessage,
  }),
}));
vi.mock('../../contexts/WorkflowContext', () => ({
  useWorkflowControl: () => ({ startWorkflow: mocks.startWorkflow }),
}));
vi.mock('../../services/workflow-submission-service', () => ({
  workflowSubmissionService: {
    init: vi.fn(),
    registerCanvasHandler: vi.fn(),
    subscribeToAllEvents: () => ({ unsubscribe: vi.fn() }),
    recoverWorkflows: vi.fn(async () => undefined),
  },
}));
vi.mock('../useTaskWorkflowSync', () => ({ useTaskWorkflowSync: vi.fn() }));
vi.mock('../../plugins/with-workzone', () => ({ WorkZoneTransforms: {} }));
vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: { get: () => ({ textModelName: 'gpt-5.4' }) },
}));
vi.mock('../../components/ai-input-bar/workflow-converter', () => ({
  convertToWorkflow: () => ({
    id: 'workflow-1',
    generationType: 'image',
    steps: [],
  }),
}));

const input = {
  generationType: 'image',
  modelId: 'gpt-image-2.5',
  userInstruction: 'test image',
  prompt: 'test image',
  count: 1,
} as ParsedGenerationParams;

function setup() {
  return renderHook(() =>
    useWorkflowSubmission({
      boardRef: { current: null },
      workZoneIdRef: { current: null },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('workflow submission preparation', () => {
  it('waits for storage beyond 60 seconds and continues when storage completes', async () => {
    let finish!: () => void;
    mocks.sendWorkflowMessage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { result } = setup();
    const outcome = vi.fn();
    const submission = result.current
      .submitWorkflow(input, [])
      .then(outcome, outcome);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(outcome).not.toHaveBeenCalled();
    finish();
    await submission;
    expect(outcome).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      usedSW: false,
    });
    expect(mocks.sendWorkflowMessage).toHaveBeenCalledTimes(1);
  });

  it('passes session targeting through successful preparation', async () => {
    mocks.sendWorkflowMessage.mockResolvedValueOnce(undefined);
    const { result } = setup();
    await expect(
      result.current.submitWorkflow(input, [], undefined, undefined, {
        appendToCurrentChatSession: true,
        targetSessionId: 'session-2',
      })
    ).resolves.toEqual({ workflowId: 'workflow-1', usedSW: false });
    expect(mocks.sendWorkflowMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        appendToCurrentSession: true,
        appendToSessionId: 'session-2',
      })
    );
    expect(mocks.sendWorkflowMessage.mock.calls[0][0]).not.toHaveProperty(
      'signal'
    );
  });

  it('propagates a real storage failure without retrying preparation', async () => {
    const error = new Error('QuotaExceededError');
    mocks.sendWorkflowMessage.mockRejectedValueOnce(error);
    const { result } = setup();
    await expect(result.current.submitWorkflow(input, [])).rejects.toBe(error);
    expect(mocks.sendWorkflowMessage).toHaveBeenCalledTimes(1);
  });
});
