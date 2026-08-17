import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveInvocationPlanFromRoute: vi.fn(),
  listSettingsProviderProfiles: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../provider-routing', () => ({
  resolveInvocationPlanFromRoute: mocks.resolveInvocationPlanFromRoute,
  listSettingsProviderProfiles: mocks.listSettingsProviderProfiles,
  providerTransport: { send: mocks.send },
}));

// eslint-disable-next-line import/first
import {
  generateSpeechAudio,
  SpeechProviderError,
} from '../tts-speech-service';

describe('tts-speech-service', () => {
  beforeEach(() => {
    mocks.resolveInvocationPlanFromRoute.mockReset();
    mocks.listSettingsProviderProfiles.mockReset();
    mocks.listSettingsProviderProfiles.mockReturnValue([]);
    mocks.send.mockReset();
    mocks.resolveInvocationPlanFromRoute.mockReturnValue({
      provider: {
        profileId: 'provider-a',
        profileName: 'Provider A',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
      modelRef: { profileId: 'provider-a', modelId: 'tts-model' },
      binding: {
        id: 'tts-binding',
        profileId: 'provider-a',
        modelId: 'tts-model',
        operation: 'audio',
        protocol: 'openai.audio.speech',
        requestSchema: 'openai.audio.speech.json',
        responseSchema: 'openai.audio.speech.audio',
        submitPath: '/audio/speech',
        priority: 900,
        confidence: 'high',
        source: 'manual',
      },
    });
  });

  it('submits OpenAI-compatible speech JSON and returns binary audio', async () => {
    mocks.send.mockResolvedValue(
      new Response(new Blob(['audio'], { type: 'audio/mpeg' }), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    );

    const result = await generateSpeechAudio({
      model: { profileId: 'provider-a', modelId: 'tts-model' },
      text: '  你好  ',
      voice: ' voice-a ',
      speed: 1.1,
      fetcher: vi.fn(),
    });

    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.mimeType).toBe('audio/mpeg');
    expect(mocks.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        path: '/audio/speech',
        method: 'POST',
        body: JSON.stringify({
          model: 'tts-model',
          input: '你好',
          voice: 'voice-a',
          response_format: 'mp3',
          speed: 1.1,
        }),
      })
    );
  });

  it('rejects an ordinary audio binding before requesting', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue({
      provider: { baseUrl: 'https://api.example.com', apiKey: 'secret' },
      modelRef: { profileId: 'provider-a', modelId: 'suno' },
      binding: {
        protocol: 'tuzi.suno.music',
        requestSchema: 'tuzi.suno.music.submit',
      },
    });

    await expect(
      generateSpeechAudio({
        model: 'suno',
        text: '你好',
        voice: 'voice-a',
      })
    ).rejects.toThrow(SpeechProviderError);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('uses the built-in speech route on an existing provider account', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(null);
    mocks.listSettingsProviderProfiles.mockReturnValue([
      {
        id: 'provider-a',
        name: 'Provider A',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        authType: 'bearer',
      },
    ]);
    mocks.send.mockResolvedValue(
      new Response(new Blob(['audio'], { type: 'audio/mpeg' }), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    );

    await generateSpeechAudio({
      model: {
        profileId: 'provider-a',
        modelId: 'gpt-4o-mini-tts',
      },
      text: '你好',
      voice: 'alloy',
    });

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'provider-a' }),
      expect.objectContaining({ path: '/audio/speech' })
    );
  });

  it('rejects JSON success responses as invalid audio', async () => {
    mocks.send.mockResolvedValue(
      Response.json({ url: 'https://example.com/audio.mp3' })
    );

    await expect(
      generateSpeechAudio({
        model: 'tts-model',
        text: '你好',
        voice: 'voice-a',
      })
    ).rejects.toThrow('不是音频二进制');
  });
});
