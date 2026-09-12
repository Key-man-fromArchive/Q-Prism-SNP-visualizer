import { getSessionInfo } from './api';
import { isRecord } from './session-view-cache';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useNavigationStore, remapLegacyQuery } from '@/stores/navigation-store';
import type { NavigationTab } from '@/stores/navigation-store';

function restoreIndependentTab(query: string) {
  const tabs = new URLSearchParams(query).getAll('tab');
  const available: NavigationTab[] = ['project', 'references', 'library'];
  if (useAuthStore.getState().user?.role === 'admin') available.push('users');
  const tab = available.find(value => value === tabs[0]);
  if (tabs.length === 1 && tab) useNavigationStore.setState({ tab });
  else if (tabs.length) useNavigationStore.setState({ reasons: ['tab'] });
}

export function restorationError(error: unknown): string {
  if (!isRecord(error)) return 'network';
  if (error.status === 401) return 'unauthorized';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'not-found';
  return 'network';
}
/** Authorized metadata first. No guessed session information and no implicit analysis. */
export function createLocationRestore(owner: string) {
  let sequence = 0;
  const cancel = () => { sequence++; };
  const run = async () => {
    if (useAuthStore.getState().user?.id !== owner) return;
    const request = ++sequence;
    const rawQuery = location.search;
    // P3-S2-T1: a bookmarked/shared URL from before the P3-S1-T1 tab
    // restructure may still carry `tab=analysis`(+`surface`)/`tab=protocol`.
    // Remap it to the new tab id and rewrite the address bar to the
    // canonical form immediately -- before the (async) session lookup --
    // so a refresh always shows the new URL. `remapLegacyQuery` returns the
    // exact same string when there is nothing to remap, so this is a no-op
    // for every already-canonical URL.
    const query = remapLegacyQuery(rawQuery);
    if (query !== rawQuery) history.replaceState(null, '', `${location.pathname}?${query}${location.hash}`);
    const sessions = new URLSearchParams(query).getAll('session');
    useSessionStore.getState().reset();
    if (sessions.length === 0) { restoreIndependentTab(query); return; }
    const session = sessions[0];
    const generation = useNavigationStore.getState().beginRestore(session);
    if (sessions.length !== 1 || !session) { useNavigationStore.getState().fail(generation, 'invalid-url'); return; }
    const owns = () => request === sequence && useAuthStore.getState().user?.id === owner
      && useNavigationStore.getState().generation === generation;
    try {
      const info = await getSessionInfo(session);
      if (!owns()) return;
      useSessionStore.getState().setSession(session, info, 'reopen', query);
    } catch (error) {
      if (!owns()) return;
      const reason = restorationError(error);
      if (reason === 'unauthorized') useAuthStore.getState().clearAuth();
      else useNavigationStore.getState().fail(generation, reason);
    }
  };
  return { run, cancel };
}
