import { create } from 'zustand';
import type { DataWindow } from '@/types/api';
import type { QualityTarget } from '@/lib/quality-target';

// P3-S1-T1: top-level IA is Plate Setup / Raw data / Results (+ Quality/Statistics/
// Compare/Library/Project, Settings demoted to overflow). `analysis` + `protocol`
// no longer exist as tab ids -- `plate` and `results` each own one former
// `analysis` sub-surface directly, `rawdata` replaces `protocol`.
export const navigationTabs = ['plate', 'rawdata', 'results', 'settings', 'quality', 'statistics', 'compare', 'project', 'users', 'references', 'library', 'feedback'] as const;
export type NavigationTab = typeof navigationTabs[number];
export type WorkspaceSurface = 'plate' | 'analysis';
/**
 * `NavigationValue.tab` also still accepts the pre-P3-S1-T1 `'analysis'` value:
 * `quality-navigation.ts` (P3-S2-T1) writes it directly via `setState` when
 * routing to a quality target, and root `tests/**`/other unit tests use it as a
 * generic "the workspace is open" placeholder. Nothing here should compare
 * against the literal `'analysis'` string to decide what to *render* --
 * `isWorkspaceTab` and `resolveDisplayTab` below normalize it into `plate`/
 * `results`. `setTab` (used by the top-level TabNavigation) never writes it.
 */
type StoredTab = NavigationTab | 'analysis';
export type NavigationValue = {
  session: string | null; tab: StoredTab; surface: WorkspaceSurface; marker: string | null; cycle: number | null;
};
export type NavigationDomain = {
  session: string; cycles: number[]; windows: DataWindow[]; markers: string[]; defaults: NavigationValue;
};
export type ValidatedNavigation = { value: NavigationValue; reasons: string[] };
const keys = ['session', 'tab', 'surface', 'marker', 'cycle'] as const;
const initial: NavigationValue = { session: null, tab: 'results', surface: 'plate', marker: null, cycle: null };
/** True while `tab` is (or, via the pre-migration `'analysis'` synonym, resolves
 *  to) one of the two workspace surfaces -- used by keyboard-authority and
 *  quality-focus gating instead of a stale exact match on `'analysis'`. */
export function isWorkspaceTab(tab: StoredTab): boolean {
  return tab === 'plate' || tab === 'results' || tab === 'analysis';
}
/**
 * P21-BACKGROUND: single, reusable source of truth for "is the Results
 * surface actually the thing on screen right now" -- `surface` alone is
 * *not* enough, and several call sites (each guessing independently) had
 * started to disagree about it. `setTab` only keeps `surface` in sync with
 * the active tab while that tab is `plate`/`results`; moving to any other
 * top-level tab (settings, quality, project, ...) leaves `surface` exactly
 * as it was on the workspace, even though `App.tsx` CSS-hides the entire
 * workspace (`AnalysisWorkspace`, and everything mounted inside it) the
 * moment `tab` stops being a workspace tab. A consumer that only checks
 * `surface !== 'analysis'` therefore reports "foregrounded" for a panel that
 * is, in fact, invisible -- see `MultiMarkerAnalysisPanel.tsx`'s auto-cluster
 * debounce and `CycleControl.tsx`'s playback loop, both of which used to
 * (or, for playback, simply never checked at all) skip this and would run
 * real network side effects for a screen nobody can see.
 */
export function isResultsSurfaceActive(state: Pick<NavigationValue, 'tab' | 'surface'>): boolean {
  return isWorkspaceTab(state.tab) && state.surface === 'analysis';
}
/** The tab the top-level nav should actually highlight/render for a given
 *  stored (tab, surface) pair -- collapses the legacy `'analysis'` synonym
 *  into the surface-appropriate new id. Never returns `'analysis'`. */
export function resolveDisplayTab(tab: StoredTab, surfaceValue: WorkspaceSurface): NavigationTab {
  if (tab !== 'analysis') return tab;
  return surfaceValue === 'plate' ? 'plate' : 'results';
}

/**
 * P3-S2-T1: old bookmarked/persisted URLs and `session-store.sessionQueries`
 * entries (from before P3-S1-T1's tab restructure) still use `tab=analysis`
 * paired with a `surface` sub-value, or `tab=protocol`. `parseNavigation`'s
 * `tab()` guard already refuses those as unrecognized and falls back to the
 * session's default tab -- a crash-safe fallback, but one that throws away
 * the user's actual destination (a bookmarked "Plate Setup" link would land
 * on the default tab instead). This maps them, meaning-preserving, onto the
 * new top-level tab id *and* keeps `surface` consistent with it (so
 * `AnalysisWorkspace`, which still reads `surface` directly to choose which
 * of its two panels is visible, doesn't end up showing the surface for a
 * different tab than the one the top nav highlights). A query with no
 * legacy `tab` value is returned completely unchanged -- same string, not
 * just an equivalent one -- so an already-canonical query is never
 * reordered or rewritten.
 *
 * `surface` defaulted to `'plate'` pre-migration (see this store's `initial`
 * before P3-S1-T1), so a bare `tab=analysis` with no `surface` maps the same
 * way `surface=plate` would.
 */
export function remapLegacyQuery(query: string): string {
  const params = new URLSearchParams(query);
  const legacyTab = params.get('tab');
  if (legacyTab === 'protocol') {
    params.set('tab', 'rawdata');
    return params.toString();
  }
  if (legacyTab === 'analysis') {
    const resolvedSurface: WorkspaceSurface = params.get('surface') === 'analysis' ? 'analysis' : 'plate';
    params.set('tab', resolvedSurface === 'analysis' ? 'results' : 'plate');
    params.set('surface', resolvedSurface);
    return params.toString();
  }
  return query;
}

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
  return { session: domain.session, tab: tab(domain.defaults.tab) ? domain.defaults.tab : 'results',
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
    // Keeps `surface` (still consumed by quality-navigation.ts/quality-target.ts
    // and history/return-view snapshots) in sync whenever the top-level nav
    // moves to one of the two workspace tabs; leaves it untouched otherwise so
    // a later return-from-quality/history restore still knows which surface
    // to come back to.
    setTab: tab => set(state => ({ tab, surface: tab === 'plate' ? 'plate' : tab === 'results' ? 'analysis' : state.surface })),
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
