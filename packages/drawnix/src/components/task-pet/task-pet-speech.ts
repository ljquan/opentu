import { inferSpeechLanguage, resolveVoice } from '../../hooks/useTextToSpeech';
import { ttsSettings } from '../../utils/settings-manager';

export function speakTaskPetMessage(message: string): boolean {
  const text = message.trim();
  if (!text || typeof window === 'undefined') {
    return false;
  }

  const synthesis = window.speechSynthesis;
  if (
    !synthesis ||
    typeof SpeechSynthesisUtterance === 'undefined' ||
    synthesis.speaking ||
    synthesis.pending ||
    synthesis.paused
  ) {
    return false;
  }

  try {
    const settings = ttsSettings.get();
    const language = inferSpeechLanguage(text);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;

    const voice = resolveVoice(synthesis.getVoices(), settings, language);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.onerror = () => undefined;
    synthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
