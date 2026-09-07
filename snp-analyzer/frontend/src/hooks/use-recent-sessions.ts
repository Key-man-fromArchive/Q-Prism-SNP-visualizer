import { useCallback, useEffect, useState } from 'react';
import { ApiError, getSessionInfo, getSessions } from '@/lib/api';
import { recoveryReason } from '@/lib/recovery-reason';
import { validUploadResponse } from '@/lib/upload-response';
import { validRecentSession } from '@/lib/recovery-payload';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import type { SessionListItem } from '@/types/api';
import type { RecoveryReason } from '@/stores/upload-job-store';
import { useOwnedOperation } from './use-owned-operation';

type State = { owner: string | undefined; status: 'loading' | 'ready' | 'error'; sessions: SessionListItem[];
  listError: RecoveryReason | null; openError: RecoveryReason | null; opening: string | null };
function initial(owner: string | undefined): State { return { owner, status: 'loading', sessions: [], listError: null, openError: null, opening: null }; }
export function useRecentSessions(limit: number | null = 5, onOpen?: () => void) {
  const owner = useAuthStore(state => state.user?.id);
  const [state, setState] = useState(() => initial(owner));
  if (state.owner !== owner) setState(initial(owner));
  const list = useOwnedOperation(), admission = useOwnedOperation();
  const reload = useCallback(async () => {
    const ticket = list.begin();
    setState(value => ({ ...value, status: 'loading', listError: null }));
    try {
      const sessions = await getSessions();
      if (!Array.isArray(sessions) || !sessions.every(validRecentSession)) throw new ApiError('Invalid session list', 422, {});
      if (list.current(ticket)) {
        setState(value => ({ ...value, sessions: limit === null ? sessions : sessions.slice(0, limit), status: 'ready' }));
        return true;
      }
    } catch (error) {
      if (list.current(ticket)) setState(value => ({ ...value, status: 'error', listError: recoveryReason(error) }));
    }
    return false;
  }, [list, limit]);
  useEffect(() => { void reload(); }, [reload, owner]);
  const open = async (sid: string) => {
    const ticket = admission.begin();
    setState(value => ({ ...value, opening: sid, openError: null }));
    try {
      const info = await getSessionInfo(sid);
      if (!validUploadResponse(info) || info.session_id !== sid) throw new ApiError('Invalid session response', 422, {});
      if (!admission.current(ticket)) return;
      setState(value => ({ ...value, opening: null }));
      useSessionStore.getState().setSession(sid, info);
      onOpen?.();
    } catch (error) {
      if (admission.current(ticket)) setState(value => ({ ...value, opening: null, openError: recoveryReason(error) }));
    }
  };
  return { ...state, reload, open };
}
