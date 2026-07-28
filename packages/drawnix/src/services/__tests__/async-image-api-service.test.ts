import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('../../utils/settings-manager', () => ({
  resolveInvocationRoute: vi.fn(() => ({
    profileId: 'runtime',
    profileName: 'Runtime',
    providerType: 'custom',
    baseUrl: 'https://gateway.example.com/v1',
    apiKey: 'secret',
  })),
}));

vi.mock('../provider-routing', () => ({
  resolveInvocationPlanFromRoute: vi.fn(() => null),
  providerTransport: {
    send: mocks.send,
  },
}));

describe('async-image-api-service', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('submits async image masks as multipart mask field', async () => {
    mocks.send.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'async-image-task-1',
          object: 'video',
          model: 'gpt-image-async',
          status: 'completed',
          progress: 100,
          created_at: 1,
          url: 'https://cdn.example.com/out.png',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'async-image-task-1',
          object: 'video',
          model: 'gpt-image-async',
          status: 'completed',
          progress: 100,
          created_at: 1,
          url: 'https://cdn.example.com/out.png',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const { asyncImageAPIService } = await import('../async-image-api-service');
    let resolveSubmissionAttempt!: () => void;
    const submissionAttempt = new Promise<void>((resolve) => {
      resolveSubmissionAttempt = resolve;
    });
    const onSubmissionAttempt = vi.fn(async () => submissionAttempt);
    let resolveSubmittedPersistence!: () => void;
    const submittedPersistence = new Promise<void>((resolve) => {
      resolveSubmittedPersistence = resolve;
    });
    const onSubmitted = vi.fn(async () => submittedPersistence);

    const generationPromise = asyncImageAPIService.generateWithPolling(
      {
        model: 'gpt-image-async',
        prompt: 'edit masked area',
        size: '1:1',
        referenceImages: ['data:image/png;base64,YWJj'],
        maskImage: 'data:image/png;base64,bWFzaw==',
      },
      {
        interval: 1,
        maxAttempts: 1,
        requestId: 'task-async-image-1',
        onSubmissionAttempt,
        onSubmitted,
      }
    );

    await vi.waitFor(() => expect(onSubmissionAttempt).toHaveBeenCalled());
    expect(mocks.send).not.toHaveBeenCalled();
    resolveSubmissionAttempt();
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(mocks.send).toHaveBeenCalledTimes(1);
    resolveSubmittedPersistence();
    await generationPromise;

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(onSubmitted).toHaveBeenCalledWith('async-image-task-1');
    const request = mocks.send.mock.calls[0]?.[1];
    expect(request.requestId).toBe('task-async-image-1');
    expect(request.body).toBeInstanceOf(FormData);
    const formData = request.body as FormData;
    expect(formData.get('input_reference')).toBeInstanceOf(Blob);
    expect(formData.get('mask')).toBeInstanceOf(Blob);
    expect(mocks.send.mock.calls[1]?.[1]?.requestId).toBeUndefined();
  });
});
