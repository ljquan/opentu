import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenerationTask } from './service';
import { generationRequestHash } from './input';
import { executeGeneration } from './adapters';
import * as repository from './repository';
import type { CreateGenerationTaskRequest, GenerationTaskRow } from './types';

vi.mock('./adapters', () => ({ executeGeneration: vi.fn() }));
vi.mock('./repository', () => ({
  acquireSubmissionLease: vi.fn(),
  completeTaskFailure: vi.fn(),
  completeTaskSuccess: vi.fn(),
  consumeGenerationRateLimit: vi.fn(),
  enforceBillingBoundary: vi.fn(),
  findOwnedTask: vi.fn(),
  findTaskByIdempotency: vi.fn(),
  insertGenerationTask: vi.fn(),
  publicTask: vi.fn((task) => task),
  resolveGenerationRoute: vi.fn(),
  resolveStoredTaskRoute: vi.fn(),
  startAttempt: vi.fn(),
}));

const request: CreateGenerationTaskRequest = {
  modelId: 'test-model',
  operation: 'text',
  input: { prompt: 'hello' },
  parameters: { maxTokens: 2048 },
  references: [],
  context: {},
};
const account = { id: 'user-1', role: 1, username: 'user', quota: 100 };
const task = {
  id: 'task-1',
  status: 'queued',
  request_hash: generationRequestHash(request),
} as GenerationTaskRow;

beforeEach(() => {
  vi.stubEnv('OPENTU_PUBLIC_GENERATION_ENABLED', 'true');
  vi.clearAllMocks();
  vi.mocked(repository.findTaskByIdempotency).mockResolvedValue(null);
  vi.mocked(repository.acquireSubmissionLease).mockResolvedValue({
    task,
    leaseToken: 'lease',
  });
  vi.mocked(repository.startAttempt).mockResolvedValue('attempt');
  vi.mocked(repository.resolveGenerationRoute).mockResolvedValue({
    provider: {} as never,
    providerModelRecordId: 'provider-model',
    modelId: 'test-model',
    category: 'text',
    billingMode: 'free',
    routingPriority: 1,
  });
  vi.mocked(repository.enforceBillingBoundary).mockResolvedValue({
    billable: false,
    mode: 'free',
  });
  vi.mocked(repository.insertGenerationTask).mockResolvedValue({
    task,
    inserted: true,
  });
  vi.mocked(executeGeneration).mockResolvedValue({ result: { text: 'done' } });
});
afterEach(() => vi.unstubAllEnvs());

describe('generation persistence and idempotency', () => {
  it('blocks new requests before touching providers when public generation is paused', async () => {
    vi.stubEnv('OPENTU_PUBLIC_GENERATION_ENABLED', 'false');
    await expect(
      createGenerationTask({
        account,
        request,
        idempotencyKey: 'key',
        canaryRequested: true,
      })
    ).rejects.toMatchObject({ code: 'GENERATION_PAUSED' });
    expect(repository.insertGenerationTask).not.toHaveBeenCalled();
    expect(executeGeneration).not.toHaveBeenCalled();
  });

  it('rechecks eligibility when resuming a queued task', async () => {
    vi.mocked(repository.findTaskByIdempotency).mockResolvedValue(task);
    vi.mocked(repository.resolveStoredTaskRoute).mockRejectedValue(
      new Error('model unpublished')
    );
    await createGenerationTask({
      account,
      request,
      idempotencyKey: 'key',
      canaryRequested: true,
    });
    expect(repository.resolveStoredTaskRoute).toHaveBeenCalledWith(task);
    expect(executeGeneration).not.toHaveBeenCalled();
    expect(repository.completeTaskFailure).toHaveBeenCalled();
  });
  it('does not convert successful upstream execution into a retryable failure when persistence fails', async () => {
    vi.mocked(repository.completeTaskSuccess).mockRejectedValue(
      new Error('database unavailable')
    );
    await expect(
      createGenerationTask({
        account,
        request,
        idempotencyKey: 'key',
        canaryRequested: false,
      })
    ).rejects.toThrow('database unavailable');
    expect(repository.completeTaskFailure).not.toHaveBeenCalled();
    expect(executeGeneration).toHaveBeenCalledOnce();
  });

  it('does not resubmit an existing task with an unknown upstream outcome', async () => {
    vi.mocked(repository.findTaskByIdempotency).mockResolvedValue({
      ...task,
      status: 'failed',
      error_code: 'UPSTREAM_OUTCOME_UNKNOWN',
    });
    await createGenerationTask({
      account,
      request,
      idempotencyKey: 'key',
      canaryRequested: false,
    });
    expect(repository.acquireSubmissionLease).not.toHaveBeenCalled();
    expect(executeGeneration).not.toHaveBeenCalled();
  });
});
