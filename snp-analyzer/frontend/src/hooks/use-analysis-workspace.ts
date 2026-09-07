import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { loadAnalysisSession, type ReadyAnalysisSession } from '@/lib/analysis-session';
import { analyzeCurrent } from '@/lib/analysis-actions';
import { getMarkers, getSessionInfo } from '@/lib/api';
import { isRevision } from '@/lib/analysis-context';

function analyzeFreshSession(cycle: number | null, value: ReadyAnalysisSession) {
  if (cycle === null || value.hasCompletedResult || !useSessionStore.getState().consumeInitialAnalysis()) return;
  const settings = useSettingsStore.getState();
  void analyzeCurrent({ algorithm: 'auto', cycle, n_clusters: settings.nClusters,
    use_rox: settings.useRox, background: settings.backgroundMode, ploidy: value.ploidy,
    threshold_config: value.markers.length ? null : { ntc_threshold: settings.ntcThreshold,
      allele1_ratio_max: settings.allele1RatioMax, allele2_ratio_min: settings.allele2RatioMin },
  });
}

/** Metadata may load in parallel, but no analysis consumer mounts before the complete barrier. */
export function useAnalysisWorkspace() {
  const session = useSessionStore(state => state.sessionId);
  const entry = useSessionStore(state => state.entryGeneration);
  const owner = useAuthStore(state => state.user?.id);
  const [loaded, setLoaded] = useState<{ entry: number; value: ReadyAnalysisSession } | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const status = useNavigationStore(state => state.status);
  useEffect(() => {
    if (!session || !owner) return;
    let cancelled = false;
    useAnalysisStore.getState().setSession(session, owner);
    const generation = useNavigationStore.getState().beginRestore(session);
    const load = async () => {
      const value = await loadAnalysisSession();
      if (cancelled) return;
      if (!value) { useNavigationStore.getState().fail(generation, 'Unable to load analysis session'); return; }
      if (value.hasCompletedResult) useSessionStore.getState().consumeInitialAnalysis();
      useSettingsStore.getState().setPloidy(value.ploidy);
      setLoaded({ entry, value });
      const result = useAnalysisStore.getState().result;
      const info = value.info;
      const cycles = [...info.cycles].sort((left, right) => left - right);
      useNavigationStore.getState().setAvailableCycles(cycles);
      const preferred = result?.cycle ?? info.suggested_cycle;
      const cycle = preferred !== null && cycles.includes(preferred) ? preferred : cycles.at(-1) ?? null;
      const accepted = useNavigationStore.getState().complete(generation, { reasons: [], value: {
        session, tab: 'analysis', surface: 'analysis', marker: null,
        cycle,
      } });
      if (accepted) analyzeFreshSession(cycle, value);
    };
    void load();
    return () => { cancelled = true; };
  }, [session, owner, entry, retryGeneration]);
  useEffect(() => {
    if (!session || !owner) return;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      useAnalysisStore.getState().beginInputRefresh();
      try {
        const [info, { markers }] = await Promise.all([getSessionInfo(session), getMarkers(session)]);
        if (request !== sequence || useSessionStore.getState().entryGeneration !== entry) return;
        if (!isRevision(info.input_revision)) throw new Error('Input revision unavailable');
        if (!useAnalysisStore.getState().updateInputRevision(session, owner, info.input_revision)) return;
        setLoaded(previous => previous ? { entry, value: { ...previous.value, markers: structuredClone(markers) } } : null);
      } catch (error) {
        if (request === sequence && useSessionStore.getState().entryGeneration === entry) useAnalysisStore.getState().failInputRefresh(error);
      }
    };
    window.addEventListener('markers-changed', refresh);
    window.addEventListener('welltypes-changed', refresh);
    return () => {
      sequence++;
      window.removeEventListener('markers-changed', refresh);
      window.removeEventListener('welltypes-changed', refresh);
    };
  }, [session, owner, entry]);
  return { ready: status === 'ready' && loaded?.entry === entry, status, markers: loaded?.value.markers ?? [], retry: () => setRetryGeneration(value => value + 1) };
}
