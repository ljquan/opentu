import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, analyticsMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  analyticsMock: {
    trackAPICallStart: vi.fn(),
    trackAPICallSuccess: vi.fn(),
    trackAPICallFailure: vi.fn(),
  },
}));

vi.mock('../../services/provider-routing', () => ({
  providerTransport: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}));

vi.mock('../posthog-analytics', () => ({
  analytics: analyticsMock,
}));

import { callGoogleGenerateContentRaw } from './apiCalls';

describe('callGoogleGenerateContentRaw', () => {
  beforeEach(() => {
    sendMock.mockReset();
    analyticsMock.trackAPICallStart.mockReset();
    analyticsMock.trackAPICallSuccess.mockReset();
    analyticsMock.trackAPICallFailure.mockReset();

    sendMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'ok' }],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
  });

  it('normalizes legacy generateContent paths missing the models segment', async () => {
    await callGoogleGenerateContentRaw(
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com',
        modelName: 'gemini-3.1-flash-image-preview-4k',
        protocol: 'google.generateContent',
        authType: 'query',
        binding: {
          id: 'binding',
          profileId: 'provider-a',
          modelId: 'gemini-3.1-flash-image-preview-4k',
          operation: 'image',
          protocol: 'google.generateContent',
          requestSchema: 'google.generate-content.image-inline',
          responseSchema: 'google.generate-content.parts',
          submitPath: '/v1beta/{model}:generateContent',
          baseUrlStrategy: 'trim-v1',
          priority: 100,
          confidence: 'high',
          source: 'manual',
        },
      },
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'draw a cat' }],
        },
      ],
      { stream: false }
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.example.com',
      }),
      expect.objectContaining({
        path: '/v1beta/models/gemini-3.1-flash-image-preview-4k:generateContent',
        baseUrlStrategy: 'trim-v1',
        method: 'POST',
      })
    );
  });
});
