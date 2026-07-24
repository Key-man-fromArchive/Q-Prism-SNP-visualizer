import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { login } from '@/lib/api';
import { useI18n } from '@/hooks/use-i18n';
import { useLanguageStore } from '@/stores/language-store';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);
  const { t } = useI18n();
  const { language, setLanguage } = useLanguageStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login({ username, password });
      setUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loginFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-8 w-full max-w-sm shadow-lg">
        <h1 className="text-xl font-semibold text-text text-center mb-1">
          {t.loginTitle}
        </h1>
        <p className="text-sm text-text-muted text-center mb-6">{t.loginSubtitle}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="username" className="block text-sm text-text mb-1">{t.username}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm focus:outline-none focus:border-primary"
              autoFocus
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-text mb-1">{t.password}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm focus:outline-none focus:border-primary"
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2 bg-primary text-white rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t.signingIn : t.signIn}
          </button>
        </form>

        <div className="flex items-center justify-center gap-3 mt-6">
          <p className="text-xs text-text-muted">{t.poweredBy}</p>
          <button onClick={() => setLanguage(language === 'en' ? 'ko' : 'en')}
            className="text-xs text-text-muted hover:text-primary border border-border rounded px-2 py-0.5">
            {language === 'en' ? '한국어' : 'English'}
          </button>
        </div>
      </div>
    </div>
  );
}
