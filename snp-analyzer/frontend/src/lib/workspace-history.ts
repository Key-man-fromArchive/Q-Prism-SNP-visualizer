import { serializeNavigation, useNavigationStore, type NavigationValue } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { writeViewCache } from './session-view-cache';

function writeLocation(value: NavigationValue, method: 'pushState' | 'replaceState') {
  if (!value.session && !['project', 'references', 'library', 'users'].includes(value.tab)) return;
  const query = value.session ? serializeNavigation(value) : new URLSearchParams({ tab: value.tab }).toString();
  const target = `${location.pathname}?${query}${location.hash}`;
  if (target === `${location.pathname}${location.search}${location.hash}`) return;
  history[method](null, '', target);
}
function discreteChanged(value: NavigationValue, previous: NavigationValue) {
  return value.tab !== previous.tab || value.surface !== previous.surface || value.marker !== previous.marker;
}
function readyForHistory(state: ReturnType<typeof useNavigationStore.getState>, session: string | null) {
  return state.status === 'ready' && !state.exportRestoring && state.session === session;
}
function canonicalEntry(state: ReturnType<typeof useNavigationStore.getState>, previous: ReturnType<typeof useNavigationStore.getState>) {
  return previous.status === 'restoring' && state.session !== null && previous.session === state.session
    && useSessionStore.getState().restoreQuery === null;
}
/** Subscriptions observe user navigation only; restore completion itself is not a user event. */
export function connectWorkspaceHistory(owner: string, restore: () => void): () => void {
  const entry = useSessionStore.getState().entryGeneration;
  const session = useSessionStore.getState().sessionId;
  const owns = () => useAuthStore.getState().user?.id === owner
    && useSessionStore.getState().entryGeneration === entry && useSessionStore.getState().sessionId === session;
  let fromHistory = false;
  const pop = () => { fromHistory = true; try { restore(); } finally { fromHistory = false; } };
  const navigation = useNavigationStore.subscribe((state, previous) => {
    if (!owns() || fromHistory) return;
    if (!readyForHistory(state, session)) return;
    if (state.generation !== previous.generation) {
      if (canonicalEntry(state, previous)) writeLocation(state, 'replaceState');
      return;
    }
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
  return () => { navigation(); settings(); window.removeEventListener('popstate', pop); };
}
