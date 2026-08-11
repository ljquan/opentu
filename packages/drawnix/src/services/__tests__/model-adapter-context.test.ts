import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('../provider-routing', () => ({
  providerTransport: {
    send: mocks.send,
  },
}));

import { sendAdapterRequest } from '../model-adapters/context';

function createImageContext(
  pollPathTemplate?: string
): Parameters<typeof sendAdapterRequest>[0] {
  return {
    baseUrl: 'https://api.example.com/v1',
    operation: 'image',
    apiKey: 'secret',
    requestId: 'task-image-recovery',
    binding: {
      id: 'custom-image-binding',
      profileId: 'provider-custom',
      modelId: 'custom-image',
      operation: 'image',
      protocol: 'custom-http',
      requestSchema: 'custom-http',
      responseSchema: 'custom-http.image',
      submitPath: '/images/generations',
      pollPathTemplate,
      priority: 900,
      confidence: 'high',
      source: 'manual',
    },
  };
}

describe('model adapter context', () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.send.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('forwards the stable request ID and abort signal to image submissions', async () => {
    const controller = new AbortController();

    await sendAdapterRequest(
      {
        baseUrl: 'https://api.example.com/v1',
        operation: 'image',
        apiKey: 'secret',
        requestId: 'task-image-1',
        signal: controller.signal,
      },
      {
        path: '/images/generations',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    );

    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        requestId: 'task-image-1',
        signal: controller.signal,
      })
    );
  });

  it.each(['GET', 'HEAD', 'PUT'])(
    'does not treat %s as an image submission',
    async (method) => {
      const onSubmissionAttempt = vi.fn();

      await sendAdapterRequest(
        {
          baseUrl: 'https://api.example.com/v1',
          operation: 'image',
          apiKey: 'secret',
          requestId: 'task-image-1',
          onSubmissionAttempt,
        },
        {
          path: '/images/generations',
          method,
        }
      );

      expect(mocks.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ requestId: undefined })
      );
      expect(onSubmissionAttempt).not.toHaveBeenCalled();
    }
  );

  it('forwards the same task ID to image edit submissions', async () => {
    await sendAdapterRequest(
      {
        baseUrl: 'https://api.example.com/v1',
        operation: 'image',
        apiKey: 'secret',
        requestId: 'task-image-edit-1',
      },
      {
        path: '/images/edits',
        method: 'POST',
        body: new FormData(),
      }
    );

    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ requestId: 'task-image-edit-1' })
    );
  });

  it.each([
    ['synchronous binding', undefined, undefined, true],
    ['polling binding', '/tasks/{taskId}', undefined, false],
    ['explicit override', undefined, false, false],
  ])(
    'sets image submission recovery for %s',
    async (_label, pollPathTemplate, requestOverride, expected) => {
      await sendAdapterRequest(createImageContext(pollPathTemplate), {
        path: '/images/generations',
        method: 'POST',
        body: '{}',
        allowImageSubmissionOutcomeRecovery: requestOverride,
      });

      expect(mocks.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          allowImageSubmissionOutcomeRecovery: expected,
        })
      );
    }
  );
});
