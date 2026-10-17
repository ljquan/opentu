import type { ProviderRecord } from '../provider';

export type GenerationOperation = 'text' | 'image' | 'video' | 'audio';

export type GenerationTaskStatus =
  | 'queued'
  | 'submitting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type GenerationBillingMode = 'unconfigured' | 'free' | 'external';

export type GenerationReference = {
  uploadId: string;
  role: string;
};

export type CreateGenerationTaskRequest = {
  modelId: string;
  operation: GenerationOperation;
  input: Record<string, unknown>;
  parameters: Record<string, unknown>;
  references: GenerationReference[];
  context: {
    parentTaskId?: string;
    workflowId?: string;
  };
};

export type GenerationRoute = {
  provider: ProviderRecord;
  providerModelRecordId: string;
  modelId: string;
  category: 'image' | 'video' | 'audio' | 'text' | 'research';
  billingMode: GenerationBillingMode;
  routingPriority: number;
};

export type GenerationUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  generatedCount?: number;
  durationSeconds?: number;
  provider?: Record<string, unknown>;
};

export type GenerationExecutionResult = {
  result: Record<string, unknown>;
  usage?: GenerationUsage;
};

export type GenerationTaskRow = {
  id: string;
  user_id: string;
  user_role: number;
  idempotency_key: string;
  request_hash: string;
  public_model_id: string;
  provider_model_record_id: string | null;
  provider_id: string | null;
  operation: GenerationOperation;
  status: GenerationTaskStatus;
  input_json: Record<string, unknown>;
  parameters_json: Record<string, unknown>;
  references_json: GenerationReference[];
  result_json: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  error_retryable: boolean;
  upstream_task_id: string | null;
  upstream_status: string | null;
  attempt_count: number;
  next_poll_at: string | null;
  cancel_requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  billing_mode: GenerationBillingMode;
  billable: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicGenerationTask = {
  id: string;
  modelId: string;
  operation: GenerationOperation;
  status: GenerationTaskStatus;
  result: Record<string, unknown> | null;
  error: null | {
    code: string;
    message: string;
    retryable: boolean;
  };
  attemptCount: number;
  nextPollAt: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

