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

  it('does not reuse the generation request ID for polling GET requests', async () => {
    await sendAdapterRequest(
      {
        baseUrl: 'https://api.example.com/v1',
        operation: 'image',
        apiKey: 'secret',
        requestId: 'task-image-1',
      },
      {
        path: '/images/tasks/remote-1',
        method: 'GET',
      }
    );

    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ requestId: undefined })
    );
  });

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
});
