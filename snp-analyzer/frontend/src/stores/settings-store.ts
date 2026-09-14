import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PersistStorage } from 'zustand/middleware';
import type { BackgroundMode } from '@/types/api';

/** How the scatter plots range their axes.
 *  - `zero`   : legacy persisted name for the NTC-origin offset mode.
 *  - `auto`   : Plotly's own autorange (tight around the data).
 *  - `manual` : the explicit xMin/xMax/yMin/yMax below. */
export type AxisMode = 'zero' | 'auto' | 'manual';

/** What a drag on the scatter canvas does.
 *  - `select` : box/lasso-select wells. No drag handler of ours is armed, so
 *               Plotly gets every mousedown.
 *  - `edit`   : drag the NTC quadrant corner and the radial genotype
 *               boundaries.
 *
 *  These were previously both live at once, and the edit handlers won: a
 *  capture-phase mousedown within 18px of the NTC corner marker, or anywhere
 *  within 0.04 fam-fraction of a boundary ray, was swallowed with
 *  `stopImmediatePropagation()`. Since the corner marker and the rays sit
 *  inside the data cloud, that is exactly where an operator starts a
 *  selection box, so selection often could not be started at all. */
export type ScatterTool = 'select' | 'edit';

/** Scatter canvas aspect ratio (FB-04 §3-1, decision D-6). The height-only
 *  `max-height` clamp that used to bound the canvas cannot guarantee a
 *  ratio -- it clips height instead of holding width and height in lockstep
 *  -- so the canvas width is bound by this ratio instead. Left as an
 *  explicit user choice rather than a fixed value: readers differ on
 *  whether a square or a 4:3 rectangle reads better, and picking one
 *  forecloses the other. */
export type ScatterAspect = '4:3' | '1:1';

interface SettingsState {
  useRox: boolean;
  backgroundMode: BackgroundMode;
  axisMode: AxisMode;
  scatterTool: ScatterTool;
  scatterAspect: ScatterAspect;
  /** Equal data-per-pixel on both axes. A fam-fraction is an ANGLE about the
   *  ratio origin, so the radial boundary rays only look like the cuts they
   *  are when x and y are on the same scale. But raw RFU is routinely
   *  several times wider in x (FAM) than in y on an allele-specific plate
   *  (feedback 2026-09-11, report 4a83029e: FAM span 11,185 vs allele2 span
   *  2,748), so locking the scale squashes the whole plot into a strip along
   *  the bottom of the canvas on exactly the screens that don't have the
   *  rays turned on to benefit from the lock. Defaults to `false` for that
   *  reason; the scatter toolbar's lock button stays available for anyone
   *  who wants literal-angle rays. See SETTINGS_STORE_VERSION below for how
   *  an already-persisted `true` is brought back to this default once. */
  lockAspect: boolean;
  fixAxis: boolean;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** NTC-origin lower-axis margins, kept separately for raw and normalized
   *  displays because their units differ (RFU versus ratio-scaled values). */
  xNtcOffsetRaw: number;
  yNtcOffsetRaw: number;
  xNtcOffsetNormalized: number;
  yNtcOffsetNormalized: number;
  clusterAlgorithm: 'threshold' | 'kmeans';
  ntcThreshold: number;
  allele1RatioMax: number;
  allele2RatioMin: number;
  nClusters: number;
  ploidy: number; // allele copies per locus (2=diploid .. 8)
  showBoundaryLines: boolean; // draggable radial genotype-boundary lines (manual mode)
  showAutoCluster: boolean;
  showManualTypes: boolean;
  showEmptyWells: boolean;
  // Actions
  setUseRox: (v: boolean) => void;
  setBackgroundMode: (v: BackgroundMode) => void;
  setAxisMode: (v: AxisMode) => void;
  setScatterTool: (v: ScatterTool) => void;
  setScatterAspect: (v: ScatterAspect) => void;
  setLockAspect: (v: boolean) => void;
  setAxisRange: (r: { xMin: number; xMax: number; yMin: number; yMax: number }) => void;
  setFixAxis: (v: boolean) => void;
  setXMin: (v: number) => void;
  setXMax: (v: number) => void;
  setYMin: (v: number) => void;
  setYMax: (v: number) => void;
  setNtcAxisOffset: (basis: 'raw' | 'normalized', axis: 'x' | 'y', value: number) => void;
  resetNtcAxisOffsets: (basis: 'raw' | 'normalized') => void;
  setClusterAlgorithm: (algo: 'threshold' | 'kmeans') => void;
  setNtcThreshold: (v: number) => void;
  setAllele1RatioMax: (v: number) => void;
  setAllele2RatioMin: (v: number) => void;
  setNClusters: (n: number) => void;
  setPloidy: (n: number) => void;
  setShowBoundaryLines: (v: boolean) => void;
  setShowAutoCluster: (v: boolean) => void;
  setShowManualTypes: (v: boolean) => void;
  setShowEmptyWells: (v: boolean) => void;
  resetToDefaults: () => void;
}

