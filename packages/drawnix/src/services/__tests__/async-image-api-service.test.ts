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

    await asyncImageAPIService.generateWithPolling(
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
      }
    );

    expect(mocks.send).toHaveBeenCalledTimes(2);
    const request = mocks.send.mock.calls[0]?.[1];
    expect(request.body).toBeInstanceOf(FormData);
    const formData = request.body as FormData;
    expect(formData.get('input_reference')).toBeInstanceOf(Blob);
    expect(formData.get('mask')).toBeInstanceOf(Blob);
  });

  it('waits for remote ID persistence before polling', async () => {
    let releasePersistence!: () => void;
    const persistenceBarrier = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    mocks.send
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'async-image-task-2',
            object: 'video',
            model: 'gpt-image-async',
            status: 'queued',
            progress: 0,
            created_at: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'async-image-task-2',
            object: 'video',
            model: 'gpt-image-async',
            status: 'completed',
            progress: 100,
            created_at: 1,
            url: 'https://cdn.example.com/out.png',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const { asyncImageAPIService } = await import('../async-image-api-service');
    const generation = asyncImageAPIService.generateWithPolling(
      { model: 'gpt-image-async', prompt: 'test' },
      {
        interval: 1,
        maxAttempts: 1,
        onSubmitted: () => persistenceBarrier,
      }
    );

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mocks.send).toHaveBeenCalledTimes(1);

    releasePersistence();
    await generation;
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
