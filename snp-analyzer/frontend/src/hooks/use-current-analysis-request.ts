import { useEffect, useRef } from 'react';
import type { ClusteringRequest } from '@/types/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore, isWorkspaceTab } from '@/stores/navigation-store';

/** Each request field belongs to its explicit control; untouched manual fields stay owned by the direct action. */
function patchCurrentView(previous: ClusteringRequest, next: ClusteringRequest) {
  const current = useAnalysisStore.getState().currentRequest ?? next;
  const patch = Object.fromEntries(Object.entries(next).filter(([key, value]) =>
    key !== 'threshold_config' && value !== previous[key as keyof ClusteringRequest]));
  let thresholds = current.threshold_config;
  if (next.threshold_config === null) thresholds = null;
  else if (next.threshold_config) {
    const changes = Object.fromEntries(Object.entries(next.threshold_config).filter(([key, value]) =>
      value !== previous.threshold_config?.[key as keyof NonNullable<ClusteringRequest['threshold_config']>]));
    thresholds = { ...next.threshold_config, ...thresholds, ...changes };
  }
  useAnalysisStore.getState().setCurrentRequest({ ...current, ...patch, threshold_config: thresholds });
}

/**
 * Register the active surface's explicit request builder, never
 * result-derived fitted parameters.
 *
 * `surface: 'analysis'` predates P3-S1-T1's Plate Setup/Results split: it
 * means "either workspace tab is open" (AnalysisTab/MultiMarkerAnalysisPanel
 * are mounted -- and stay registered -- whether the top-level tab is `plate`
 * or `results`, exactly like before the split), so it matches via
 * `isWorkspaceTab` rather than an exact `state.tab` comparison.
 */
export function useCurrentAnalysisRequest(request: ClusteringRequest, surface: 'analysis' | 'settings') {
  const active = useNavigationStore(state =>
    (surface === 'analysis' ? isWorkspaceTab(state.tab) : state.tab === surface) && state.status === 'ready');
  const session = useAnalysisStore(state => state.sessionId);
  const previous = useRef<ClusteringRequest | null>(null);
  useEffect(() => { previous.current = null; }, [session]);
  useEffect(() => {
    if (!active) { previous.current = null; return; }
    if (previous.current) patchCurrentView(previous.current, request);
    else useAnalysisStore.getState().setCurrentRequest(request);
    previous.current = request;
  }, [active, request]);
}