const defaults = {
  useRox: true,
  // Raw RFU. An endpoint allele-specific read has no cycle that stands in for
  // zero signal, so subtracting one subtracts part of the answer.
  backgroundMode: 'none' as BackgroundMode,
  axisMode: 'zero' as AxisMode,
  scatterTool: 'select' as ScatterTool,
  scatterAspect: '4:3' as ScatterAspect,
  // See the field's own doc comment above (feedback 2026-09-11, P27):
  // was `true`; changed to `false` at SETTINGS_STORE_VERSION 1.
  lockAspect: false,
  // Kept for the Settings-tab control and the saved presets that carry it;
  // `axisMode: 'manual'` is the same thing reachable from the plot itself.
  fixAxis: false,
  // Placeholders only — 0..12 suits ROX-normalized values and is meaningless
  // for raw RFU, so "fit to data" writes real bounds before manual is useful.
  xMin: 0,
  xMax: 12,
  yMin: 0,
  yMax: 12,
  xNtcOffsetRaw: 100,
  yNtcOffsetRaw: 100,
  xNtcOffsetNormalized: 0.1,
  yNtcOffsetNormalized: 0.1,
  clusterAlgorithm: 'threshold' as const,
  ntcThreshold: 0.1,
  allele1RatioMax: 0.4,
  allele2RatioMin: 0.6,
  nClusters: 4,
  ploidy: 2,
  showBoundaryLines: false,
  showAutoCluster: true,
  showManualTypes: true,
  showEmptyWells: false,
};

/** Bump whenever a *default's meaning* changes such that an already-stored
 *  value would misrepresent the user's actual intent under the new
 *  default -- not for adding a new field (the persist `merge` below already
 *  supplies its default for legacy payloads with no such key -- see
 *  settings-store.test.ts's "legacy payload" case) and not for a change
 *  that only affects brand-new state. Write the one-time fix as a branch in
 *  `migrate` below, gated on the version the payload arrived at, and leave
 *  a comment next to it saying exactly what changes and why. Mirrors this
 *  repo's other "bump on behavior change, not on refactor" version counter,
 *  `CLUSTERING_ALGORITHM_VERSION` (app/processing/clustering.py).
 *
 *  v0 -> v1 (feedback 2026-09-11, P27): `lockAspect` default flipped
 *  `true` -> `false` (see the field's doc comment above). Any stored `true`
 *  from before this version is forced to `false` once, in `migrate`; the
 *  toolbar's lock button still works normally afterward, and a value the
 *  operator sets *after* migrating is never touched again because it is
 *  already at the current version. */
const SETTINGS_STORE_VERSION = 1;

