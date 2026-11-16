import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Edit3,
  Plus,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import {
  LANGUAGES,
  matchVoiceForLanguage,
  speakPreviewText,
  stopSpeechPlayback,
} from '../lib/voice.ts';
import type {
  Floor,
  LanguageCode,
  Room,
  StepActionType,
  VoiceInstructionRecord,
  VoiceSettings,
} from '../types.ts';
import { ConfirmModal } from './ConfirmModal.tsx';

interface VoiceDirectionManagerProps {
  token: string;
  rooms: Room[];
  floors: Floor[];
  onDataChanged: () => Promise<void>;
  onVoiceSettingsUpdated: (settings: VoiceSettings) => void;
}

type LanguageFilter = 'all' | 'kn' | 'en' | 'hi' | 'missing';
type StatusFilter = 'all' | 'active' | 'disabled';

const SAMPLE_TEST_PHRASES: Record<LanguageCode, string> = {
  kn: 'ದಯವಿಟ್ಟು ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.',
  en: 'Please walk straight ahead.',
  hi: 'कृपया सीधे आगे बढ़ें।',
};

const QUICK_PHRASES: Record<StepActionType, Record<LanguageCode, string>> = {
  start: {
    kn: 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನಕ್ಕೆ ಹೋಗಲು ಪ್ರಾರಂಭಿಸೋಣ.',
    en: "Hello! Let's find your destination.",
    hi: 'नमस्ते! आइए आपके गंतव्य तक चलते हैं।',
  },
  straight: {
    kn: 'ದಯವಿಟ್ಟು ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.',
    en: 'Please walk straight ahead.',
    hi: 'कृपया सीधे आगे बढ़ें।',
  },
  left: {
    kn: 'ಈಗ ಎಡಕ್ಕೆ ತಿರುಗಿ.',
    en: 'Now turn left.',
    hi: 'अब बाईं ओर मुड़ें।',
  },
  right: {
    kn: 'ಈಗ ಬಲಕ್ಕೆ ತಿರುಗಿ.',
    en: 'Now turn right.',
    hi: 'अब दाईं ओर मुड़ें।',
  },
  stairs: {
    kn: 'ಮೆಟ್ಟಿಲುಗಳ ಮೂಲಕ ಮುಂದಿನ ಮಹಡಿಗೆ ಹೋಗಿ.',
    en: 'Take the stairs to the next floor.',
    hi: 'सीढ़ियों से अगली मंजिल पर जाएँ।',
  },
  floor_change: {
    kn: 'ಎರಡನೇ ಮಹಡಿಗೆ ತೆರಳಿ.',
    en: 'Proceed to the second floor.',
    hi: 'दूसरी मंजिल पर जाएँ।',
  },
  destination: {
    kn: 'ನೀವು ನಿಮ್ಮ ಗಮ್ಯಸ್ಥಾನವನ್ನು ತಲುಪಿದ್ದೀರಿ. ಧನ್ಯವಾದಗಳು!',
    en: 'You have reached your destination. Thank you!',
    hi: 'आप अपने गंतव्य पर पहुँच गए हैं। धन्यवाद!',
  },
  custom: {
    kn: '',
    en: '',
    hi: '',
  },
};

