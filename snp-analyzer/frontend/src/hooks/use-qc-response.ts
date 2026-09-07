import { useEffect, useRef, useState } from 'react';
import { getQc } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { BackgroundMode, QcResponse } from '@/types/api';

export function qcRequestKey(): string {
  const session = useSessionStore.getState();
  const analysis = useAnalysisStore.getState();
  const navigation = useNavigationStore.getState();
  const settings = useSettingsStore.getState();
  return JSON.stringify([useAuthStore.getState().user?.id, session.sessionId, session.entryGeneration,
    navigation.status, navigation.cycle, settings.useRox, settings.backgroundMode,
    analysis.result?.analysis_context?.result_revision, analysis.generation, analysis.currentInputRevision,
    analysis.knownInputRevision, analysis.inputRevisionRefreshing, analysis.inputRevisionError !== null,
    analysis.status, analysis.pending]);
}
type QcLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: QcResponse };
export type QcQuery = { requestKey: string; sid: string; cycle: number; useRox: boolean; background: BackgroundMode };

/** The keyed consumer never presents a previous query as current; guards cover the render/effect gap. */
export function useQcResponse({ requestKey, sid, cycle, useRox, background }: QcQuery): QcLoad {
  const [state, setState] = useState<QcLoad>({ status: 'loading' });
  const request = useRef<{ key: string; promise: Promise<QcResponse> } | null>(null);
  useEffect(() => {
    let active = true;
    const current = () => active && qcRequestKey() === requestKey;
    const key = JSON.stringify([requestKey, sid, cycle, useRox, background]);
    // Reuse only this mounted query's request during StrictMode effect replay.
    // Explicit retries remount the keyed consumer and therefore get a fresh ref.
    if (request.current?.key !== key) {
      request.current = { key, promise: getQc(sid, cycle, useRox, background) };
    }
    void request.current.promise.then(data => {
      if (current()) setState({ status: 'ready', data });
    }).catch(() => { if (current()) setState({ status: 'error' }); });
    return () => { active = false; };
  }, [requestKey, sid, cycle, useRox, background]);
  return state;
}
