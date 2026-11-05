import type {
  PostProcessingStatus,
  WorkflowMessageData,
  WorkflowRetryContext,
} from '../types/chat.types';
import type { WorkflowDefinition as LegacyWorkflowDefinition } from '../components/ai-input-bar/workflow-converter';

/**
 * Convert internal workflow to WorkflowMessageData for ChatDrawer.
 */
export function toWorkflowMessageData(
  workflow: LegacyWorkflowDefinition,
  retryContext?: WorkflowRetryContext,
  postProcessingStatus?: PostProcessingStatus,
  insertedCount?: number
): WorkflowMessageData {
  const metadata = workflow.metadata || {};

  return {
    id: workflow.id,
    name: workflow.name,
    generationType: workflow.generationType,
    prompt: metadata.prompt || retryContext?.aiContext?.finalPrompt || '',
    aiAnalysis: workflow.aiAnalysis,
    count: metadata.count,
    createdAt: workflow.createdAt,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      description: step.description,
      status: step.status,
      mcp: step.mcp,
      args: step.args,
      result: step.result,
      error: step.error,
      errorDetails: step.errorDetails,
      duration: step.duration,
      options: step.options,
    })),
    retryContext,
    postProcessingStatus,
    insertedCount,
  };
}
