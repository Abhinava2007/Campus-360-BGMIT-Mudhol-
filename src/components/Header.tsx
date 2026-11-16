import { LANGUAGES } from '../lib/voice.ts';
import type { LanguageCode } from '../types.ts';

interface HeaderProps {
  language: LanguageCode;
  onLanguageChange: (lang: LanguageCode) => void;
  view: 'student' | 'admin';
  onNavigate: (view: 'student' | 'admin') => void;
}

const LANGUAGE_ORDER: LanguageCode[] = ['kn', 'en', 'hi'];

export function Header({ language, onLanguageChange, view, onNavigate }: HeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => onNavigate('student')}
          className="flex items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <svg
            viewBox="0 0 36 36"
            className="h-9 w-9 shrink-0"
            fill="none"
            aria-hidden="true"
          >
            <rect width="36" height="36" rx="8" fill="#1D4ED8" />
            <circle cx="18" cy="18" r="10" stroke="#FFFFFF" strokeWidth="2" />
            <path
              d="M18 11L21.5 21.5L18 19.2L14.5 21.5L18 11Z"
              fill="#FFFFFF"
            />
          </svg>
          <div className="min-w-0">
            <span className="block text-base font-bold tracking-tight text-slate-900 whitespace-nowrap sm:text-lg">
              Campus 360
            </span>
            <span className="block text-xs font-medium text-slate-600 whitespace-nowrap">
              BGMIT Mudhol
            </span>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-1"
            role="group"
            aria-label="Select navigation language"
          >
            {LANGUAGE_ORDER.map((code) => {
              const meta = LANGUAGES[code];
              const active = language === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onLanguageChange(code)}
                  aria-pressed={active}
                  className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 sm:text-sm ${
                    active
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {meta.nativeLabel}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onNavigate(view === 'admin' ? 'student' : 'admin')}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0"
          >
            {view === 'admin' ? 'Student Search' : 'Admin Panel'}
          </button>
        </div>
      </div>
    </header>
  );
}
