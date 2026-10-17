import type { SessionAccount } from '../auth';
import { executeGeneration } from './adapters';
import { asGatewayError, GenerationGatewayError } from './errors';
import { generationRequestHash } from './input';
import {
  applyLaunchInputLimits,
  assertPublicGenerationEnabled,
} from './launch-policy';
import {
  acquireSubmissionLease,
  completeTaskFailure,
  completeTaskSuccess,
  consumeGenerationRateLimit,
  enforceBillingBoundary,
  findOwnedTask,
  findTaskByIdempotency,
  insertGenerationTask,
  publicTask,
  resolveGenerationRoute,
  resolveStoredTaskRoute,
  startAttempt,
} from './repository';
import type {
  CreateGenerationTaskRequest,
  GenerationRoute,
  GenerationTaskRow,
  GenerationExecutionResult,
  PublicGenerationTask,
} from './types';

async function executeQueuedTask(
  account: SessionAccount,
  task: GenerationTaskRow,
  request: CreateGenerationTaskRequest,
  route?: GenerationRoute
): Promise<GenerationTaskRow> {
  const lease = await acquireSubmissionLease(task.id, account.id);
  if (!lease) return findOwnedTask(account.id, task.id);
  let attemptId = '';
  let execution: GenerationExecutionResult;
  try {
    const executionRoute = route || (await resolveStoredTaskRoute(lease.task));
    await enforceBillingBoundary(account, executionRoute, false);
    attemptId = await startAttempt(lease.task, executionRoute.provider.id);
    execution = await executeGeneration(executionRoute, request, task.id);
  } catch (error) {
    const gatewayError = asGatewayError(error);
    console.error('[OpenTu generation task]', {
      taskId: task.id,
      code: gatewayError.code,
      upstreamStatus: gatewayError.upstreamStatus || null,
    });
    if (!attemptId) {
      attemptId = await startAttempt(
        lease.task,
        route?.provider.id || task.provider_id || ''
      );
    }
    return completeTaskFailure({
      taskId: task.id,
      userId: account.id,
      leaseToken: lease.leaseToken,
      attemptId,
      code: gatewayError.code,
      message: gatewayError.message,
      retryable: gatewayError.retryable,
      upstreamStatus: gatewayError.upstreamStatus,
    });
  }
  // A persistence failure after upstream success must not become a retryable
  // provider failure. Preserve the lease for reconciliation instead.
  return completeTaskSuccess({
    taskId: task.id,
    userId: account.id,
    leaseToken: lease.leaseToken,
    attemptId,
    result: execution.result,
    usage: execution.usage,
  });
}

export async function createGenerationTask(params: {
  account: SessionAccount;
  idempotencyKey: string;
  request: CreateGenerationTaskRequest;
  canaryRequested: boolean;
}): Promise<{ task: PublicGenerationTask; created: boolean }> {
  assertPublicGenerationEnabled();
  applyLaunchInputLimits(params.request);
  const requestHash = generationRequestHash(params.request);
  const existing = await findTaskByIdempotency(
    params.account.id,
    params.idempotencyKey
  );
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new GenerationGatewayError(
        409,
        'IDEMPOTENCY_CONFLICT',
        '该 Idempotency-Key 已用于不同的生成请求'
      );
    }
    const resumed =
      existing.status === 'queued'
        ? await executeQueuedTask(params.account, existing, params.request)
        : existing;
    return { task: publicTask(resumed), created: false };
  }

  await consumeGenerationRateLimit(params.account, params.request.operation);
  const route = await resolveGenerationRoute(params.request);
  const billing = await enforceBillingBoundary(params.account, route, false);
  const inserted = await insertGenerationTask({
    account: params.account,
    idempotencyKey: params.idempotencyKey,
    requestHash,
    request: params.request,
    route,
    billing,
  });
  if (!inserted.inserted && inserted.task.request_hash !== requestHash) {
    throw new GenerationGatewayError(
      409,
      'IDEMPOTENCY_CONFLICT',
      '该 Idempotency-Key 已用于不同的生成请求'
    );
  }
  const completed =
    inserted.task.status === 'queued'
      ? await executeQueuedTask(
          params.account,
          inserted.task,
          params.request,
          route
        )
      : inserted.task;
  return { task: publicTask(completed), created: inserted.inserted };
}
