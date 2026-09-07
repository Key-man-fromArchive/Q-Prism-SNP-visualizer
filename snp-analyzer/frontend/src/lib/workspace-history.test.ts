import { beforeEach, expect, it, vi } from 'vitest';
import { connectWorkspaceHistory } from './workspace-history';
import { useNavigationStore as nav } from '@/stores/navigation-store';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { viewCacheKey } from './session-view-cache';
import type { QualityTarget } from './quality-target';

it('pushes distinct same-URL well targets and restores live history without session admission', async () => {
  nav.setState({ session: 's', cycle: 0, surface: 'analysis' });
  const target: QualityTarget = { session: 's', well: 'A1', source: 'curve', basis: 'unversioned',
    cycle: 0, useRox: false, inputRevision: null, resultRevision: null, marker: null };
  const admission = vi.fn();
  const restoreTarget = vi.fn(async (value: QualityTarget | null) => { nav.getState().setQualityTarget(value); return true; });
  const disconnect = connectWorkspaceHistory('u', admission, restoreTarget);
  const push = vi.spyOn(history, 'pushState');
  nav.getState().setQualityTarget(target);
  const first: unknown = history.state;
  nav.getState().setQualityTarget({ ...target, well: 'A2' });
  expect(push).toHaveBeenCalledTimes(2);
  expect(location.search).not.toContain('well');
  window.dispatchEvent(new PopStateEvent('popstate', { state: first }));
  await Promise.resolve();
  expect(restoreTarget).toHaveBeenCalledWith(target, location.search);
  expect(admission).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledTimes(2);
  disconnect();
});
it('does not restore ephemeral targets from a different entry or trust arbitrary history payloads', () => {
  nav.setState({ session: 's', cycle: 0, surface: 'analysis' });
  const restoreTarget = vi.fn();
  const disconnect = connectWorkspaceHistory('u', vi.fn(), restoreTarget);
  useSessionStore.setState({ entryGeneration: 2 });
  window.dispatchEvent(new PopStateEvent('popstate', { state: { qualityTarget: { well: 'A1', token: 'secret' } } }));
  expect(restoreTarget).not.toHaveBeenCalled();
  disconnect();
});
it('does not lift history suppression when an older pop finishes before the latest pop', async () => {
  nav.setState({ session: 's', cycle: 0, surface: 'analysis' });
  const target: QualityTarget = { session: 's', well: 'A1', source: 'curve', basis: 'unversioned',
    cycle: 0, useRox: false, inputRevision: null, resultRevision: null, marker: null };
  const finishes: ((value: boolean) => void)[] = [];
  const disconnect = connectWorkspaceHistory('u', vi.fn(), () => new Promise(done => finishes.push(done)));
  nav.getState().setQualityTarget(target);
  const first: unknown = history.state;
  nav.getState().setQualityTarget({ ...target, well: 'A2' });
  const second: unknown = history.state;
  const push = vi.spyOn(history, 'pushState');
  window.dispatchEvent(new PopStateEvent('popstate', { state: first }));
  window.dispatchEvent(new PopStateEvent('popstate', { state: second }));
  finishes[0](true);
  await Promise.resolve();
  nav.getState().setTab('quality');
  expect(push).not.toHaveBeenCalled();
  finishes[1](true);
  await Promise.resolve();
  disconnect();
});

beforeEach(() => { nav.getState().clear(); sessionStorage.clear();
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'user', display_name: null } });
  useSessionStore.setState({ sessionId: 's', entryGeneration: 1 });
  window.history.replaceState(null, '', '/prefix/?session=s&tab=analysis&surface=analysis&marker=&cycle=0#keep'); vi.restoreAllMocks(); });
