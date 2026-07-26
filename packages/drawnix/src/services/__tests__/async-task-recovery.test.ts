import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  resolvePlan: vi.fn(),
}));

vi.mock('../provider-routing', () => ({
  canAttachProviderRequestIdHeader: vi.fn(() => true),
  providerTransport: { send: mocks.send },
  resolveInvocationPlanFromRoute: mocks.resolvePlan,
}));

describe('async task recovery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('recovers a remote task ID from the provider request log', async () => {
    mocks.resolvePlan.mockReturnValue({
      provider: {
        profileId: 'tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      binding: { id: 'video-binding' },
    });
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          response: JSON.stringify({
            id: 'remote-video-1',
            status: 'queued',
          }),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { recoverAsyncSubmissionByRequestId } = await import(
      '../async-task-recovery'
    );
    const result = await recoverAsyncSubmissionByRequestId(
      'video',
      { profileId: 'tuzi', modelId: 'veo3' },
      'client-request-1',
      { bindingId: 'video-binding' }
    );

    expect(result.remoteId).toBe('remote-video-1');
    expect(mocks.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        path: '/log/get-request',
        query: { id: 'client-request-1' },
        baseUrlStrategy: 'trim-v1',
      })
    );
  });

  it('returns a completed media URL without resubmitting', async () => {
    mocks.resolvePlan.mockReturnValue({
      provider: {
        profileId: 'tuzi',
        profileName: 'Tuzi',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      binding: { id: 'video-binding' },
    });
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'succeeded',
          data: [{ video_url: 'https://cdn.example.com/video.mp4' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { recoverAsyncSubmissionByRequestId } = await import(
      '../async-task-recovery'
    );
    const result = await recoverAsyncSubmissionByRequestId(
      'video',
      { profileId: 'tuzi', modelId: 'veo3' },
      'client-request-2'
    );

    expect(result.url).toBe('https://cdn.example.com/video.mp4');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
