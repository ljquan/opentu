// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { speakTaskPetMessage } from './task-pet-speech';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  inferLanguage: vi.fn(() => 'zh-CN'),
  resolveVoice: vi.fn(),
}));

vi.mock('../../utils/settings-manager', () => ({
  ttsSettings: { get: mocks.getSettings },
}));

vi.mock('../../hooks/useTextToSpeech', () => ({
  inferSpeechLanguage: mocks.inferLanguage,
  resolveVoice: mocks.resolveVoice,
}));

class MockUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onerror: (() => void) | null = null;

  constructor(public text: string) {}
}

describe('speakTaskPetMessage', () => {
  const speak = vi.fn();
  const cancel = vi.fn();
  const voice = { voiceURI: 'voice-1', lang: 'zh-CN' } as SpeechSynthesisVoice;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockReturnValue({
      selectedVoice: 'voice-1',
      rate: 1.2,
      pitch: 0.9,
      volume: 0.8,
      voicesByLanguage: {},
    });
    mocks.resolveVoice.mockReturnValue(voice);
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        paused: false,
        getVoices: () => [voice],
        speak,
        cancel,
      },
    });
  });

  it('uses existing TTS parameters and voice without cancelling global speech', () => {
    expect(speakTaskPetMessage('生图任务已完成')).toBe(true);
    const utterance = speak.mock.calls[0][0] as MockUtterance;
    expect(utterance).toMatchObject({
      text: '生图任务已完成',
      lang: 'zh-CN',
      rate: 1.2,
      pitch: 0.9,
      volume: 0.8,
      voice,
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('skips speech when the shared synthesizer is busy', () => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: true,
        pending: false,
        paused: false,
        speak,
        cancel,
      },
    });

    expect(speakTaskPetMessage('任务完成')).toBe(false);
    expect(speak).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('silently degrades when playback throws', () => {
    speak.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(speakTaskPetMessage('任务失败')).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('silently degrades when speech synthesis is unsupported', () => {
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);
    expect(speakTaskPetMessage('任务完成')).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });
});
