import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  submitVideoGeneration,
  generateVideo,
  pollVideoUntilComplete,
  VideoGenerationFailedError,
} from './video-api';
import { toGenerationTaskError } from '../../utils/generation-error-details';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../provider-routing/provider-transport', () => ({
  providerTransport: { send },
}));
beforeEach(() => send.mockReset());
const config = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-only',
  defaultModel: 'video-model',
};

describe('video provider diagnostics', () => {
  it('keeps header-only request IDs, status, code and model on submission failure', async () => {
    send.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'model_not_found', message: 'Model not found' },
        }),
        { status: 404, headers: { 'x-request-id': 'submit-id' } }
      )
    );
    const error = await submitVideoGeneration(
      { model: 'video-model', prompt: 'test' },
      config
    ).catch((error) => error);
    expect(toGenerationTaskError(error, 'VIDEO_FAILED').details).toMatchObject({
      requestId: 'submit-id',
      httpStatus: 404,
      apiErrorCode: 'model_not_found',
      modelId: 'video-model',
    });
  });
  it('retains the remote task and failing polling request without retrying business failure', async () => {
    send.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'failed',
          error: {
            code: 'policy',
            message: 'Rejected (request id: poll-provider)',
          },
        }),
        { headers: { 'x-request-id': 'gateway' } }
      )
    );
    const error = await pollVideoUntilComplete('remote-video', config, {
      interval: 1,
    }).catch((error) => error);
    expect(error).toBeInstanceOf(VideoGenerationFailedError);
    expect(toGenerationTaskError(error, 'VIDEO_FAILED').details).toMatchObject({
      requestId: 'poll-provider',
      remoteId: 'remote-video',
      modelId: 'video-model',
      apiErrorCode: 'policy',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

it('reports the submission ID separately while preserving the submit return type', async () => {
  send.mockResolvedValue(
    new Response(JSON.stringify({ id: 'remote-video', status: 'queued' }), {
      headers: { 'x-oneapi-request-id': 'site-submit' },
    })
  );
  const capture = vi.fn();
  expect(
    await submitVideoGeneration(
      { model: 'video-model', prompt: 'test' },
      config,
      undefined,
      capture
    )
  ).toBe('remote-video');
  expect(capture).toHaveBeenCalledWith('site-submit');
});

it('carries the original submission ID through generic video generation failure', async () => {
  send
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'remote-video', status: 'queued' }), {
        headers: { 'x-oneapi-request-id': 'site-submit' },
      })
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'failed',
          error: { message: 'Denied (request id: upstream-id)' },
        }),
        {
          headers: { 'x-oneapi-request-id': 'poll-only' },
        }
      )
    );
  const error = await generateVideo(
    { model: 'video-model', prompt: 'test' },
    config
  ).catch((error) => error);
  expect(toGenerationTaskError(error, 'VIDEO_FAILED').details).toMatchObject({
    apiRequestId: 'site-submit',
    remoteId: 'remote-video',
  });
});