export function VoiceDirectionManager({
  token,
  rooms,
  floors,
  onDataChanged,
  onVoiceSettingsUpdated,
}: VoiceDirectionManagerProps) {
  const [instructions, setInstructions] = useState<VoiceInstructionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Voice Control Settings state
  const [settings, setSettings] = useState<VoiceSettings>({
    voice_enabled: true,
    default_language: 'en',
    voice_speed: 0.95,
    voice_pitch: 1.0,
    updated_at: '',
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // Speech preview state
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const [lastTested, setLastTested] = useState<{ text: string; lang: LanguageCode } | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Add / Edit Instruction Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [formState, setFormState] = useState({
    room_id: '',
    floor_id: '',
    starting_location: 'Main Entrance',
    step_order: '',
    action_type: 'straight' as StepActionType,
    instruction_kn: '',
    instruction_en: '',
    instruction_hi: '',
    is_active: true,
  });

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<VoiceInstructionRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      stopSpeechPlayback();
    };
  }, []);

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const loadVoiceData = useCallback(async () => {
    setLoading(true);
    try {
      const [instrRes, settingsRes] = await Promise.all([
        fetch('/api/admin/voice-instructions', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/admin/voice-settings', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!instrRes.ok || !settingsRes.ok) {
        throw new Error('Failed to load voice management data.');
      }

      const instrData = (await instrRes.json()) as { instructions: VoiceInstructionRecord[] };
      const settingsData = (await settingsRes.json()) as { settings: VoiceSettings };

      setInstructions(instrData.instructions);
      setSettings(settingsData.settings);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to load voice instructions.',
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadVoiceData();
  }, [loadVoiceData]);

  const handleTestVoice = (key: string, text: string, lang: LanguageCode) => {
    setVoiceWarning(null);
    setLastTested({ text, lang });
    speakPreviewText({
      text,
      lang,
      rate: settings.voice_speed,
      pitch: settings.voice_pitch,
      voices,
      onStart: () => setSpeakingKey(key),
      onEnd: () => setSpeakingKey((prev) => (prev === key ? null : prev)),
      onUnavailable: (msg) => {
        setSpeakingKey(null);
        setVoiceWarning(msg);
      },
    });
  };

  const handleStopVoice = () => {
    stopSpeechPlayback();
    setSpeakingKey(null);
  };

  const handleRepeatLastTest = () => {
    if (lastTested) {
      handleTestVoice('settings-repeat', lastTested.text, lastTested.lang);
    } else {
      handleTestVoice(
        'settings-sample',
        SAMPLE_TEST_PHRASES[settings.default_language],
        settings.default_language
      );
    }
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/voice-settings', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          voice_enabled: settings.voice_enabled,
          default_language: settings.default_language,
          voice_speed: settings.voice_speed,
          voice_pitch: settings.voice_pitch,
        }),
      });
      const data = (await res.json()) as { settings?: VoiceSettings; error?: string };
      if (!res.ok || !data.settings) {
        setBanner({ type: 'error', text: data.error || 'Failed to save voice settings.' });
        return;
      }
      setSettings(data.settings);
      onVoiceSettingsUpdated(data.settings);
      setBanner({ type: 'success', text: 'Voice control settings saved to database.' });
    } catch {
      setBanner({ type: 'error', text: 'Network error while saving voice settings.' });
    } finally {
      setSavingSettings(false);
    }
  };

  const openAddForm = () => {
    const defaultRoom =
      roomFilter !== 'all'
        ? rooms.find((r) => String(r.id) === roomFilter) ?? rooms[0]
        : rooms[0];
    setEditingId(null);
    setVoiceWarning(null);
    setFormState({
      room_id: defaultRoom ? String(defaultRoom.id) : '',
      floor_id: defaultRoom ? String(defaultRoom.floor_id) : floors[0] ? String(floors[0].id) : '',
      starting_location: 'Main Entrance',
      step_order: '',
      action_type: 'straight',
      instruction_kn: '',
      instruction_en: '',
      instruction_hi: '',
      is_active: true,
    });
    setShowForm(true);
  };

  const openEditForm = (item: VoiceInstructionRecord) => {
    setEditingId(item.id);
    setVoiceWarning(null);
    setFormState({
      room_id: String(item.room_id),
      floor_id: String(item.floor_id),
      starting_location: item.starting_location,
      step_order: String(item.step_order),
      action_type: item.action_type,
      instruction_kn: item.instruction_kn,
      instruction_en: item.instruction_en,
      instruction_hi: item.instruction_hi,
      is_active: item.is_active,
    });
    setShowForm(true);
  };

  const handleSaveInstruction = async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setSavingForm(true);

    try {
      const payload: Record<string, unknown> = {
        room_id: Number(formState.room_id),
        floor_id: Number(formState.floor_id),
        action_type: formState.action_type,
        instruction_kn: formState.instruction_kn,
        instruction_en: formState.instruction_en,
        instruction_hi: formState.instruction_hi,
        is_active: formState.is_active,
      };
      if (formState.step_order.trim() !== '') {
        payload.step_order = Number(formState.step_order);
      }
      if (!editingId) {
        payload.starting_location = formState.starting_location;
      }

      const url = editingId
        ? `/api/admin/voice-instructions/${editingId}`
        : '/api/admin/voice-instructions';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setBanner({ type: 'error', text: data.error || 'Could not save voice instruction.' });
        return;
      }

      setShowForm(false);
      setBanner({
        type: 'success',
        text: editingId
          ? 'Voice instruction updated successfully.'
          : 'New voice instruction added successfully.',
      });
      await loadVoiceData();
      await onDataChanged();
    } catch {
      setBanner({ type: 'error', text: 'Network error while saving voice instruction.' });
    } finally {
      setSavingForm(false);
    }
  };

  const handleToggleInstructionActive = async (item: VoiceInstructionRecord) => {
    setBanner(null);
    const res = await fetch(`/api/admin/voice-instructions/${item.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ is_active: !item.is_active }),
    });
    if (!res.ok) {
      setBanner({ type: 'error', text: 'Failed to update instruction status.' });
      return;
    }
    setBanner({
      type: 'success',
      text: `Instruction #${String(item.id).padStart(3, '0')} ${
        item.is_active ? 'disabled' : 'enabled'
      }.`,
    });
    await loadVoiceData();
    await onDataChanged();
  };

  const handleMoveStepInRoute = async (item: VoiceInstructionRecord, direction: -1 | 1) => {
    const siblings = instructions
      .filter((i) => i.room_id === item.room_id)
      .sort((a, b) => a.step_order - b.step_order || a.id - b.id);
    const idx = siblings.findIndex((i) => i.id === item.id);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= siblings.length) return;

    const reordered = [...siblings];
    const tmp = reordered[idx];
    reordered[idx] = reordered[targetIdx];
    reordered[targetIdx] = tmp;

    const res = await fetch('/api/admin/voice-instructions/reorder', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        room_id: item.room_id,
        ordered_ids: reordered.map((r) => r.id),
      }),
    });

    if (!res.ok) {
      setBanner({ type: 'error', text: 'Could not update instruction sequence.' });
      return;
    }
    setBanner({
      type: 'success',
      text: `Updated step sequence for ${item.room_name}.`,
    });
    await loadVoiceData();
    await onDataChanged();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/voice-instructions/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setBanner({ type: 'error', text: data.error || 'Failed to delete instruction.' });
        return;
      }
      setBanner({
        type: 'success',
        text: `Deleted voice instruction #${String(deleteTarget.id).padStart(3, '0')}.`,
      });
      await loadVoiceData();
      await onDataChanged();
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const fillLanguageTemplate = (lang: LanguageCode) => {
    const sample = QUICK_PHRASES[formState.action_type]?.[lang];
    if (!sample) return;
    if (lang === 'kn') setFormState((s) => ({ ...s, instruction_kn: sample }));
    if (lang === 'en') setFormState((s) => ({ ...s, instruction_en: sample }));
    if (lang === 'hi') setFormState((s) => ({ ...s, instruction_hi: sample }));
  };

  const filteredInstructions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return instructions.filter((item) => {
      if (roomFilter !== 'all' && String(item.room_id) !== roomFilter) return false;
      if (statusFilter === 'active' && !item.is_active) return false;
      if (statusFilter === 'disabled' && item.is_active) return false;
      if (languageFilter === 'kn' && !item.instruction_kn.trim()) return false;
      if (languageFilter === 'en' && !item.instruction_en.trim()) return false;
      if (languageFilter === 'hi' && !item.instruction_hi.trim()) return false;
      if (
        languageFilter === 'missing' &&
        item.instruction_kn.trim() &&
        item.instruction_en.trim() &&
        item.instruction_hi.trim()
      ) {
        return false;
      }

      if (!q) return true;
      return (
        item.room_name.toLowerCase().includes(q) ||
        item.room_number.toLowerCase().includes(q) ||
        item.floor_name.toLowerCase().includes(q) ||
        item.instruction_kn.toLowerCase().includes(q) ||
        item.instruction_en.toLowerCase().includes(q) ||
        item.instruction_hi.toLowerCase().includes(q) ||
        String(item.id).padStart(3, '0').includes(q)
      );
    });
  }, [instructions, roomFilter, statusFilter, languageFilter, searchQuery]);

  const routeCountsByRoom = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of instructions) {
      map.set(item.room_id, (map.get(item.room_id) ?? 0) + 1);
    }
    return map;
  }, [instructions]);

  const activeLanguageVoiceMatch = useMemo(() => {
    return {
      kn: matchVoiceForLanguage(voices, 'kn'),
      en: matchVoiceForLanguage(voices, 'en'),
      hi: matchVoiceForLanguage(voices, 'hi'),
    };
  }, [voices]);

  return (
    <section aria-label="Voice Direction Management" className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Voice Direction Management</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Manage multilingual voice instructions, route step sequence, and global voice playback
            settings.
          </p>
        </div>

        <button
          type="button"
          onClick={openAddForm}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Instruction
        </button>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          role="status"
          className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
            banner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {voiceWarning && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span>{voiceWarning}</span>
        </div>
      )}

      {/* Voice Control Settings Card */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Volume2 className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <h3 className="text-base font-semibold text-slate-900">Voice Control Settings</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                handleTestVoice(
                  'settings-sample',
                  SAMPLE_TEST_PHRASES[settings.default_language],
                  settings.default_language
                )
              }
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Volume2 className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
              Test Voice
            </button>
            <button
              type="button"
              onClick={handleRepeatLastTest}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Repeat Instruction
            </button>
            {speakingKey && (
              <button
                type="button"
                onClick={handleStopVoice}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 whitespace-nowrap"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Stop Voice
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="block text-xs font-medium text-slate-700">
              Voice Navigation Status
            </span>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, voice_enabled: true }))}
                aria-pressed={settings.voice_enabled}
                className={`min-h-[40px] flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                  settings.voice_enabled
                    ? 'border-blue-700 bg-blue-700 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Enable Voice
              </button>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, voice_enabled: false }))}
                aria-pressed={!settings.voice_enabled}
                className={`min-h-[40px] flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                  !settings.voice_enabled
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Disable Voice
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="voice-default-lang"
              className="block text-xs font-medium text-slate-700"
            >
              Default Language
            </label>
            <select
              id="voice-default-lang"
              value={settings.default_language}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  default_language: e.target.value as LanguageCode,
                }))
              }
              className="mt-2 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
            >
              <option value="kn">Kannada (ಕನ್ನಡ — kn-IN)</option>
              <option value="en">English (en-IN)</option>
              <option value="hi">Hindi (हिन्दी — hi-IN)</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-700">
              <label htmlFor="voice-speed-range">Voice Speed</label>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {settings.voice_speed.toFixed(2)}x
              </span>
            </div>
            <input
              id="voice-speed-range"
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={settings.voice_speed}
              onChange={(e) =>
                setSettings((s) => ({ ...s, voice_speed: Number(e.target.value) }))
              }
              className="mt-3 w-full accent-blue-700"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-700">
              <label htmlFor="voice-pitch-range">Voice Pitch</label>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {settings.voice_pitch.toFixed(2)}
              </span>
            </div>
            <input
              id="voice-pitch-range"
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={settings.voice_pitch}
              onChange={(e) =>
                setSettings((s) => ({ ...s, voice_pitch: Number(e.target.value) }))
              }
              className="mt-3 w-full accent-blue-700"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="text-xs text-slate-500">
            Browser voices detected — Kannada:{' '}
            <span className="font-medium text-slate-700">
              {activeLanguageVoiceMatch.kn.available ? 'Available' : 'Not installed'}
            </span>{' '}
            · English:{' '}
            <span className="font-medium text-slate-700">
              {activeLanguageVoiceMatch.en.available ? 'Available' : 'Not installed'}
            </span>{' '}
            · Hindi:{' '}
            <span className="font-medium text-slate-700">
              {activeLanguageVoiceMatch.hi.available ? 'Available' : 'Not installed'}
            </span>
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {savingSettings ? 'Saving Settings...' : 'Save Voice Settings'}
          </button>
        </div>
      </form>

      {/* Add / Edit Voice Instruction Form */}
      {showForm && (
        <form
          onSubmit={handleSaveInstruction}
          className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <h3 className="text-lg font-semibold text-slate-900">
              {editingId
                ? `Edit Voice Instruction #${String(editingId).padStart(3, '0')}`
                : 'Add New Voice Instruction'}
            </h3>
            {speakingKey && (
              <button
                type="button"
                onClick={handleStopVoice}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Stop Voice
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Associated Destination Room *
              </label>
              <select
                required
                value={formState.room_id}
                onChange={(e) => {
                  const newRoomId = e.target.value;
                  const room = rooms.find((r) => String(r.id) === newRoomId);
                  setFormState((s) => ({
                    ...s,
                    room_id: newRoomId,
                    floor_id: room ? String(room.floor_id) : s.floor_id,
                  }));
                }}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.room_number})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Associated Floor *
              </label>
              <select
                required
                value={formState.floor_id}
                onChange={(e) => setFormState((s) => ({ ...s, floor_id: e.target.value }))}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
              >
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} (Floor {f.floor_number})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Instruction Type</label>
              <select
                value={formState.action_type}
                onChange={(e) =>
                  setFormState((s) => ({
                    ...s,
                    action_type: e.target.value as StepActionType,
                  }))
                }
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
              >
                <option value="start">Start Greeting</option>
                <option value="straight">Walk Straight</option>
                <option value="left">Turn Left</option>
                <option value="right">Turn Right</option>
                <option value="stairs">Staircase</option>
                <option value="floor_change">Floor Change</option>
                <option value="destination">Destination Reached</option>
                <option value="custom">Custom Instruction</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Step Sequence Number
              </label>
              <input
                type="number"
                min={1}
                value={formState.step_order}
                onChange={(e) => setFormState((s) => ({ ...s, step_order: e.target.value }))}
                placeholder="Auto (next step)"
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-700 focus:outline-none"
              />
            </div>

            {!editingId && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">
                  Starting Location (if creating first step for room)
                </label>
                <input
                  type="text"
                  value={formState.starting_location}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, starting_location: e.target.value }))
                  }
                  placeholder="Main Entrance"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center sm:col-span-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={formState.is_active}
                  onChange={(e) => setFormState((s) => ({ ...s, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                Enable this instruction for student voice &amp; written navigation
              </label>
            </div>
          </div>

          {/* Independent Three-Language Editors with Inline Test Voice */}
          <div className="mt-6 space-y-4">
            {/* Kannada */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="instr-kn"
                  className="text-sm font-semibold text-slate-900"
                >
                  Kannada (ಕನ್ನಡ) — kn-IN
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {QUICK_PHRASES[formState.action_type]?.kn && (
                    <button
                      type="button"
                      onClick={() => fillLanguageTemplate('kn')}
                      className="min-h-[34px] rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Insert Kannada Sample
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleTestVoice('form-kn', formState.instruction_kn, 'kn')}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                  >
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Test Voice
                  </button>
                  {speakingKey === 'form-kn' && (
                    <button
                      type="button"
                      onClick={handleStopVoice}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                      Stop Voice
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="instr-kn"
                rows={2}
                value={formState.instruction_kn}
                onChange={(e) =>
                  setFormState((s) => ({ ...s, instruction_kn: e.target.value }))
                }
                placeholder="ಉದಾ: ದಯವಿಟ್ಟು ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ."
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            {/* English */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="instr-en"
                  className="text-sm font-semibold text-slate-900"
                >
                  English — en-IN
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {QUICK_PHRASES[formState.action_type]?.en && (
                    <button
                      type="button"
                      onClick={() => fillLanguageTemplate('en')}
                      className="min-h-[34px] rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Insert English Sample
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleTestVoice('form-en', formState.instruction_en, 'en')}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                  >
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Test Voice
                  </button>
                  {speakingKey === 'form-en' && (
                    <button
                      type="button"
                      onClick={handleStopVoice}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                      Stop Voice
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="instr-en"
                rows={2}
                value={formState.instruction_en}
                onChange={(e) =>
                  setFormState((s) => ({ ...s, instruction_en: e.target.value }))
                }
                placeholder="e.g. Please walk straight ahead."
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            {/* Hindi */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="instr-hi"
                  className="text-sm font-semibold text-slate-900"
                >
                  Hindi (हिन्दी) — hi-IN
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {QUICK_PHRASES[formState.action_type]?.hi && (
                    <button
                      type="button"
                      onClick={() => fillLanguageTemplate('hi')}
                      className="min-h-[34px] rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Insert Hindi Sample
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleTestVoice('form-hi', formState.instruction_hi, 'hi')}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                  >
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Test Voice
                  </button>
                  {speakingKey === 'form-hi' && (
                    <button
                      type="button"
                      onClick={handleStopVoice}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                      Stop Voice
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="instr-hi"
                rows={2}
                value={formState.instruction_hi}
                onChange={(e) =>
                  setFormState((s) => ({ ...s, instruction_hi: e.target.value }))
                }
                placeholder="उदा: कृपया सीधे आगे बढ़ें।"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingForm}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {savingForm ? 'Saving...' : editingId ? 'Save Changes' : 'Add Instruction'}
            </button>
          </div>
        </form>
      )}

      {/* Search & Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor="voice-search-destination"
              className="block text-xs font-medium text-slate-600"
            >
              Search by Destination or Text
            </label>
            <input
              id="voice-search-destination"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Library, CSE-301, step text..."
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="voice-filter-room" className="block text-xs font-medium text-slate-600">
              Destination Route
            </label>
            <select
              id="voice-filter-room"
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-blue-700 focus:outline-none"
            >
              <option value="all">All Destinations ({instructions.length})</option>
              {rooms.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} ({r.room_number}) — {routeCountsByRoom.get(r.id) ?? 0} steps
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="voice-filter-language"
              className="block text-xs font-medium text-slate-600"
            >
              Filter by Language
            </label>
            <select
              id="voice-filter-language"
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value as LanguageFilter)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-blue-700 focus:outline-none"
            >
              <option value="all">All Languages</option>
              <option value="kn">Has Kannada (ಕನ್ನಡ)</option>
              <option value="en">Has English</option>
              <option value="hi">Has Hindi (हिन्दी)</option>
              <option value="missing">Missing a Language Translation</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="voice-filter-status"
              className="block text-xs font-medium text-slate-600"
            >
              Instruction Status
            </label>
            <select
              id="voice-filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-blue-700 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="disabled">Disabled Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Voice Direction List */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading voice instructions...
        </div>
      ) : filteredInstructions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No voice instructions match the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredInstructions.map((item) => {
            const roomSteps = instructions
              .filter((i) => i.room_id === item.room_id)
              .sort((a, b) => a.step_order - b.step_order || a.id - b.id);
            const posInRoute = roomSteps.findIndex((s) => s.id === item.id);
            const canMoveUp = posInRoute > 0;
            const canMoveDown = posInRoute >= 0 && posInRoute < roomSteps.length - 1;

            return (
              <div
                key={item.id}
                className={`rounded-xl border bg-white p-4 sm:p-5 ${
                  item.is_active ? 'border-slate-200' : 'border-slate-200 bg-slate-50/70 opacity-85'
                }`}
              >
                {/* Row Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                    <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
                      ID #{String(item.id).padStart(3, '0')}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-mono text-xs font-semibold text-blue-700 tabular-nums">
                      Step {item.step_order}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-semibold text-slate-900">{item.room_name}</span>
                    <span className="font-mono text-xs text-slate-600 tabular-nums">
                      ({item.room_number})
                    </span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="text-xs text-slate-600">{item.floor_name}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleInstructionActive(item)}
                      className={`min-h-[34px] rounded-md border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                        item.is_active
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {item.is_active ? 'Enabled' : 'Disabled'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMoveStepInRoute(item, -1)}
                      disabled={!canMoveUp}
                      aria-label={`Move instruction ${item.id} earlier`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMoveStepInRoute(item, 1)}
                      disabled={!canMoveDown}
                      aria-label={`Move instruction ${item.id} later`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditForm(item)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit Instruction
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>

                {/* Three Language Versions with Individual Test Voice */}
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {(['kn', 'en', 'hi'] as LanguageCode[]).map((code) => {
                    const text =
                      code === 'kn'
                        ? item.instruction_kn
                        : code === 'hi'
                          ? item.instruction_hi
                          : item.instruction_en;
                    const key = `row-${item.id}-${code}`;
                    const isSpeaking = speakingKey === key;
                    return (
                      <div
                        key={code}
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700">
                            {LANGUAGES[code].englishName} ({LANGUAGES[code].nativeLabel})
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleTestVoice(key, text, code)}
                              disabled={!text.trim()}
                              className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                            >
                              <Volume2 className="h-3 w-3" aria-hidden="true" />
                              Test Voice
                            </button>
                            {isSpeaking && (
                              <button
                                type="button"
                                onClick={handleStopVoice}
                                className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                              >
                                <Square className="h-3 w-3" aria-hidden="true" />
                                Stop
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                          {text.trim() ? (
                            text
                          ) : (
                            <span className="text-xs italic text-amber-700">
                              Not configured for {LANGUAGES[code].englishName}
                            </span>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Voice Instruction"
        message={
          deleteTarget
            ? `Are you sure you want to permanently delete Instruction #${String(
                deleteTarget.id
              ).padStart(3, '0')} (Step ${deleteTarget.step_order} for ${deleteTarget.room_name})?`
            : ''
        }
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
}
