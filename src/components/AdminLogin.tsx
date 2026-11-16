import { useEffect, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import type { AdminUser } from '../types.ts';

interface AdminLoginProps {
  onAuthenticated: (token: string, admin: AdminUser) => void;
}

export function AdminLogin({ onAuthenticated }: AdminLoginProps) {
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/status')
      .then((res) => res.json())
      .then((data: { initialized: boolean }) => {
        if (active) setInitialized(Boolean(data.initialized));
      })
      .catch(() => {
        if (active) setInitialized(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (initialized === false && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = initialized === false ? '/api/admin/setup' : '/api/admin/login';
      const payload =
        initialized === false
          ? { name: name.trim() || 'Campus Administrator', email, password }
          : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as {
        token?: string;
        admin?: AdminUser;
        error?: string;
      };

      if (!res.ok || !data.token || !data.admin) {
        setError(data.error || 'Authentication failed.');
        return;
      }

      onAuthenticated(data.token, data.admin);
    } catch {
      setError('Unable to reach authentication server.');
    } finally {
      setSubmitting(false);
    }
  };

  if (initialized === null) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Checking administrator access...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10 sm:py-14">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {initialized ? 'Administrator Sign In' : 'Initialize Administrator'}
            </h1>
            <p className="text-xs text-slate-600">Campus 360 — BGMIT Mudhol</p>
          </div>
        </div>

        {!initialized && (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
            No administrator account has been configured yet. Create the primary administrator
            account to secure the Campus 360 Admin Panel.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {!initialized && (
            <div>
              <label htmlFor="admin-name" className="block text-sm font-medium text-slate-700">
                Administrator Name
              </label>
              <input
                id="admin-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Campus Administrator"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="admin-email" className="block text-sm font-medium text-slate-700">
              Email Address
            </label>
            <input
              id="admin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@college.edu"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              required
              minLength={6}
              autoComplete={initialized ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>

          {!initialized && (
            <div>
              <label
                htmlFor="admin-confirm-password"
                className="block text-sm font-medium text-slate-700"
              >
                Confirm Password
              </label>
              <input
                id="admin-confirm-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
          >
            {submitting
              ? 'Verifying...'
              : initialized
                ? 'Sign In to Admin Panel'
                : 'Create Administrator Account'}
          </button>
        </form>
      </div>
    </main>
  );
}
