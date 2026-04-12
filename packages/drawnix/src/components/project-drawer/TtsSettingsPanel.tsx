import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input } from 'tdesign-react';
import { CheckIcon, RefreshIcon } from 'tdesign-icons-react';
import { Play, Square, Volume2 } from 'lucide-react';
import {
  ttsSettings,
  type TtsSettings,
} from '../../utils/settings-manager';

interface VoiceOption {
  uri: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

const DEFAULT_TTS_SETTINGS: TtsSettings = {
  selectedVoice: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  voicesByLanguage: {},
};

const TEST_TEXTS: Record<string, string> = {
  zh: '你好，这是一段测试语音。',
  en: 'Hello, this is a test speech.',
  ja: 'こんにちは、これはテスト音声です。',
  ko: '안녕하세요. 이것은 테스트 음성입니다.',
  fr: 'Bonjour, ceci est un test vocal.',
  de: 'Hallo, dies ist eine Sprachprobe.',
  es: 'Hola, esta es una prueba de voz.',
  ru: 'Привет, это тестовый голос.',
};

function normalizeSettings(settings?: TtsSettings | null): TtsSettings {
  return {
    ...DEFAULT_TTS_SETTINGS,
    ...(settings || {}),
    voicesByLanguage: settings?.voicesByLanguage || {},
  };
}

function getVoiceScore(voice: SpeechSynthesisVoice): number {
  let score = 0;
  if (voice.localService) score += 20;
  if (voice.default) score += 8;

  const name = voice.name.toLowerCase();
  if (
    name.includes('tingting') ||
    name.includes('婷婷') ||
    name.includes('samantha') ||
    name.includes('alex') ||
    name.includes('victoria') ||
    name.includes('daniel') ||
    name.includes('kyoko') ||
    name.includes('otoya')
  ) {
    score += 24;
  }

  if (
    name.includes('whisper') ||
    name.includes('zarvox') ||
    name.includes('bells') ||
    name.includes('boing') ||
    name.includes('bubbles')
  ) {
    score -= 30;
  }

  return score;
}

function getLanguageKey(lang: string): string {
  return lang.trim().toLowerCase().split('-')[0] || 'zh';
}

function getLanguageLabel(lang: string): string {
  const labels: Record<string, string> = {
    all: '全局默认',
    zh: '中文',
    en: '英语',
    ja: '日语',
    ko: '韩语',
    fr: '法语',
    de: '德语',
    es: '西语',
    ru: '俄语',
    it: '意语',
    pt: '葡语',
    ar: '阿拉伯语',
  };

  return labels[lang] || lang.toUpperCase();
}

function getTestText(lang: string): string {
  const languageKey = getLanguageKey(lang);
  return TEST_TEXTS[languageKey] || TEST_TEXTS.en;
}

function compareLanguages(left: string, right: string): number {
  const priority = ['zh', 'en'];
  const leftPriority = priority.indexOf(left);
  const rightPriority = priority.indexOf(right);

  if (leftPriority !== -1 || rightPriority !== -1) {
    if (leftPriority === -1) return 1;
    if (rightPriority === -1) return -1;
    return leftPriority - rightPriority;
  }

  return left.localeCompare(right);
}

function getSliderProgress(value: number, min: number, max: number): string {
  if (max <= min) {
    return '0%';
  }
  const ratio = ((value - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, ratio))}%`;
}

export const TtsSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<TtsSettings>(() =>
    normalizeSettings(ttsSettings.get())
  );
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('all');
  const [isPreviewing, setIsPreviewing] = useState(false);

  const loadVoices = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoices([]);
      return;
    }

    const availableVoices = window.speechSynthesis.getVoices();
    const nextVoices = availableVoices
      .map((voice) => ({
        uri: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        localService: voice.localService,
        default: voice.default,
      }))
      .sort((left, right) => {
        const scoreDiff =
          getVoiceScore(
            availableVoices.find((voice) => voice.voiceURI === right.uri) ||
              availableVoices[0]
          ) -
          getVoiceScore(
            availableVoices.find((voice) => voice.voiceURI === left.uri) ||
              availableVoices[0]
          );
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return left.name.localeCompare(right.name);
      });

    setVoices(nextVoices);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    let retryCount = 0;
    let retryTimer: number | null = null;
    const maxRetries = 6;

    const reloadVoices = () => {
      loadVoices();
      if (window.speechSynthesis.getVoices().length === 0 && retryCount < maxRetries) {
        retryCount += 1;
        retryTimer = window.setTimeout(reloadVoices, 120);
      }
    };

    reloadVoices();
    window.speechSynthesis.onvoiceschanged = reloadVoices;

    const handleSettingsChange = (nextSettings: TtsSettings) => {
      setSettings(normalizeSettings(nextSettings));
    };
    ttsSettings.addListener(handleSettingsChange);

    return () => {
      ttsSettings.removeListener(handleSettingsChange);
      window.speechSynthesis.onvoiceschanged = null;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      window.speechSynthesis.cancel();
    };
  }, [loadVoices]);

  const availableLanguages = useMemo(() => {
    const languageSet = new Set<string>();
    voices.forEach((voice) => {
      languageSet.add(getLanguageKey(voice.lang));
    });
    return ['all', ...Array.from(languageSet).sort(compareLanguages)];
  }, [voices]);

  const filteredVoices = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return voices.filter((voice) => {
      const matchesLanguage =
        selectedLanguage === 'all' ||
        getLanguageKey(voice.lang) === selectedLanguage;
      const matchesQuery =
        !normalizedQuery ||
        voice.name.toLowerCase().includes(normalizedQuery) ||
        voice.lang.toLowerCase().includes(normalizedQuery);
      return matchesLanguage && matchesQuery;
    });
  }, [searchQuery, selectedLanguage, voices]);

  const selectedVoiceUri =
    selectedLanguage === 'all'
      ? settings.selectedVoice || ''
      : settings.voicesByLanguage?.[selectedLanguage] || '';

  const persistSettings = useCallback(async (nextSettings: TtsSettings) => {
    setSettings(nextSettings);
    await ttsSettings.update(nextSettings);
  }, []);

  const updateVoiceSelection = useCallback(
    async (voiceUri: string) => {
      if (selectedLanguage === 'all') {
        await persistSettings({
          ...settings,
          selectedVoice: voiceUri,
        });
        return;
      }

      await persistSettings({
        ...settings,
        voicesByLanguage: {
          ...(settings.voicesByLanguage || {}),
          [selectedLanguage]: voiceUri,
        },
      });
    },
    [persistSettings, selectedLanguage, settings]
  );

  const handleSliderChange = useCallback(
    async (field: 'rate' | 'pitch' | 'volume', value: number) => {
      await persistSettings({
        ...settings,
        [field]: value,
      });
    },
    [persistSettings, settings]
  );

  const handleResetLanguage = useCallback(async () => {
    if (selectedLanguage === 'all') {
      await persistSettings({
        ...settings,
        selectedVoice: '',
      });
      return;
    }

    const nextVoicesByLanguage = { ...(settings.voicesByLanguage || {}) };
    delete nextVoicesByLanguage[selectedLanguage];
    await persistSettings({
      ...settings,
      voicesByLanguage: nextVoicesByLanguage,
    });
  }, [persistSettings, selectedLanguage, settings]);

  const handlePreview = useCallback(
    (voiceUri: string, lang: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
      }

      if (isPreviewing) {
        window.speechSynthesis.cancel();
        setIsPreviewing(false);
        return;
      }

      const targetVoice = window.speechSynthesis
        .getVoices()
        .find((voice) => voice.voiceURI === voiceUri);
      if (!targetVoice) {
        return;
      }

      const utterance = new SpeechSynthesisUtterance(getTestText(lang));
      utterance.voice = targetVoice;
      utterance.lang = targetVoice.lang;
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;
      utterance.volume = settings.volume;
      utterance.onstart = () => setIsPreviewing(true);
      utterance.onend = () => setIsPreviewing(false);
      utterance.onerror = () => setIsPreviewing(false);

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [isPreviewing, settings.pitch, settings.rate, settings.volume]
  );

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return (
      <div className="project-drawer-tts project-drawer-tts--empty">
        当前环境不支持浏览器语音播报。
      </div>
    );
  }

  return (
    <div className="project-drawer-tts">
      <div className="project-drawer-tts__section">
        <div className="project-drawer-tts__section-title">
          <Volume2 size={16} />
          <span>播报参数</span>
        </div>
        <div className="project-drawer-tts__hint">使用浏览器自带能力，免费。</div>
        <label className="project-drawer-tts__slider">
          <span className="project-drawer-tts__slider-label">语速</span>
          <input
            className="project-drawer-tts__range"
            style={
              {
                '--slider-progress': getSliderProgress(settings.rate, 0.5, 10),
              } as React.CSSProperties
            }
            type="range"
            min="0.5"
            max="10"
            step="0.1"
            value={settings.rate}
            onChange={(event) =>
              void handleSliderChange('rate', Number(event.target.value))
            }
          />
          <strong className="project-drawer-tts__slider-value">
            {settings.rate.toFixed(1)}x
          </strong>
        </label>
        <label className="project-drawer-tts__slider">
          <span className="project-drawer-tts__slider-label">音调</span>
          <input
            className="project-drawer-tts__range"
            style={
              {
                '--slider-progress': getSliderProgress(settings.pitch, 0.5, 2),
              } as React.CSSProperties
            }
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.pitch}
            onChange={(event) =>
              void handleSliderChange('pitch', Number(event.target.value))
            }
          />
          <strong className="project-drawer-tts__slider-value">
            {settings.pitch.toFixed(1)}
          </strong>
        </label>
        <label className="project-drawer-tts__slider">
          <span className="project-drawer-tts__slider-label">音量</span>
          <input
            className="project-drawer-tts__range"
            style={
              {
                '--slider-progress': getSliderProgress(settings.volume, 0, 1),
              } as React.CSSProperties
            }
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.volume}
            onChange={(event) =>
              void handleSliderChange('volume', Number(event.target.value))
            }
          />
          <strong className="project-drawer-tts__slider-value">
            {Math.round(settings.volume * 100)}%
          </strong>
        </label>
      </div>

      <div className="project-drawer-tts__section">
        <div className="project-drawer-tts__toolbar">
          <div className="project-drawer-tts__filters">
            <div className="project-drawer-tts__chips">
              {availableLanguages.map((language) => (
                <button
                  key={language}
                  type="button"
                  className={`project-drawer-tts__chip${
                    selectedLanguage === language
                      ? ' project-drawer-tts__chip--active'
                      : ''
                  }`}
                  onClick={() => setSelectedLanguage(language)}
                >
                  {getLanguageLabel(language)}
                </button>
              ))}
            </div>
            <Input
              value={searchQuery}
              size="small"
              placeholder="搜索音色或语言"
              onChange={setSearchQuery}
            />
          </div>
          <div className="project-drawer-tts__toolbar-actions">
            <Button
              size="small"
              variant="outline"
              icon={<RefreshIcon />}
              onClick={loadVoices}
            >
              刷新
            </Button>
            <Button size="small" variant="text" onClick={() => void handleResetLanguage()}>
              {selectedLanguage === 'all' ? '清空默认音色' : '改回全局默认'}
            </Button>
          </div>
        </div>

        <div className="project-drawer-tts__hint">
          {selectedLanguage === 'all'
            ? '全局默认会作为所有 TTS 入口的首选音色。'
            : `${getLanguageLabel(selectedLanguage)} 可单独覆盖音色，未设置时回退到全局默认。`}
        </div>

        {filteredVoices.length === 0 ? (
          <div className="project-drawer-tts__empty">
            未找到可用音色，请确认系统已安装语音包。
          </div>
        ) : (
          <div className="project-drawer-tts__voice-list">
            {filteredVoices.map((voice) => {
              const isSelected = selectedVoiceUri === voice.uri;
              return (
                <div
                  key={voice.uri}
                  className={`project-drawer-tts__voice${
                    isSelected ? ' project-drawer-tts__voice--active' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => void updateVoiceSelection(voice.uri)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void updateVoiceSelection(voice.uri);
                    }
                  }}
                >
                  <div className="project-drawer-tts__voice-main">
                    <div className="project-drawer-tts__voice-title">
                      <span>{voice.name}</span>
                      {isSelected && <CheckIcon size="12px" />}
                    </div>
                    <div className="project-drawer-tts__voice-meta">
                      <span>{voice.lang}</span>
                      {voice.localService && <span>本地</span>}
                      {voice.default && <span>系统默认</span>}
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="text"
                    theme="default"
                    icon={isPreviewing ? <Square size={14} /> : <Play size={14} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlePreview(voice.uri, voice.lang);
                    }}
                  >
                    试听
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
