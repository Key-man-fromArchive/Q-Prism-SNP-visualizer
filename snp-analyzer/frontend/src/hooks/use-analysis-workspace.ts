import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { completeWorkspaceRestore } from '@/lib/workspace-ready';
import { restorationError } from '@/lib/workspace-location';
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
  const [markerEntry, setMarkerEntry] = useState<number | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const status = useNavigationStore(state => state.status);
  useEffect(() => {
    if (!session || !owner) return;
    let cancelled = false;
    useAnalysisStore.getState().setSession(session, owner);
    const generation = useNavigationStore.getState().beginRestore(session);
    const load = async () => {
      const value = await loadAnalysisSession();
      if (cancelled || useSessionStore.getState().entryGeneration !== entry || useAuthStore.getState().user?.id !== owner
        || useNavigationStore.getState().generation !== generation) return;
      if (!value) {
        const reason = restorationError(useAnalysisStore.getState().error);
        if (reason === 'unauthorized') useAuthStore.getState().clearAuth();
        else useNavigationStore.getState().fail(generation, reason);
        return;
      }
      if (value.hasCompletedResult) useSessionStore.getState().consumeInitialAnalysis();
      useSessionStore.setState({ sessionInfo: value.info });
      setLoaded({ entry, value });
      setMarkerEntry(entry);
      const restored = completeWorkspaceRestore(owner, session, generation, value);
      if (restored.accepted) analyzeFreshSession(restored.cycle, value);
    };
    void load();
    return () => { cancelled = true; };
  }, [session, owner, entry, retryGeneration]);
  useEffect(() => {
    const retry = () => setRetryGeneration(value => value + 1);
    window.addEventListener('workspace-load-retry', retry);
    return () => window.removeEventListener('workspace-load-retry', retry);
  }, []);
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
        setMarkerEntry(entry);
      } catch (error) {
        if (request === sequence && useSessionStore.getState().entryGeneration === entry) useAnalysisStore.getState().failInputRefresh(error);
      }
    };
    const refreshMarkers = () => { setMarkerEntry(null); void refresh(); };
    window.addEventListener('markers-changed', refreshMarkers);
    window.addEventListener('welltypes-changed', refresh);
    return () => {
      sequence++;
      window.removeEventListener('markers-changed', refreshMarkers);
      window.removeEventListener('welltypes-changed', refresh);
    };
  }, [session, owner, entry]);
  return { ready: status === 'ready' && loaded?.entry === entry, markersAvailable: markerEntry === entry, status, markers: loaded?.value.markers ?? [], retry: () => setRetryGeneration(value => value + 1) };
}
