import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { login } from '@/lib/api';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login({ username, password });
      setUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-8 w-full max-w-sm shadow-lg">
        <h1 className="text-xl font-semibold text-text text-center mb-1">
          SNP Discrimination Analyzer
        </h1>
        <p className="text-sm text-text-muted text-center mb-6">Sign in to continue</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="username" className="block text-sm text-text mb-1">Username</label>
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
            <label htmlFor="password" className="block text-sm text-text mb-1">Password</label>
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
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2 bg-primary text-white rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-xs text-text-muted text-center mt-6">
          Powered by Invirustech
        </p>
      </div>
    </div>
  );
}
