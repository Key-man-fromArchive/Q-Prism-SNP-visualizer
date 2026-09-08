import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { login } from '@/lib/api';

/** A component-local request cannot publish across auth ownership or unmount. */
export function useLoginAttempt(failureMessage: string) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async (username: string, password: string) => {
    if (pending.current) return;
    const { generation, authMode } = useAuthStore.getState();
    const current = () => mounted.current && useAuthStore.getState().generation === generation && useAuthStore.getState().authMode === authMode;
    pending.current = true;
    setError(''); setLoading(true);
    try {
      const res = await login({ username, password });
      if (current()) useAuthStore.getState().setUser(res.user);
    } catch {
      if (current()) setError(failureMessage);
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  return { error, loading, submit };
}
