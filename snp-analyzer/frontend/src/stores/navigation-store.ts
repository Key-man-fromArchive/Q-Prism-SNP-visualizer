import { create } from 'zustand';
import type { DataWindow } from '@/types/api';
import type { QualityTarget } from '@/lib/quality-target';

export const navigationTabs = ['analysis', 'protocol', 'settings', 'quality', 'statistics', 'compare', 'project', 'users', 'references', 'library'] as const;
export type NavigationTab = typeof navigationTabs[number];
export type WorkspaceSurface = 'plate' | 'analysis';
export type NavigationValue = {
  session: string | null; tab: NavigationTab; surface: WorkspaceSurface; marker: string | null; cycle: number | null;
};
export type NavigationDomain = {
  session: string; cycles: number[]; windows: DataWindow[]; markers: string[]; defaults: NavigationValue;
};
export type ValidatedNavigation = { value: NavigationValue; reasons: string[] };
const keys = ['session', 'tab', 'surface', 'marker', 'cycle'] as const;
const initial: NavigationValue = { session: null, tab: 'analysis', surface: 'plate', marker: null, cycle: null };

/** Whitelist only. Never serializes playback, auth credentials or report metadata. */
export function serializeNavigation<T extends NavigationValue>(value: T): string {
  const query = new URLSearchParams();
  for (const key of keys) if (value[key] !== null) query.set(key, String(value[key]));
  if (value.marker === null) query.set('marker', '');
  return query.toString();
}
function tab(value: string | null): value is NavigationTab { return navigationTabs.some(item => item === value); }
function surface(value: string | null): value is WorkspaceSurface { return value === 'plate' || value === 'analysis'; }
function validCycle(value: number | null, domain: NavigationDomain): value is number {
  if (value === null || !Number.isInteger(value) || !domain.cycles.includes(value)) return false;
  return domain.windows.length === 0 || domain.windows.some(window => value >= window.start_cycle && value <= window.end_cycle);
}
function safeDefaults(domain: NavigationDomain): NavigationValue {
  const fallbackCycle = domain.cycles.find(value => validCycle(value, domain)) ?? null;
  return { session: domain.session, tab: tab(domain.defaults.tab) ? domain.defaults.tab : 'analysis',
    surface: surface(domain.defaults.surface) ? domain.defaults.surface : 'plate',
    marker: defaultMarker(domain),
    cycle: validCycle(domain.defaults.cycle, domain) ? domain.defaults.cycle : fallbackCycle };
}
function defaultMarker(domain: NavigationDomain): string | null {
  if (domain.defaults.marker === null) return null;
  return domain.markers.includes(domain.defaults.marker) ? domain.defaults.marker : (domain.markers[0] ?? null);
}
function one(query: URLSearchParams, key: string, reasons: string[]): string | null {
  if (query.getAll(key).length > 1) { reasons.push(`${key}:duplicate`); return null; }
  return query.get(key);
}
function parseCycle(raw: string | null, domain: NavigationDomain, fallback: number | null, reasons: string[]): number | null {
  if (raw === null) return fallback;
  const cycle = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (validCycle(cycle, domain)) return cycle;
  reasons.push('cycle:unavailable'); return fallback;
}
function readSelection(query: URLSearchParams, value: NavigationValue, reasons: string[]): void {
  const requestedTab = one(query, 'tab', reasons);
  const requestedSurface = one(query, 'surface', reasons);
  if (requestedTab !== null) {
    if (tab(requestedTab)) value.tab = requestedTab; else reasons.push('tab');
  }
  if (requestedSurface !== null) {
    if (surface(requestedSurface)) value.surface = requestedSurface; else reasons.push('surface');
  }
}
/** Caller supplies the authorized session's available cycles/windows and saved-result defaults. */
export function parseNavigation(queryString: string, domain: NavigationDomain): ValidatedNavigation {
  const query = new URLSearchParams(queryString);
  const reasons: string[] = [];
  const value = safeDefaults(domain);
  const session = one(query, 'session', reasons);
  if (session !== null && session !== domain.session) return { value, reasons: [...reasons, 'session'] };
  readSelection(query, value, reasons);
  const marker = one(query, 'marker', reasons);
  if (marker !== null) {
    if (marker === '') value.marker = null;
    else if (domain.markers.includes(marker)) value.marker = marker;
    else reasons.push('marker');
  }
  value.cycle = parseCycle(one(query, 'cycle', reasons), domain, value.cycle, reasons);
  return { value, reasons };
}

interface NavigationState extends NavigationValue {
  qualityEpoch: number;
  qualityReturn: { view: NavigationValue; selection: string[] } | null;
  qualityLease: { owner: string; auth: number; entry: number; token: number } | null;
  qualityNavigating: boolean;
  qualityError: 'unavailable' | null;
  qualityTarget: QualityTarget | null;
  setQualityTarget: (target: QualityTarget | null) => void;
  availableCycles: number[];
  setAvailableCycles: (cycles: number[]) => void;
  generation: number; status: 'restoring' | 'ready' | 'error'; reasons: string[]; error: string | null;
  exportRestoring: boolean;
  setExportRestoring: (value: boolean) => void;
  beginRestore: (session: string) => number;
  complete: (generation: number, result: ValidatedNavigation) => boolean;
  fail: (generation: number, error: string) => boolean;
  clear: () => void;
  setTab: (tab: NavigationTab) => void;
  setSurface: (surface: WorkspaceSurface) => void;
  setCycle: (cycle: number) => void;
  setMarker: (marker: string | null) => void;
}
/** Foundation only: no location/sessionStorage effects and no analysis side effects. */
export function createNavigationStore() {
  return create<NavigationState>((set, get) => ({
    ...initial, generation: 0, status: 'ready', reasons: [], error: null, exportRestoring: false,
    qualityTarget: null, qualityNavigating: false, qualityError: null, qualityLease: null, qualityReturn: null, qualityEpoch: 0,
    setQualityTarget: target => set({ qualityTarget: target ? { ...target } : null }),
    availableCycles: [],
    setAvailableCycles: cycles => set({ availableCycles: [...cycles] }),
    setTab: tab => set({ tab }),
    setSurface: surface => set({ surface }),
    setCycle: cycle => set({ cycle }),
    setMarker: marker => set({ marker }),
    setExportRestoring: value => set({ exportRestoring: value }),
    beginRestore: session => {
      const generation = get().generation + 1;
      set({ ...initial, session, generation, status: 'restoring', reasons: [], error: null, availableCycles: [], exportRestoring: false, qualityTarget: null, qualityNavigating: false, qualityError: null, qualityLease: null, qualityReturn: null, qualityEpoch: 0 });
      return generation;
    },
    complete: (generation, result) => {
      if (get().generation !== generation || get().session !== result.value.session) return false;
      set({ ...result.value, reasons: [...result.reasons], status: 'ready', error: null, generation: generation + 1 });
      return true;
    },
    fail: (generation, error) => {
      if (get().generation !== generation) return false;
      set({ status: 'error', error, generation: generation + 1 }); return true;
    },
    clear: () => set({ ...initial, status: 'ready', reasons: [], error: null, availableCycles: [], exportRestoring: false, qualityTarget: null, qualityNavigating: false, qualityError: null, qualityLease: null, qualityReturn: null, qualityEpoch: 0, generation: get().generation + 1 }),
  }));
}
export const useNavigationStore = createNavigationStore();
