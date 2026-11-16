import { useEffect, useState } from 'react';
import { AdminLogin } from './components/AdminLogin.tsx';
import { AdminPanel } from './components/AdminPanel.tsx';
import { Header } from './components/Header.tsx';
import { StudentHome } from './components/StudentHome.tsx';
import type { AdminUser, LanguageCode, VoiceSettings } from './types.ts';

const TOKEN_STORAGE_KEY = 'campus360_admin_token';

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voice_enabled: true,
  default_language: 'en',
  voice_speed: 0.95,
  voice_pitch: 1.0,
  updated_at: '',
};

export default function App() {
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [userChangedLang, setUserChangedLang] = useState(false);
  const [view, setView] = useState<'student' | 'admin'>(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
      return 'admin';
    }
    return 'student';
  });

  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    }
    return null;
  });
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [verifyingToken, setVerifyingToken] = useState<boolean>(Boolean(token));

  useEffect(() => {
    let active = true;
    fetch('/api/voice-settings')
      .then((res) => (res.ok ? (res.json() as Promise<{ settings: VoiceSettings }>) : null))
      .then((data) => {
        if (active && data?.settings) {
          setVoiceSettings(data.settings);
          setLanguage((curr) => (userChangedLang ? curr : data.settings.default_language));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userChangedLang]);

  useEffect(() => {
    if (!token) {
      setAdminUser(null);
      setVerifyingToken(false);
      return;
    }

    let active = true;
    setVerifyingToken(true);
    fetch('/api/admin/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Session expired');
        return res.json() as Promise<{ admin: AdminUser }>;
      })
      .then((data) => {
        if (active) {
          setAdminUser(data.admin);
        }
      })
      .catch(() => {
        if (active) {
          window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken(null);
          setAdminUser(null);
        }
      })
      .finally(() => {
        if (active) setVerifyingToken(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const handleNavigate = (nextView: 'student' | 'admin') => {
    setView(nextView);
    if (typeof window !== 'undefined') {
      const targetPath = nextView === 'admin' ? '/admin' : '/';
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, '', targetPath);
      }
    }
  };

  useEffect(() => {
    const onPopState = () => {
      setView(window.location.pathname === '/admin' ? 'admin' : 'student');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleLanguageChange = (nextLang: LanguageCode) => {
    setUserChangedLang(true);
    setLanguage(nextLang);
  };

  const handleVoiceSettingsUpdated = (updated: VoiceSettings) => {
    setVoiceSettings(updated);
    if (!userChangedLang) {
      setLanguage(updated.default_language);
    }
  };

  const handleAuthenticated = (newToken: string, admin: AdminUser) => {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setAdminUser(admin);
  };

  const handleLogout = () => {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setAdminUser(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        language={language}
        onLanguageChange={handleLanguageChange}
        view={view}
        onNavigate={handleNavigate}
      />

      {view === 'student' ? (
        <StudentHome
          language={language}
          voiceSettings={voiceSettings}
          onLanguageChange={handleLanguageChange}
        />
      ) : verifyingToken ? (
        <main className="mx-auto max-w-md px-4 py-12">
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Verifying administrator session...
          </div>
        </main>
      ) : token && adminUser ? (
        <AdminPanel
          token={token}
          admin={adminUser}
          onLogout={handleLogout}
          onVoiceSettingsUpdated={handleVoiceSettingsUpdated}
        />
      ) : (
        <AdminLogin onAuthenticated={handleAuthenticated} />
      )}
    </div>
  );
}