/** Coerces a stored payload with no `version` key at all -- every payload
 *  written before this file introduced versioning, including the one from
 *  the user report this migration exists for -- to version 0, so it hits
 *  the same `migrate` branch as an explicit `version: 0`. zustand's persist
 *  only treats a payload as needing migration when `version` is already a
 *  number and differs from the current one; a genuinely absent key would
 *  otherwise skip migration entirely and merge straight in. */
function coerceMissingVersion<S>(base: PersistStorage<S> | undefined): PersistStorage<S> | undefined {
  if (!base) return base;
  return {
    ...base,
    getItem: (name) => {
      const result = base.getItem(name);
      if (result instanceof Promise) {
        return result.then((value) =>
          value && typeof value.version !== 'number' ? { ...value, version: 0 } : value
        );
      }
      return result && typeof result.version !== 'number' ? { ...result, version: 0 } : result;
    },
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,

      setUseRox: (v) => set({ useRox: v }),
      setBackgroundMode: (v) => set({ backgroundMode: v }),
      setAxisMode: (v) => set({ axisMode: v, fixAxis: v === 'manual' }),
      setScatterTool: (v) => set({ scatterTool: v }),
      setScatterAspect: (v) => set({ scatterAspect: v }),
      setLockAspect: (v) => set({ lockAspect: v }),
      setAxisRange: ({ xMin, xMax, yMin, yMax }) =>
        set({ xMin, xMax, yMin, yMax }),
      // The Settings-tab checkbox and the plot's mode selector are two views of
      // one decision, so each keeps the other true.
      setFixAxis: (v) => set({ fixAxis: v, axisMode: v ? 'manual' : 'zero' }),
      setXMin: (v) => set({ xMin: v }),
      setXMax: (v) => set({ xMax: v }),
      setYMin: (v) => set({ yMin: v }),
      setYMax: (v) => set({ yMax: v }),
      setNtcAxisOffset: (basis, axis, value) => {
        if (!Number.isFinite(value) || value < 0) return;
        const key = `${axis}NtcOffset${basis === 'raw' ? 'Raw' : 'Normalized'}` as
          | 'xNtcOffsetRaw' | 'yNtcOffsetRaw' | 'xNtcOffsetNormalized' | 'yNtcOffsetNormalized';
        set({ [key]: value } as Partial<SettingsState>);
      },
      resetNtcAxisOffsets: (basis) => set(basis === 'raw'
        ? { xNtcOffsetRaw: defaults.xNtcOffsetRaw, yNtcOffsetRaw: defaults.yNtcOffsetRaw }
        : { xNtcOffsetNormalized: defaults.xNtcOffsetNormalized, yNtcOffsetNormalized: defaults.yNtcOffsetNormalized }),
      setClusterAlgorithm: (algo) => set({ clusterAlgorithm: algo }),
      setNtcThreshold: (v) => set({ ntcThreshold: v }),
      setAllele1RatioMax: (v) => set({ allele1RatioMax: v }),
      setAllele2RatioMin: (v) => set({ allele2RatioMin: v }),
      setNClusters: (n) => set({ nClusters: n }),
      setPloidy: (n) => set({ ploidy: n }),
      setShowBoundaryLines: (v) => set({ showBoundaryLines: v }),
      setShowAutoCluster: (v) => set({ showAutoCluster: v }),
      setShowManualTypes: (v) => set({ showManualTypes: v }),
      setShowEmptyWells: (v) => set({ showEmptyWells: v }),
      resetToDefaults: () => set(defaults),
    }),
    {
      name: 'snp-analyzer-settings',
      storage: coerceMissingVersion(createJSONStorage(() => window.localStorage)),
      version: SETTINGS_STORE_VERSION,
      migrate: (persistedState, version) => {
        const state = { ...(persistedState as Partial<SettingsState>) };
        if (version < 1) {
          // v0 -> v1: see SETTINGS_STORE_VERSION above.
          state.lockAspect = false;
        }
        return state as SettingsState;
      },
    }
  )
);
