import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BackgroundMode } from '@/types/api';

/** How the scatter plots range their axes.
 *  - `zero`   : autoranged but anchored at 0, so the drawn origin IS the
 *               origin. Raw endpoint RFU spans e.g. 3800-11700 in x and
 *               2330-3370 in y, and a plain autorange puts (0, 0) off-canvas
 *               entirely — the middle of the data cloud then reads as the
 *               origin, which is where the ratio geometry visibly stops
 *               matching the calls.
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

interface SettingsState {
  useRox: boolean;
  backgroundMode: BackgroundMode;
  axisMode: AxisMode;
  scatterTool: ScatterTool;
  /** Equal data-per-pixel on both axes. A fam-fraction is an ANGLE about the
   *  ratio origin, so the radial boundary rays only look like the cuts they
   *  are when x and y are on the same scale. Raw RFU is ~8x wider in x than
   *  in y on an allele-specific plate, which flattens every wedge. */
  lockAspect: boolean;
  fixAxis: boolean;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
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
  setLockAspect: (v: boolean) => void;
  setAxisRange: (r: { xMin: number; xMax: number; yMin: number; yMax: number }) => void;
  setFixAxis: (v: boolean) => void;
  setXMin: (v: number) => void;
  setXMax: (v: number) => void;
  setYMin: (v: number) => void;
  setYMax: (v: number) => void;
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
  lockAspect: true,
  // Kept for the Settings-tab control and the saved presets that carry it;
  // `axisMode: 'manual'` is the same thing reachable from the plot itself.
  fixAxis: false,
  // Placeholders only — 0..12 suits ROX-normalized values and is meaningless
  // for raw RFU, so "fit to data" writes real bounds before manual is useful.
  xMin: 0,
  xMax: 12,
  yMin: 0,
  yMax: 12,
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

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,

      setUseRox: (v) => set({ useRox: v }),
      setBackgroundMode: (v) => set({ backgroundMode: v }),
      setAxisMode: (v) => set({ axisMode: v, fixAxis: v === 'manual' }),
      setScatterTool: (v) => set({ scatterTool: v }),
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
    }
  )
);
