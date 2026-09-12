import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { getProtocol, updateProtocol } from '@/lib/api';
import type { ProtocolStep, RoleLabelMetadata } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';

function identity() {
  const session = useSessionStore.getState();
  return `${useAuthStore.getState().generation}:${session.entryGeneration}:${session.sessionId}`;
}

export function useProtocolEditor(sessionId: string) {
  const [steps, setSteps] = useState<ProtocolStep[]>([]);
  // Run-wide channel/role metadata from the *same* GET response as `steps`
  // (not the data-store cache, which can be stale relative to the session
  // currently open in this tab). `null` until a response with it lands.
  const [channels, setChannels] = useState<RoleLabelMetadata | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'load-error' | 'save-error'>('loading');
  const [reload, setReload] = useState(0);
  const saved = useRef<ProtocolStep[]>([]);
  const active = useRef(false);
  const busy = useRef(true);
  useEffect(() => {
    active.current = true;
    const owner = identity();
    let current = true;
    const accepted = () => current && identity() === owner;
    busy.current = true;
    setPhase('loading');
    void getProtocol(sessionId).then(res => {
      if (!accepted()) return;
      saved.current = res.steps;
      setSteps(res.steps); setChannels(res); setPhase('ready');
    }).catch(() => { if (accepted()) setPhase('load-error'); })
      .finally(() => { if (accepted()) busy.current = false; });
    return () => { current = false; active.current = false; };
  }, [sessionId, reload]);
  const save = async () => {
    if (busy.current) return;
    busy.current = true; setPhase('saving');
    const owner = identity();
    const accepted = () => active.current && identity() === owner;
    const submitted = steps.map(step => ({ ...step }));
    try {
      await updateProtocol(sessionId, submitted);
      if (!accepted()) return;
      saved.current = submitted; setPhase('saved');
      window.dispatchEvent(new CustomEvent('asg-result-dirty'));
    } catch { if (accepted()) setPhase('save-error'); }
    finally { busy.current = false; }
  };
  const cancel = () => { setSteps(saved.current); setPhase('ready'); };
  const editSteps = (next: SetStateAction<ProtocolStep[]>) => { setSteps(next); setPhase('ready'); };
  return { steps, setSteps: editSteps, channels, phase, save, cancel, retry: () => setReload(value => value + 1) };
}
