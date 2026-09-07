import { getCluster, getMarkers, getSessionInfo } from './api';
import { resolveQualityTarget, qualityTargetMatchesView, type QualityTarget, type ResolvedQualityTarget } from './quality-target';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useNavigationStore, parseNavigation, serializeNavigation, type NavigationValue } from '@/stores/navigation-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import { publishQualityMetadata } from './quality-metadata';
import type { ClusterResponse, MarkerRegion, SessionInfoResponse } from '@/types/api';

let sequence = 0;
function lease(session: string) {
  const owner = useAuthStore.getState().user?.id;
  const auth = useAuthStore.getState().generation;
  const entry = useSessionStore.getState().entryGeneration;
  const request = ++sequence;
  return () => Boolean(owner) && request === sequence && useAuthStore.getState().user?.id === owner
    && useAuthStore.getState().generation === auth && useSessionStore.getState().entryGeneration === entry
    && useSessionStore.getState().sessionId === session;
}
function admitted(target: QualityTarget) {
  const nav = useNavigationStore.getState();
  return Boolean(useAuthStore.getState().user) && useSessionStore.getState().sessionId === target.session
    && nav.session === target.session && nav.status === 'ready' && !nav.exportRestoring;
}
type AcceptedTarget = { resolved: ResolvedQualityTarget; markers: MarkerRegion[]; info: SessionInfoResponse };
function matchingInput(result: ClusterResponse | null, revision: number) {
  return result?.input_revision === undefined || result.input_revision === revision;
}
async function resolve(target: QualityTarget): Promise<AcceptedTarget | null> {
  const [info, { markers }, result] = await Promise.all([
    getSessionInfo(target.session), getMarkers(target.session), target.source === 'ntc' ? getCluster(target.session) : Promise.resolve(null),
  ]);
  if (info.session_id !== target.session) return null;
  if (!matchingInput(result, info.input_revision)) return null;
  const resolved = resolveQualityTarget(target, { session: info.session_id, wells: info.well_ids ?? null,
    cycles: info.cycles, markers, inputRevision: info.input_revision,
    resultRevision: result?.analysis_context?.result_revision ?? null });
  return resolved ? { resolved, markers, info } : null;
}
function apply(accepted: AcceptedTarget) {
  const { target, surface } = accepted.resolved;
  publishQualityMetadata({ session: target.session, owner: useAuthStore.getState().user!.id,
    auth: useAuthStore.getState().generation, entry: useSessionStore.getState().entryGeneration,
    markers: accepted.markers, info: accepted.info });
  const nav = useNavigationStore.getState();
  const { session, tab, marker, cycle } = nav;
  const view: NavigationValue = { session, tab, marker, cycle, surface: nav.surface };
  useSelectionStore.getState().setPlaying(false);
  useNavigationStore.setState({ tab: 'analysis', surface, marker: target.marker, cycle: target.cycle,
    qualityTarget: target, qualityError: null, qualityNavigating: false,
    qualityEpoch: sequence,
    qualityReturn: nav.qualityReturn ?? { view, selection: [...useSelectionStore.getState().selectedWells] },
    qualityLease: { owner: useAuthStore.getState().user!.id, auth: useAuthStore.getState().generation,
      entry: useSessionStore.getState().entryGeneration, token: sequence } });
  useSelectionStore.getState().selectWell(target.well);
}
function finishReturn(view: NavigationValue, previous: ReturnType<typeof useNavigationStore.getState>['qualityReturn'], owns: () => boolean) {
  useSelectionStore.getState().setPlaying(false);
  useSelectionStore.getState().selectWells(previous?.selection ?? []);
  useNavigationStore.setState({ ...view, qualityTarget: null, qualityLease: null,
    qualityNavigating: false, qualityError: null, qualityEpoch: sequence, qualityReturn: null });
  requestAnimationFrame(() => { if (owns()) document.getElementById(`tab-${view.tab}`)?.focus(); });
}
export async function restoreQualityNavigation(target: QualityTarget | null, query: string): Promise<boolean> {
  if (target) return navigateQualityTarget(target);
  const nav = useNavigationStore.getState();
  const session = nav.session;
  if (!session || new URLSearchParams(query).get('session') !== session) return false;
  const owns = lease(session);
  useNavigationStore.setState({ qualityNavigating: true });
  try {
    const [info, { markers }] = await Promise.all([getSessionInfo(session), getMarkers(session)]);
    if (!owns()) return false;
    const restored = parseNavigation(query, { session, cycles: info.cycles, windows: info.data_windows ?? [],
      markers: markers.map(marker => marker.id), defaults: nav });
    if (restored.reasons.length) throw new Error('Unavailable return view');
    finishReturn(restored.value, nav.qualityReturn, owns);
    return true;
  } catch {
    if (owns()) useNavigationStore.setState({ qualityNavigating: false, qualityError: 'unavailable' });
    return false;
  }
}
export function returnFromQuality(): Promise<boolean> {
  const previous = useNavigationStore.getState().qualityReturn;
  if (!previous) return Promise.resolve(false);
  return restoreQualityNavigation(null, serializeNavigation(previous.view));
}
/** Reads only authorized metadata; never changes filters, well types or analysis results. */
export async function navigateQualityTarget(target: QualityTarget): Promise<boolean> {
  if (!admitted(target)) return false;
  const owns = lease(target.session);
  useNavigationStore.setState({ qualityNavigating: true, qualityError: null });
  try {
    const resolved = await resolve(target);
    if (!owns()) return false;
    if (!resolved || !qualityTargetMatchesView(target, useSettingsStore.getState())) throw new Error('Unavailable quality target');
    apply(resolved);
    return true;
  } catch {
    if (owns()) useNavigationStore.setState({ qualityNavigating: false, qualityError: 'unavailable' });
    return false;
  }
}
