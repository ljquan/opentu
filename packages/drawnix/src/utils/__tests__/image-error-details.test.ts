import { describe, expect, it, vi } from 'vitest';
import {
  createImageApiError,
  extractImageErrorDiagnostics,
  getImageFailureDetails,
  readImageApiError,
  toImageTaskError,
} from '../image-error-details';
import type { Task } from '../../types/shared/core.types';
import { tuziGPTImageAdapter } from '../../services/model-adapters/tuzi-gpt-image-adapter';
import { gptImageAdapter } from '../../services/model-adapters/gpt-image-adapter';
import {
  generateImageAsync,
  resumeAsyncImagePolling,
} from '../../services/media-api/image-api';

describe('image failure diagnostics', () => {
  it.each([tuziGPTImageAdapter, gptImageAdapter])(
    'preserves a header-only provider ID and error code through $id and task serialization',
    async (adapter) => {
      const fetcher = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'content_policy_violation',
                message: '请求内容被拒绝',
              },
            }),
            { status: 400, headers: { 'x-request-id': 'provider-request-1' } }
          )
      );
      const error = await adapter
        .generateImage(
          {
            baseUrl: 'https://example.com/v1',
            apiKey: 'test-only',
            fetcher,
          },
          { model: 'gpt-image-2', prompt: 'test' }
        )
        .catch((failure) => failure);
      const storedError = JSON.parse(
        JSON.stringify(
          toImageTaskError(error, 'EXECUTION_ERROR', 'gpt-image-2')
        )
      );
      const details = getImageFailureDetails({
        params: {},
        error: storedError,
      } as Task);
      expect(details).toMatchObject({
        requestId: 'provider-request-1',
        modelId: 'gpt-image-2',
        error: '[HTTP 400 · content_policy_violation] 请求内容被拒绝',
      });
      expect(JSON.stringify(storedError)).not.toContain('test-only');
    }
  );

  it('handles HTTP 200 business failures in the Tuzi adapter', async () => {
    const error = await tuziGPTImageAdapter
      .generateImage(
        {
          baseUrl: 'https://example.com/v1',
          fetcher: vi.fn(
            async () =>
              new Response(
                JSON.stringify({
                  status: 'failed',
                  request_id: 'body-id',
                  task_id: 'api-task',
                  error: { code: 'rejected', message: 'Rejected' },
                })
              )
          ),
        },
        { model: 'gpt-image-2', prompt: 'test' }
      )
      .catch((failure) => failure);
    expect(error.diagnostics).toMatchObject({
      requestId: 'body-id',
      remoteId: 'api-task',
      httpStatus: 200,
      apiErrorCode: 'rejected',
    });
  });

  it('extracts legacy IDs and retains the original message while removing only its duplicate display suffix', () => {
    const message = '请求内容被拒绝 (request id: legacy-id)';
    const task = {
      params: { model: 'gpt-image-2' },
      error: { code: 'ERROR', message },
    } as Task;
    expect(getImageFailureDetails(task)).toMatchObject({
      requestId: 'legacy-id',
      error: '请求内容被拒绝',
    });
    expect(task.error?.message).toBe(message);
  });

  it('does not confuse local or generic IDs with provider request/task IDs', () => {
    expect(
      extractImageErrorDiagnostics({ id: 'unrelated-id', code: 'ERROR' })
    ).toMatchObject({ requestId: undefined, remoteId: undefined });
    expect(
      getImageFailureDetails({
        id: 'local-task',
        params: {},
        error: { code: 'NETWORK', message: 'Failed to fetch' },
      } as Task)
    ).toMatchObject({
      requestId: undefined,
      remoteId: undefined,
      error: 'Failed to fetch',
    });
  });

  it('preserves non-JSON errors and a response-header ID', async () => {
    const error = await readImageApiError(
      new Response('Gateway unavailable', {
        status: 502,
        headers: { 'x-oneapi-request-id': 'gateway-id' },
      }),
      'Fallback'
    );
    expect(error.message).toBe('Gateway unavailable');
    expect(error.diagnostics).toMatchObject({
      requestId: 'gateway-id',
      httpStatus: 502,
    });
  });

  it('prefers the provider message ID over gateway IDs and retains remote IDs when context is absent', () => {
    const error = createImageApiError(
      {
        request_id: 'explicit-id',
        task_id: 'remote-task',
        error: { message: 'Failed (request id: embedded-id)' },
      },
      new Response(null, { headers: { 'x-request-id': 'header-id' } }),
      'Fallback',
      { remoteId: undefined }
    );
    expect(error.diagnostics).toMatchObject({
      requestId: 'embedded-id',
      remoteId: 'remote-task',
    });
  });

  it('repairs a saved gateway ID while retaining the error code and original message', () => {
    const message = '请求内容被拒绝 (request id: provider-correct-id)';
    const task = {
      params: { model: 'gpt-image-2' },
      error: {
        code: 'EXECUTION_ERROR',
        message,
        details: {
          requestId: 'wrong-gateway-id',
          httpStatus: 451,
          apiErrorCode: 'content_policy_violation',
        },
      },
    } as Task;
    expect(getImageFailureDetails(task)).toMatchObject({
      requestId: 'provider-correct-id',
      error: '[HTTP 451 · content_policy_violation] 请求内容被拒绝',
    });
    expect(task.error?.message).toBe(message);
    const wrapped = Object.assign(new Error(message), {
      diagnostics: task.error?.details,
    });
    expect(toImageTaskError(wrapped, 'ERROR').details.requestId).toBe(
      'provider-correct-id'
    );
  });

  it('keeps the remote task ID and failure request ID on async polling failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'remote-42', status: 'queued' }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'failed',
            error: { code: 'policy', message: 'Blocked' },
          }),
          { headers: { 'x-request-id': 'poll-request' } }
        )
      );
    const error = await generateImageAsync(
      { model: 'gpt-image-2', prompt: 'test' },
      {
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-only',
        fetchImpl,
      },
      { interval: 1, maxAttempts: 1 }
    ).catch((failure) => failure);
    expect(error.diagnostics).toMatchObject({
      remoteId: 'remote-42',
      requestId: 'poll-request',
      apiErrorCode: 'policy',
      httpStatus: 200,
      modelId: 'gpt-image-2',
    });
  });

  it('keeps the task ID when resumed polling returns an HTTP error', async () => {
    const error = await resumeAsyncImagePolling(
      'resume-id',
      {
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-only',
        defaultModel: 'gpt-image-2',
        fetchImpl: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: { code: 'expired', message: 'Expired' },
              }),
              { status: 404, headers: { 'x-request-id': 'resume-request' } }
            )
        ),
      },
      { maxAttempts: 1 }
    ).catch((failure) => failure);
    expect(error.diagnostics).toMatchObject({
      remoteId: 'resume-id',
      requestId: 'resume-request',
      apiErrorCode: 'expired',
      httpStatus: 404,
    });
  });
});

