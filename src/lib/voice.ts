import type { LanguageCode } from '../types.ts';

export interface LanguageMeta {
  code: LanguageCode;
  bcp47: string;
  nativeLabel: string;
  englishName: string;
}

export const LANGUAGES: Record<LanguageCode, LanguageMeta> = {
  kn: {
    code: 'kn',
    bcp47: 'kn-IN',
    nativeLabel: 'ಕನ್ನಡ',
    englishName: 'Kannada',
  },
  en: {
    code: 'en',
    bcp47: 'en-IN',
    nativeLabel: 'English',
    englishName: 'English',
  },
  hi: {
    code: 'hi',
    bcp47: 'hi-IN',
    nativeLabel: 'हिन्दी',
    englishName: 'Hindi',
  },
};

export interface VoiceMatchResult {
  supported: boolean;
  available: boolean;
  voice: SpeechSynthesisVoice | null;
  exactLocaleMatch: boolean;
}

function scoreVoice(voice: SpeechSynthesisVoice, targetBcp47: string): number {
  const lang = voice.lang.toLowerCase().replace('_', '-');
  const target = targetBcp47.toLowerCase();
  const prefix = target.split('-')[0];
  let score = 0;

  if (lang === target) {
    score += 100;
  } else if (lang.startsWith(`${prefix}-`) || lang === prefix) {
    score += 50;
  } else {
    return -1;
  }

  const name = voice.name.toLowerCase();
  if (name.includes('natural') || name.includes('google') || name.includes('neural')) {
    score += 20;
  }
  if (!voice.localService) {
    score += 5;
  }
  return score;
}

export function matchVoiceForLanguage(
  voices: SpeechSynthesisVoice[],
  lang: LanguageCode
): VoiceMatchResult {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return {
      supported: false,
      available: false,
      voice: null,
      exactLocaleMatch: false,
    };
  }

  const target = LANGUAGES[lang].bcp47;
  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -1;

  for (const voice of voices) {
    const s = scoreVoice(voice, target);
    if (s > bestScore) {
      bestScore = s;
      bestVoice = voice;
    }
  }

  if (!bestVoice) {
    return {
      supported: true,
      available: false,
      voice: null,
      exactLocaleMatch: false,
    };
  }

  const normalizedVoiceLang = bestVoice.lang.toLowerCase().replace('_', '-');
  return {
    supported: true,
    available: true,
    voice: bestVoice,
    exactLocaleMatch: normalizedVoiceLang === target.toLowerCase(),
  };
}

export function stopSpeechPlayback(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function speakPreviewText(options: {
  text: string;
  lang: LanguageCode;
  rate?: number;
  pitch?: number;
  voices?: SpeechSynthesisVoice[];
  onStart?: () => void;
  onEnd?: () => void;
  onUnavailable?: (message: string) => void;
}): boolean {
  const { text, lang, rate = 0.95, pitch = 1.0, voices, onStart, onEnd, onUnavailable } = options;
  const trimmed = text.trim();
  const meta = LANGUAGES[lang];

  if (!trimmed) {
    onUnavailable?.(`Please enter ${meta.englishName} instruction text to test voice playback.`);
    return false;
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onUnavailable?.(
      `${meta.englishName} (${meta.bcp47}) voice playback is not supported in this browser.`
    );
    return false;
  }

  const availableVoices =
    voices && voices.length > 0 ? voices : window.speechSynthesis.getVoices();
  const match = matchVoiceForLanguage(availableVoices, lang);

  if (!match.available || !match.voice) {
    onUnavailable?.(
      `${meta.englishName} (${meta.bcp47}) voice is unavailable on this device or browser.`
    );
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.voice = match.voice;
  utterance.lang = meta.bcp47;
  utterance.rate = Math.min(2.0, Math.max(0.5, rate));
  utterance.pitch = Math.min(2.0, Math.max(0.5, pitch));
  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  onStart?.();
  window.speechSynthesis.speak(utterance);
  return true;
}
