import { describe, expect, it, vi } from 'vitest';
import { WorkflowEngine } from './engine';
import type { Workflow, WorkflowEvent } from './types';
import { createGenerationApiError } from '../../utils/generation-error-details';
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  generateVideo: vi.fn(),
  aiAnalyze: vi.fn(),
  saved: [] as unknown[],
}));
vi.mock('../media-generation', () => ({
  TaskStatus: { FAILED: 'failed' },
  generateVideo: mocks.generateVideo,
  generateImage: vi.fn(),
}));
vi.mock('../media-executor/factory', () => ({
  executorFactory: {
    getFallbackExecutor: () => ({
      generateText: mocks.generateText,
      aiAnalyze: mocks.aiAnalyze,
    }),
  },
}));
vi.mock('./workflow-storage-writer', () => ({
  workflowStorageWriter: {
    saveWorkflow: async (workflow: unknown) => {
      mocks.saved.push(JSON.parse(JSON.stringify(workflow)));
    },
  },
}));

describe('workflow failure metadata persistence', () => {
  it.each(['generate_text', 'ai_analyze', 'generate_video'])(
    'retains the actual model and provider ID for %s',
    async (mcp) => {
      const failure = createGenerationApiError(
        {
          error: {
            message: 'Denied (request id: provider-id)',
            code: 'permission_denied',
          },
        },
        new Response(null, {
          status: 403,
          headers: { 'x-request-id': 'gateway-id' },
        }),
        'Denied',
        { modelId: 'actual-model' }
      );
      mocks.generateVideo.mockResolvedValue({
        task: {
          id: 'local-video',
          status: 'failed',
          params: { model: 'requested-alias' },
          error: {
            code: 'API_ERROR',
            message: failure.message,
            details: {
              ...failure.diagnostics,
              remoteId: 'provider-video-task',
            },
          },
        },
      });
      mocks.generateText.mockRejectedValue(failure);
      mocks.aiAnalyze.mockRejectedValue(failure);
      mocks.saved.length = 0;
      const events: WorkflowEvent[] = [];
      const engine = new WorkflowEngine({
        onEvent: (event) => events.push(event),
      });
      const workflow: Workflow = {
        id: `wf-${mcp}`,
        name: 'test',
        status: 'pending',
        createdAt: 1,
        updatedAt: 1,
        steps: [
          {
            id: 'failed-step',
            mcp,
            args: { prompt: 'test', model: 'requested-alias' },
            description: 'test',
            status: 'pending',
          },
        ],
      };
      await engine.submitWorkflow(workflow);
      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'failed')).toBe(true)
      );
      const failed = events.find(
        (event) => event.type === 'step' && event.status === 'failed'
      );
      expect(failed).toMatchObject({
        errorDetails: {
          details: {
            requestId: 'provider-id',
            modelId: 'actual-model',
            httpStatus: 403,
            apiErrorCode: 'permission_denied',
          },
        },
      });
      if (mcp === 'generate_video') {
        expect(failed).toMatchObject({
          errorDetails: { details: { remoteId: 'provider-video-task' } },
        });
      }
      expect(mocks.saved).toContainEqual(
        expect.objectContaining({
          steps: [
            expect.objectContaining({
              errorDetails: expect.objectContaining({
                details: expect.objectContaining({ requestId: 'provider-id' }),
              }),
            }),
          ],
        })
      );
      engine.destroy();
    }
  );
});