describe('request ID display cleanup', () => {
  it.each([
    '(request id: provider-123)',
    '（REQUEST ID = provider-123 ）',
    'request_id: provider-123',
    'request-id=provider-123',
    'RequestId: provider-123',
    'request ID : provider-123   ',
  ])(
    'removes the explicit suffix %s without changing stored error text',
    (suffix) => {
      const message = `Provider busy ${suffix}`;
      const task = {
        params: {},
        error: {
          code: 'API_ERROR',
          message,
          details: { httpStatus: 429, apiErrorCode: 'rate_limit' },
        },
      } as Task;
      expect(getImageFailureDetails(task)).toMatchObject({
        requestId: 'provider-123',
        error: '[HTTP 429 · rate_limit] Provider busy',
      });
      expect(task.error?.message).toBe(message);
    }
  );

  it('keeps request IDs embedded in explanatory prose', () => {
    const message =
      'Look up request_id: provider-123 for details; task_id: task-456';
    expect(getImageFailureDetails(null, message)).toMatchObject({
      requestId: 'provider-123',
      error: message,
    });
  });

  it('does not remove unlabelled IDs or other error context', () => {
    const task = {
      params: {},
      error: {
        code: 'API_ERROR',
        message: 'Failure provider-123; task_id: task-456',
        details: { requestId: 'provider-123' },
      },
    } as Task;
    expect(getImageFailureDetails(task).error).toBe(task.error?.message);
  });
});

it('keeps the provider ID while omitting both provider and gateway suffixes', () => {
  const message = 'Rejected (request id: provider-id) (request id: gateway-id)';
  const task = {
    params: {},
    error: {
      code: 'ERROR',
      message,
      details: { requestId: 'gateway-id' },
    },
  } as Task;
  expect(getImageFailureDetails(task)).toMatchObject({
    requestId: 'provider-id',
    error: 'Rejected',
  });
  expect(task.error?.message).toBe(message);
});
