import { expect, it } from 'vitest';
import { createNavigationStore, isWorkspaceTab, parseNavigation, resolveDisplayTab, serializeNavigation } from './navigation-store';
import type { QualityTarget } from '@/lib/quality-target';

const defaults = { session: 's', tab: 'results' as const, surface: 'plate' as const, marker: 'm', cycle: 20 };
const available = { session: 's', cycles: [0, 20, 40], windows: [{ name: 'post', start_cycle: 20, end_cycle: 40 }], markers: ['m'], defaults };
it('keeps a temporary quality target out of URLs and clears it at entry reset', () => {
  const store = createNavigationStore();
  const target: QualityTarget = { session: 's', well: 'A1', source: 'curve', basis: 'unversioned',
    cycle: 0, useRox: false, inputRevision: null, resultRevision: null, marker: null };
  store.setState({ ...defaults });
  store.getState().setQualityTarget(target);
  expect(store.getState().qualityTarget).toEqual(target);
  expect(serializeNavigation(store.getState())).not.toContain('A1');
  store.getState().beginRestore('other');
  expect(store.getState().qualityTarget).toBeNull();
  store.getState().setQualityTarget(target);
  store.getState().clear();
  expect(store.getState().qualityTarget).toBeNull();
});
it('roundtrips only navigation fields with absolute cycles', () => {
  const query = serializeNavigation({ ...defaults, cycle: 40 });
  expect(parseNavigation(query, available)).toEqual({ value: { ...defaults, cycle: 40 }, reasons: [] });
  expect(serializeNavigation({ ...defaults, token: 'secret' })).not.toContain('secret');
});
it('roundtrips an explicit whole-run marker selection independently of fallback marker', () => {
  const value = { ...defaults, marker: null };
  expect(parseNavigation(serializeNavigation(value), available).value.marker).toBeNull();
});
it('rejects duplicate, invalid window, stale marker and unsupported tab values with reasons', () => {
  const restored = parseNavigation('?session=s&tab=evil&surface=bad&marker=deleted&cycle=0&cycle=40', available);
  expect(restored.value).toEqual(defaults);
  expect(restored.reasons).toEqual(expect.arrayContaining(['tab', 'surface', 'marker', 'cycle:duplicate']));
  expect(parseNavigation('?cycle=0', available).reasons).toContain('cycle:unavailable');
});
it('ignores stale restoration generations and clears prior session state', () => {
  const store = createNavigationStore();
  const old = store.getState().beginRestore('s');
  const latest = store.getState().beginRestore('t');
  expect(store.getState().complete(old, { value: defaults, reasons: [] })).toBe(false);
  expect(store.getState().fail(latest, 'Unavailable')).toBe(true);
  expect(store.getState()).toMatchObject({ status: 'error', session: 't', marker: null, cycle: null });
});
it('completes once, keeps context fallbacks valid, and invalidates on clear', () => {
  const store = createNavigationStore();
  const generation = store.getState().beginRestore('s');
  expect(store.getState().complete(generation, parseNavigation('', available))).toBe(true);
  expect(store.getState().complete(generation, parseNavigation('', available))).toBe(false);
  expect(store.getState().fail(generation, 'late')).toBe(false);
  store.getState().clear();
  expect(store.getState()).toMatchObject({ session: null, cycle: null, marker: null, status: 'ready' });
  expect(parseNavigation('?session=other&cycle=40', available).reasons).toEqual(['session']);
  expect(parseNavigation('?cycle=-1', available).value.cycle).toBe(20);
  expect(parseNavigation('', { ...available, defaults: { ...defaults, cycle: 99, marker: 'deleted' } }).value).toEqual(defaults);
  expect(parseNavigation('?cycle=0', { ...available, windows: [] }).value.cycle).toBe(0);
});
it('recognizes plate/results (and the pre-P3-S1-T1 analysis synonym) as the workspace, nothing else', () => {
  expect(isWorkspaceTab('plate')).toBe(true);
  expect(isWorkspaceTab('results')).toBe(true);
  expect(isWorkspaceTab('analysis')).toBe(true);
  expect(isWorkspaceTab('quality')).toBe(false);
  expect(isWorkspaceTab('settings')).toBe(false);
});
it('resolves the legacy analysis tab to the surface-appropriate new tab, and passes new tabs through unchanged', () => {
  expect(resolveDisplayTab('analysis', 'plate')).toBe('plate');
  expect(resolveDisplayTab('analysis', 'analysis')).toBe('results');
  expect(resolveDisplayTab('plate', 'analysis')).toBe('plate');
  expect(resolveDisplayTab('quality', 'plate')).toBe('quality');
});
it('setTab keeps surface in sync with the two workspace tabs and leaves it alone elsewhere', () => {
  const store = createNavigationStore();
  store.getState().setTab('plate');
  expect(store.getState().surface).toBe('plate');
  store.getState().setTab('results');
  expect(store.getState().surface).toBe('analysis');
  store.getState().setTab('quality');
  expect(store.getState()).toMatchObject({ tab: 'quality', surface: 'analysis' });
});
