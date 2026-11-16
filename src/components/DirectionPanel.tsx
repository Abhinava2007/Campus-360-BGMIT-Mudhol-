import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Square,
  TrendingUp,
  Volume2,
} from 'lucide-react';
import { LANGUAGES, matchVoiceForLanguage } from '../lib/voice.ts';
import type {
  LanguageCode,
  RoomWithDirections,
  RouteStep,
  StepActionType,
  VoiceSettings,
} from '../types.ts';

interface DirectionPanelProps {
  room: RoomWithDirections;
  language: LanguageCode;
  voiceSettings: VoiceSettings;
  onLanguageChange: (lang: LanguageCode) => void;
  onBack?: () => void;
}

type VoiceStatus = 'idle' | 'speaking' | 'paused' | 'completed';

const LANGUAGE_ORDER: LanguageCode[] = ['kn', 'en', 'hi'];

const UI_LABELS: Record<
  LanguageCode,
  {
    roomNumber: string;
    department: string;
    floor: string;
    startingLocation: string;
    directionsHeading: string;
    missingDirections: string;
    voiceNavigation: string;
    startNav: string;
    pauseVoice: string;
    resumeVoice: string;
    stopNav: string;
    repeatInstr: string;
    currentStep: string;
    voiceUnavailable: (langName: string, bcp47: string) => string;
    readyPrompt: string;
    pausedStatus: string;
    completedStatus: string;
  }
> = {
  en: {
    roomNumber: 'Room Number',
    department: 'Department',
    floor: 'Floor',
    startingLocation: 'Starting Location',
    directionsHeading: 'Step-by-Step Directions',
    missingDirections: 'Directions are not available for this location yet.',
    voiceNavigation: 'Voice Navigation',
    startNav: 'Start Navigation',
    pauseVoice: 'Pause Voice',
    resumeVoice: 'Resume Voice',
    stopNav: 'Stop Navigation',
    repeatInstr: 'Repeat Instruction',
    currentStep: 'Current Instruction',
    voiceUnavailable: (langName, bcp47) =>
      `${langName} (${bcp47}) voice is not available on this device or browser. Written directions remain displayed in ${langName}.`,
    readyPrompt: 'Press Start Navigation to hear step-by-step voice guidance.',
    pausedStatus: 'Voice playback paused.',
    completedStatus: 'You have reached the end of the directions.',
  },
  kn: {
    roomNumber: 'ಕೊಠಡಿ ಸಂಖ್ಯೆ',
    department: 'ವಿಭಾಗ',
    floor: 'ಮಹಡಿ',
    startingLocation: 'ಪ್ರಾರಂಭ ಸ್ಥಳ',
    directionsHeading: 'ಹಂತ-ಹಂತದ ಮಾರ್ಗದರ್ಶನ',
    missingDirections: 'Directions are not available for this location yet.',
    voiceNavigation: 'ಧ್ವನಿ ಮಾರ್ಗದರ್ಶನ',
    startNav: 'Start Navigation',
    pauseVoice: 'Pause Voice',
    resumeVoice: 'Resume Voice',
    stopNav: 'Stop Navigation',
    repeatInstr: 'Repeat Instruction',
    currentStep: 'ಪ್ರಸ್ತುತ ಸೂಚನೆ',
    voiceUnavailable: (langName, bcp47) =>
      `${langName} (${bcp47}) ಧ್ವನಿ ಈ ಬ್ರೌಸರ್ ಅಥವಾ ಸಾಧನದಲ್ಲಿ ಲಭ್ಯವಿಲ್ಲ. ಲಿಖಿತ ಮಾರ್ಗದರ್ಶನ ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿದಿದೆ.`,
    readyPrompt: 'ಧ್ವನಿ ಮಾರ್ಗದರ್ಶನ ಕೇಳಲು Start Navigation ಒತ್ತಿರಿ.',
    pausedStatus: 'ಧ್ವನಿ ವಿರಾಮಗೊಳಿಸಲಾಗಿದೆ.',
    completedStatus: 'ಮಾರ್ಗದರ್ಶನ ಪೂರ್ಣಗೊಂಡಿದೆ.',
  },
  hi: {
    roomNumber: 'कमरा संख्या',
    department: 'विभाग',
    floor: 'मंजिल',
    startingLocation: 'प्रारंभिक स्थान',
    directionsHeading: 'चरण-दर-चरण दिशा-निर्देश',
    missingDirections: 'Directions are not available for this location yet.',
    voiceNavigation: 'वॉइस नेविगेशन',
    startNav: 'Start Navigation',
    pauseVoice: 'Pause Voice',
    resumeVoice: 'Resume Voice',
    stopNav: 'Stop Navigation',
    repeatInstr: 'Repeat Instruction',
    currentStep: 'वर्तमान निर्देश',
    voiceUnavailable: (langName, bcp47) =>
      `${langName} (${bcp47}) आवाज़ इस डिवाइस या ब्राउज़र में उपलब्ध नहीं है। लिखित निर्देश हिन्दी में प्रदर्शित हैं।`,
    readyPrompt: 'वॉइस मार्गदर्शन सुनने के लिए Start Navigation दबाएँ।',
    pausedStatus: 'आवाज़ अस्थायी रूप से रोकी गई है।',
    completedStatus: 'दिशा-निर्देश पूरे हो गए हैं।',
  },
};

