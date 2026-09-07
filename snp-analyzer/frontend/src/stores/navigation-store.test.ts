import { expect, it } from 'vitest';
import { createNavigationStore, parseNavigation, serializeNavigation } from './navigation-store';

const defaults = { session: 's', tab: 'analysis' as const, surface: 'plate' as const, marker: 'm', cycle: 20 };
const available = { session: 's', cycles: [0, 20, 40], windows: [{ name: 'post', start_cycle: 20, end_cycle: 40 }], markers: ['m'], defaults };
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
