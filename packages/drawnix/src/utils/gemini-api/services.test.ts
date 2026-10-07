import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateImageDirect, normalizeAspectRatio, sendChatWithGemini } from './services';

const mocks = vi.hoisted(() => ({
  callApiWithRetry: vi.fn(),
  callGoogleGenerateContentRaw: vi.fn(),
}));

vi.mock('./apiCalls', () => ({
  callApiWithRetry: mocks.callApiWithRetry,
  callApiStreamRaw: vi.fn(),
  callGoogleGenerateContentRaw: mocks.callGoogleGenerateContentRaw,
  callVideoApiStreamRaw: vi.fn(),
}));

vi.mock('../settings-manager', () => ({
  resolveInvocationRoute: vi.fn(() => ({
    apiKey: 'secret',
    baseUrl: 'https://api.example.com',
    modelId: 'text-model',
    providerType: 'custom',
  })),
  settingsManager: {
    waitForInitialization: vi.fn(async () => undefined),
  },
}));

vi.mock('../../services/provider-routing', () => ({
  providerTransport: { send: vi.fn() },
  readProviderResponseJson: vi.fn(),
  readProviderResponseText: vi.fn(),
  resolveInvocationPlanFromRoute: vi.fn(() => null),
}));

vi.mock('./auth', () => ({
  validateAndEnsureConfig: vi.fn(async (config) => config),
}));

vi.mock('../../services/media-executor/llm-api-logger', () => ({
  startLLMApiLog: vi.fn(() => 'log-1'),
  completeLLMApiLog: vi.fn(),
  failLLMApiLog: vi.fn(),
}));

describe('normalizeAspectRatio', () => {
  it('preserves canonical Gemini aspect ratio enums', () => {
    expect(normalizeAspectRatio('21x9')).toBe('21:9');
    expect(normalizeAspectRatio('16x9')).toBe('16:9');
    expect(normalizeAspectRatio('9x16')).toBe('9:16');
  });

  it('normalizes pixel sizes to reduced aspect ratios', () => {
    expect(normalizeAspectRatio('1280x720')).toBe('16:9');
    expect(normalizeAspectRatio('1024x1792')).toBe('4:7');
  });

  it('returns ratio strings as-is', () => {
    expect(normalizeAspectRatio('21:9')).toBe('21:9');
    expect(normalizeAspectRatio('auto')).toBeUndefined();
  });
});

describe('Nano Banana 2.1 generateContent', () => {
  const config = {
    baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test-key',
    modelName: 'gemini-nano-banana-2.1', protocol: 'google.generateContent' as const,
  };
  beforeEach(() => {
    mocks.callGoogleGenerateContentRaw.mockReset();
    mocks.callGoogleGenerateContentRaw.mockResolvedValue({
      choices: [{ message: { content: 'https://example.com/final.jpg' } }],
    });
  });

  it('forwards 14 references, resolution, extreme ratio and Thinking', async () => {
    const images = Array.from({ length: 14 }, (_, i) => `https://example.com/ref-${i}.png`);
    const result = await generateImageDirect('edit', {
      image: images, size: '1x8', quality: '4k', thinking: 'high',
    }, config.modelName, undefined, config);
    const [, messages, options] = mocks.callGoogleGenerateContentRaw.mock.calls[0];
    expect(messages[0].content).toHaveLength(15);
    expect(options.generationConfig).toEqual({
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:8', imageSize: '4K' },
      thinkingConfig: { thinkingLevel: 'high' },
    });
    expect(result.data).toEqual([{ url: 'https://example.com/final.jpg' }]);
  });

  it('defaults to medium Thinking and 1K, omitting auto aspect ratio', async () => {
    await generateImageDirect('draw', { size: 'auto' }, config.modelName, undefined, config);
    expect(mocks.callGoogleGenerateContentRaw.mock.calls[0][2].generationConfig).toEqual({
      responseModalities: ['IMAGE'], imageConfig: { imageSize: '1K' },
      thinkingConfig: { thinkingLevel: 'medium' },
    });
  });

  it('rejects excess references and unsupported parameters before submission', async () => {
    await expect(generateImageDirect('edit', {
      image: Array(15).fill('https://example.com/ref.png'),
    }, config.modelName, undefined, config)).rejects.toThrow('14');
    await expect(generateImageDirect('draw', {
      quality: '512' as '1k',
    }, config.modelName, undefined, config)).rejects.toThrow('分辨率');
    await expect(generateImageDirect('draw', {
      thinking: 'low' as 'minimal',
    }, config.modelName, undefined, config)).rejects.toThrow('Thinking');
    expect(mocks.callGoogleGenerateContentRaw).not.toHaveBeenCalled();
  });

  it('preserves inline JPEG MIME and keeps Thinking out of older models', async () => {
    mocks.callGoogleGenerateContentRaw.mockResolvedValue({
      choices: [{ message: { content: 'data:image/jpeg;base64,AAAA' } }],
    });
    const result = await generateImageDirect('draw', { thinking: 'high' },
      'gemini-3.1-flash-image-preview', undefined, config);
    expect(result.data[0].url).toBe('data:image/jpeg;base64,AAAA');
    expect(mocks.callGoogleGenerateContentRaw.mock.calls[0][2].generationConfig)
      .not.toHaveProperty('thinkingConfig');
  });
});

describe('sendChatWithGemini', () => {
  beforeEach(() => {
    mocks.callApiWithRetry.mockReset();
    mocks.callApiWithRetry.mockResolvedValue({
      choices: [
        {
          message: { role: 'assistant', content: '{"title":"outline"}' },
        },
      ],
    });
  });

  it('forwards AbortSignal to non-stream text requests', async () => {
    const controller = new AbortController();
    const messages = [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'build a PPT outline' }],
      },
    ];

    await sendChatWithGemini(
      messages,
      undefined,
      controller.signal,
      'text-model'
    );

    expect(mocks.callApiWithRetry).toHaveBeenCalledWith(
      expect.any(Object),
      messages,
      controller.signal
    );
  });
});
