import { serializeNavigation, useNavigationStore, type NavigationValue } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { writeViewCache } from './session-view-cache';
import { parseQualityTarget, type QualityTarget } from './quality-target';

type QualityRestore = (target: QualityTarget | null, query: string) => Promise<boolean>;
function historyTarget(state: unknown): QualityTarget | null {
  if (typeof state !== 'object' || state === null || !('qualityTarget' in state)) return null;
  return parseQualityTarget(state.qualityTarget);
}
function targetKey(target: QualityTarget | null) { return JSON.stringify(parseQualityTarget(target)); }

function writeLocation(value: NavigationValue & { qualityTarget?: QualityTarget | null }, method: 'pushState' | 'replaceState') {
  if (!value.session && !['project', 'references', 'library', 'users'].includes(value.tab)) return;
  const query = value.session ? serializeNavigation(value) : new URLSearchParams({ tab: value.tab }).toString();
  const target = `${location.pathname}?${query}${location.hash}`;
  const qualityTarget = parseQualityTarget(value.qualityTarget);
  if (target === `${location.pathname}${location.search}${location.hash}`
    && targetKey(qualityTarget) === targetKey(historyTarget(history.state))) return;
  history[method](qualityTarget ? { qualityTarget } : null, '', target);
}
function discreteChanged(value: NavigationValue, previous: NavigationValue) {
  return value.tab !== previous.tab || value.surface !== previous.surface || value.marker !== previous.marker;
}
function readyForHistory(state: ReturnType<typeof useNavigationStore.getState>, session: string | null) {
  return state.status === 'ready' && !state.exportRestoring && !state.qualityNavigating && state.session === session;
}
function canonicalEntry(state: ReturnType<typeof useNavigationStore.getState>, previous: ReturnType<typeof useNavigationStore.getState>) {
  return previous.status === 'restoring' && state.session !== null && previous.session === state.session
    && useSessionStore.getState().restoreQuery === null;
}
function writeQualityChange(state: ReturnType<typeof useNavigationStore.getState>, previous: ReturnType<typeof useNavigationStore.getState>, known: Set<string>) {
  if (targetKey(state.qualityTarget) === targetKey(previous.qualityTarget)) return false;
  if (state.qualityTarget) known.add(targetKey(state.qualityTarget));
  writeLocation(state, 'pushState');
  return true;
}
function writeGenerationChange(state: ReturnType<typeof useNavigationStore.getState>, previous: ReturnType<typeof useNavigationStore.getState>) {
  if (state.generation === previous.generation) return false;
  if (canonicalEntry(state, previous)) writeLocation(state, 'replaceState');
  return true;
}
/** Subscriptions observe user navigation only; restore completion itself is not a user event. */
export function connectWorkspaceHistory(owner: string, restore: () => void, restoreQuality?: QualityRestore): () => void {
  const entry = useSessionStore.getState().entryGeneration;
  const session = useSessionStore.getState().sessionId;
  const owns = () => useAuthStore.getState().user?.id === owner
    && useSessionStore.getState().entryGeneration === entry && useSessionStore.getState().sessionId === session;
  let fromHistory = false;
  let popSequence = 0;
  const knownTargets = new Set<string>();
  const pop = (event: PopStateEvent) => {
    if (!owns()) return;
    const popRequest = ++popSequence;
    const target = historyTarget(event.state);
    const sameSession = new URLSearchParams(location.search).get('session') === session;
    const liveTarget = target ? knownTargets.has(targetKey(target)) : useNavigationStore.getState().qualityTarget !== null;
    fromHistory = true;
    if (sameSession && liveTarget && restoreQuality) {
      void restoreQuality(target, location.search).finally(() => {
        if (popRequest === popSequence && owns()) fromHistory = false;
      });
    } else {
      try { restore(); } finally { fromHistory = false; }
    }
  };
  const navigation = useNavigationStore.subscribe((state, previous) => {
    if (!owns() || fromHistory) return;
    if (!readyForHistory(state, session)) return;
    if (writeQualityChange(state, previous, knownTargets)) return;
    if (writeGenerationChange(state, previous)) return;
    if (previous.session !== state.session) return;
    if (previous.exportRestoring) { writeLocation(state, 'replaceState'); return; }
    if (discreteChanged(state, previous)) writeLocation(state, 'pushState');
    else if (state.cycle !== previous.cycle) writeLocation(state, 'replaceState');
  });
  const settings = useSettingsStore.subscribe(state => {
    if (!owns()) return;
    const nav = useNavigationStore.getState();
    if (nav.status === 'ready' && !nav.exportRestoring && nav.session === session && session) writeViewCache(owner, session, state);
  });
  window.addEventListener('popstate', pop);
  return () => { popSequence++; navigation(); settings(); window.removeEventListener('popstate', pop); };
}
