import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAspectRatio, sendChatWithGemini } from './services';

const mocks = vi.hoisted(() => ({
  callApiWithRetry: vi.fn(),
}));

vi.mock('./apiCalls', () => ({
  callApiWithRetry: mocks.callApiWithRetry,
  callApiStreamRaw: vi.fn(),
  callGoogleGenerateContentRaw: vi.fn(),
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