function getStepText(step: RouteStep, language: LanguageCode): string {
  if (language === 'kn') return step.instruction_kn;
  if (language === 'hi') return step.instruction_hi;
  return step.instruction_en;
}

function StepIcon({ type }: { type: StepActionType }) {
  switch (type) {
    case 'left':
      return <CornerUpLeft className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case 'right':
      return <CornerUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case 'stairs':
    case 'floor_change':
      return <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case 'destination':
      return <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />;
    default:
      return <ArrowUp className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
}

export function DirectionPanel({
  room,
  language,
  voiceSettings,
  onLanguageChange,
  onBack,
}: DirectionPanelProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const cancelReasonRef = useRef<'none' | 'pause' | 'stop' | 'replace'>('none');
  const timerRef = useRef<number | null>(null);
  const statusRef = useRef<VoiceStatus>('idle');
  const languageRef = useRef<LanguageCode>(language);

  const steps = useMemo(() => room.route?.steps ?? [], [room.route]);
  const labels = UI_LABELS[language];

  useEffect(() => {
    statusRef.current = voiceStatus;
  }, [voiceStatus]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoicesLoaded(true);
      return;
    }

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      setVoicesLoaded(true);
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  const voiceMatch = useMemo(() => {
    return matchVoiceForLanguage(voices, language);
  }, [voices, language]);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopSpeechEngine = useCallback(
    (reason: 'stop' | 'pause' | 'replace') => {
      clearPendingTimer();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        cancelReasonRef.current = reason;
        window.speechSynthesis.cancel();
      }
    },
    [clearPendingTimer]
  );

  // Reset navigation when room changes
  useEffect(() => {
    stopSpeechEngine('stop');
    setVoiceStatus('idle');
    setCurrentStepIndex(0);
    setSpeechError(null);
  }, [room.id, stopSpeechEngine]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearPendingTimer();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        cancelReasonRef.current = 'stop';
        window.speechSynthesis.cancel();
      }
    };
  }, [clearPendingTimer]);

  const speakStep = useCallback(
    (index: number, lang: LanguageCode, singleOnly = false) => {
      if (steps.length === 0 || index < 0 || index >= steps.length) {
        setVoiceStatus('completed');
        return;
      }

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSpeechError(
          UI_LABELS[lang].voiceUnavailable(LANGUAGES[lang].englishName, LANGUAGES[lang].bcp47)
        );
        setVoiceStatus('idle');
        return;
      }

      const currentVoices = window.speechSynthesis.getVoices();
      const match = matchVoiceForLanguage(
        currentVoices.length > 0 ? currentVoices : voices,
        lang
      );

      if (!match.available || !match.voice) {
        setSpeechError(
          UI_LABELS[lang].voiceUnavailable(LANGUAGES[lang].englishName, LANGUAGES[lang].bcp47)
        );
        setVoiceStatus('idle');
        return;
      }

      setSpeechError(null);
      stopSpeechEngine('replace');

      const step = steps[index];
      const text = getStepText(step, lang).trim();

      if (!voiceSettings.voice_enabled) {
        setVoiceStatus('idle');
        return;
      }

      if (!text) {
        setSpeechError(
          `Instruction text for Step ${index + 1} is not available in ${LANGUAGES[lang].englishName}.`
        );
        if (!singleOnly && index + 1 < steps.length) {
          timerRef.current = window.setTimeout(() => {
            if (statusRef.current === 'speaking') {
              speakStep(index + 1, languageRef.current, false);
            }
          }, 420);
        } else {
          setVoiceStatus('idle');
          statusRef.current = 'idle';
        }
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = match.voice;
      utterance.lang = LANGUAGES[lang].bcp47;
      utterance.rate = Math.min(1.5, Math.max(0.5, voiceSettings.voice_speed));
      utterance.pitch = Math.min(1.5, Math.max(0.5, voiceSettings.voice_pitch));

      setCurrentStepIndex(index);
      setVoiceStatus('speaking');
      statusRef.current = 'speaking';

      // Clear replace flag after queuing
      cancelReasonRef.current = 'none';

      utterance.onend = () => {
        if (cancelReasonRef.current !== 'none') {
          cancelReasonRef.current = 'none';
          return;
        }
        if (statusRef.current !== 'speaking') return;

        if (singleOnly) {
          setVoiceStatus('paused');
          statusRef.current = 'paused';
          return;
        }

        if (index + 1 < steps.length) {
          timerRef.current = window.setTimeout(() => {
            if (statusRef.current === 'speaking') {
              speakStep(index + 1, languageRef.current, false);
            }
          }, 420);
        } else {
          setVoiceStatus('completed');
          statusRef.current = 'completed';
        }
      };

      utterance.onerror = (event) => {
        if (event.error === 'canceled' || event.error === 'interrupted') {
          return;
        }
        setSpeechError(
          UI_LABELS[lang].voiceUnavailable(LANGUAGES[lang].englishName, LANGUAGES[lang].bcp47)
        );
        setVoiceStatus('idle');
        statusRef.current = 'idle';
      };

      window.speechSynthesis.speak(utterance);
    },
    [steps, voices, stopSpeechEngine, voiceSettings.voice_enabled, voiceSettings.voice_speed, voiceSettings.voice_pitch]
  );

  // Handle language switch during active voice navigation
  const prevLanguageRef = useRef<LanguageCode>(language);
  useEffect(() => {
    if (prevLanguageRef.current === language) return;
    prevLanguageRef.current = language;
    setSpeechError(null);

    if (statusRef.current === 'speaking' && steps.length > 0) {
      speakStep(currentStepIndex, language, false);
    }
  }, [language, currentStepIndex, steps.length, speakStep]);

  const handleStart = () => {
    if (steps.length === 0) return;
    speakStep(0, language, false);
  };

  const handlePause = () => {
    if (voiceStatus !== 'speaking') return;
    stopSpeechEngine('pause');
    setVoiceStatus('paused');
    statusRef.current = 'paused';
  };

  const handleResume = () => {
    if (steps.length === 0) return;
    if (voiceStatus !== 'paused') return;
    speakStep(currentStepIndex, language, false);
  };

  const handleStop = () => {
    stopSpeechEngine('stop');
    setVoiceStatus('idle');
    statusRef.current = 'idle';
    setCurrentStepIndex(0);
  };

  const handleRepeat = () => {
    if (steps.length === 0) return;
    speakStep(currentStepIndex, language, voiceStatus !== 'speaking');
  };

  const activeStep = steps[currentStepIndex] ?? null;
  const showUnavailableWarning =
    speechError !== null || (voicesLoaded && !voiceMatch.available && steps.length > 0);

  return (
    <section
      aria-label="Direction details"
      className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Search
        </button>
      )}

      {/* Destination Details */}
      <div className="border-b border-slate-200 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {room.name}
            </h2>
            {room.description && (
              <p className="mt-1 text-sm text-slate-600">{room.description}</p>
            )}
          </div>
          <div className="font-mono text-sm font-semibold text-blue-700 tabular-nums">
            {room.room_number}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-slate-500">{labels.roomNumber}</dt>
            <dd className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
              {room.room_number}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">{labels.floor}</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">
              {room.floor_name} (Floor {room.floor_number})
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">{labels.department}</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {room.department_name || room.category}
            </dd>
          </div>
          {room.route && (
            <div>
              <dt className="text-xs font-medium text-slate-500">{labels.startingLocation}</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {room.route.starting_location}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Missing Route Message */}
      {!room.route || steps.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm font-medium text-slate-700">
          Directions are not available for this location yet.
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {/* Voice Navigation Controls */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Volume2 className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <h3 className="text-base font-semibold text-slate-900">
                  {labels.voiceNavigation}
                </h3>
              </div>

              {/* Language switcher inside direction panel for instant switching mid-navigation */}
              <div
                className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5"
                role="group"
                aria-label="Voice language"
              >
                {LANGUAGE_ORDER.map((code) => {
                  const active = language === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => onLanguageChange(code)}
                      aria-pressed={active}
                      className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {LANGUAGES[code].nativeLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {!voiceSettings.voice_enabled && (
              <div
                role="status"
                className="mt-3 flex items-start gap-2.5 rounded-lg border border-slate-300 bg-white p-3 text-xs leading-relaxed text-slate-700 sm:text-sm"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
                <span>
                  Voice navigation is currently disabled by the administrator. Written directions
                  remain displayed below.
                </span>
              </div>
            )}

            {voiceSettings.voice_enabled && showUnavailableWarning && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 sm:text-sm"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <span>
                  {speechError ||
                    labels.voiceUnavailable(
                      LANGUAGES[language].englishName,
                      LANGUAGES[language].bcp47
                    )}
                </span>
              </div>
            )}

            {/* Current Active Instruction Box */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>{labels.currentStep}</span>
                <span className="font-mono tabular-nums">
                  Step {currentStepIndex + 1} / {steps.length}
                </span>
              </div>
              <p className="mt-1.5 text-base font-semibold leading-relaxed text-slate-900">
                {activeStep
                  ? getStepText(activeStep, language).trim() ||
                    `Instruction text is not available in ${LANGUAGES[language].englishName} for this step.`
                  : labels.readyPrompt}
              </p>
              {voiceStatus === 'paused' && (
                <p className="mt-1 text-xs font-medium text-amber-700">{labels.pausedStatus}</p>
              )}
              {voiceStatus === 'completed' && (
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  {labels.completedStatus}
                </p>
              )}
            </div>

            {/* Required 5 Voice Control Buttons */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleStart}
                disabled={!voiceSettings.voice_enabled}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Start Navigation
              </button>

              <button
                type="button"
                onClick={handlePause}
                disabled={!voiceSettings.voice_enabled || voiceStatus !== 'speaking'}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                Pause Voice
              </button>

              <button
                type="button"
                onClick={handleResume}
                disabled={!voiceSettings.voice_enabled || voiceStatus !== 'paused'}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Resume Voice
              </button>

              <button
                type="button"
                onClick={handleStop}
                disabled={voiceStatus === 'idle'}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Square className="h-4 w-4" aria-hidden="true" />
                Stop Navigation
              </button>

              <button
                type="button"
                onClick={handleRepeat}
                disabled={!voiceSettings.voice_enabled}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Repeat Instruction
              </button>
            </div>
          </div>

          {/* Step-by-Step Walking Instructions */}
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {labels.directionsHeading}
            </h3>
            <ol className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {steps.map((step, idx) => {
                const isCurrent = idx === currentStepIndex && voiceStatus !== 'idle';
                const text = getStepText(step, language);
                return (
                  <li key={`${step.step_order}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentStepIndex(idx);
                        if (voiceStatus === 'speaking') {
                          speakStep(idx, language, false);
                        }
                      }}
                      className={`flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition-colors ${
                        isCurrent ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold tabular-nums ${
                          isCurrent
                            ? 'bg-blue-700 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="mt-1 text-slate-500">
                        <StepIcon type={step.action_type} />
                      </span>
                      <span
                        className={`text-sm leading-relaxed sm:text-base ${
                          isCurrent ? 'font-semibold text-slate-900' : 'text-slate-800'
                        }`}
                      >
                        {text.trim() ? (
                          text
                        ) : (
                          <span className="text-amber-700">
                            Warning: Instruction text is not available in{' '}
                            {LANGUAGES[language].englishName} for this step.
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