it('pushes discrete navigation, replaces/deduplicates cycle and preserves path/hash', () => {
  nav.setState({ session: 's', cycle: 0, surface: 'analysis' });
  const push = vi.spyOn(history, 'pushState'); const replace = vi.spyOn(history, 'replaceState');
  const disconnect = connectWorkspaceHistory('u', () => {});
  nav.getState().setTab('settings'); nav.getState().setTab('settings');
  nav.getState().setCycle(10); nav.getState().setCycle(10);
  expect(push).toHaveBeenCalledTimes(1); expect(replace).toHaveBeenCalledTimes(1);
  expect(location.pathname).toBe('/prefix/'); expect(location.hash).toBe('#keep');
  disconnect();
});
it('restores popstate without rewriting and stops playback through the callback', () => {
  nav.setState({ session: 's', cycle: 40 });
  const restore = vi.fn(() => { const generation = nav.getState().beginRestore('s'); nav.getState().complete(generation, {
    reasons: [], value: { session: 's', tab: 'analysis', surface: 'analysis', marker: null, cycle: 0 } }); });
  const disconnect = connectWorkspaceHistory('u', restore);
  const push = vi.spyOn(history, 'pushState'); const replace = vi.spyOn(history, 'replaceState');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(restore).toHaveBeenCalledTimes(1); expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  disconnect();
});
it('suspends during export restore and makes one final replace', () => {
  nav.setState({ session: 's', cycle: 0, surface: 'analysis' });
  const disconnect = connectWorkspaceHistory('u', () => {});
  const replace = vi.spyOn(history, 'replaceState'); const push = vi.spyOn(history, 'pushState');
  nav.getState().setExportRestoring(true); nav.getState().setCycle(40); nav.getState().setMarker('m');
  expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  nav.getState().setExportRestoring(false);
  expect(replace).toHaveBeenCalledTimes(1); expect(push).not.toHaveBeenCalled();
  disconnect();
});
it('does not publish navigation from an obsolete session entry', () => {
  nav.setState({ session: 's', cycle: 0 });
  const disconnect = connectWorkspaceHistory('u', () => {});
  useSessionStore.setState({ entryGeneration: 2 });
  nav.getState().setCycle(10);
  useSettingsStore.setState({ useRox: false });
  expect(location.search).toContain('session=s');
  expect(location.search).toContain('cycle=0');
  expect(sessionStorage.getItem(viewCacheKey('u', 's'))).toBeNull();
  disconnect();
});
it.each(['restoring', 'error'] as const)('does not persist settings while %s', status => {
  nav.setState({ session: 's', status });
  const disconnect = connectWorkspaceHistory('u', () => {});
  useSettingsStore.setState({ useRox: false });
  expect(sessionStorage.getItem(viewCacheKey('u', 's'))).toBeNull();
  disconnect();
});
it('canonicalizes a newly admitted non-URL session once, preserving path and hash', () => {
  history.replaceState(null, '', '/prefix/?token=discard#keep');
  useSessionStore.setState({ restoreQuery: null });
  const generation = nav.getState().beginRestore('s');
  const disconnect = connectWorkspaceHistory('u', () => {});
  const replace = vi.spyOn(history, 'replaceState');
  nav.getState().complete(generation, { reasons: [], value: { session: 's', tab: 'analysis', surface: 'analysis', marker: null, cycle: 0 } });
  expect(replace).toHaveBeenCalledTimes(1);
  expect(location.pathname).toBe('/prefix/'); expect(location.hash).toBe('#keep');
  expect([...new URLSearchParams(location.search).keys()].sort()).toEqual(['cycle', 'marker', 'session', 'surface', 'tab']);
  expect(new URLSearchParams(location.search).get('session')).toBe('s');
  disconnect();
});
it('records independent tab navigation without data-bound query keys', () => {
  useSessionStore.getState().reset();
  history.replaceState(null, '', '/prefix/#anchor');
  const disconnect = connectWorkspaceHistory('u', () => {});
  nav.getState().setTab('project');
  expect(location.search).toBe('?tab=project');
  expect(location.pathname).toBe('/prefix/'); expect(location.hash).toBe('#anchor');
  disconnect();
});
it('does not rewrite a direct session URL during the intermediate admission clear', () => {
  useSessionStore.getState().reset();
  history.replaceState(null, '', '/prefix/?session=s&cycle=0#anchor');
  const disconnect = connectWorkspaceHistory('u', () => {});
  nav.getState().beginRestore('s');
  nav.getState().clear();
  expect(location.search).toBe('?session=s&cycle=0');
  disconnect();
});
