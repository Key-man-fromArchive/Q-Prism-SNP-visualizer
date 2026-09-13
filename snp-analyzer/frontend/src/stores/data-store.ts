import { create } from 'zustand';
import type { ChannelLabels, RatioOrigin, ScatterPoint, PlateWell } from '@/types/api';

/** Ratios measured from (0, 0) — what a plate with no background looks like. */
export const ZERO_ORIGIN: RatioOrigin = { fam: 0, allele2: 0, source: 'zero' };

interface DataState {
  scatterPoints: ScatterPoint[];
  plateWells: PlateWell[];
  allele2Dye: string;
  channelLabels: ChannelLabels | null;
  /** Origin the scatter's fam-fraction ratios and boundary rays start from.
   *  Supplied by the backend alongside the (raw) points, so the plot labels
   *  wells by exactly the geometry the backend clustered against. */
  ratioOrigin: RatioOrigin;
  /** Whether the loaded points really were divided by the passive reference.
   *  Read off the response, never off the `useRox` toggle — a run with no
   *  reference comes back raw either way, and the axes must say so. */
  normalizationApplied: boolean;
  normalizationReported: boolean;
  /** Wells whose passive reference is too far from the plate median to trust;
   *  excluded from the ratio-origin estimate by the backend. */
  roxOutlierWells: string[];
  clusterAssignments: Record<string, string>;
  wellTypeAssignments: Record<string, string>;
  boundaries: number[] | null; // K-1 internal radial-line positions (descending fam-fraction)
  offset: number;              // dosage of the lowest observed class (window position in 0..ploidy)
  offsetUncertain: boolean;    // true when auto could not anchor the offset
  /** Highest allele dosage this assay can produce, as declared by the
   *  operator; null when undeclared. A hexaploid marker commonly tops out at
   *  dosage 3, and saying so up front constrains the fit rather than
   *  correcting it afterwards. */
  dosageMax: number | null;
  lowSeparation: boolean;      // true when adjacent dosage classes overlap (poorly resolved)
  ntcCorner: { fam: number; allele2: number } | null;
  // Actions
  setScatterData: (
    points: ScatterPoint[],
    allele2Dye: string,
    channelLabels?: ChannelLabels | null,
    ratioOrigin?: RatioOrigin | null,
    normalization?: { applied?: boolean; roxOutlierWells?: string[] }
  ) => void;
  setPlateData: (wells: PlateWell[]) => void;
  setClusterAssignments: (
    assignments: Record<string, string>,
    confidences?: Record<string, number> | null
  ) => void;
  setWellTypeAssignments: (assignments: Record<string, string>) => void;
  setBoundaries: (boundaries: number[] | null) => void;
  setOffset: (offset: number) => void;
  setOffsetUncertain: (v: boolean) => void;
  setDosageMax: (v: number | null) => void;
  setLowSeparation: (v: boolean) => void;
  setNtcCorner: (corner: { fam: number; allele2: number } | null) => void;
  clearData: () => void;
}

export const useDataStore = create<DataState>((set) => ({
  scatterPoints: [],
  plateWells: [],
  allele2Dye: '',
  channelLabels: null,
  ratioOrigin: ZERO_ORIGIN,
  normalizationApplied: false,
  normalizationReported: false,
  roxOutlierWells: [],
  clusterAssignments: {},
  wellTypeAssignments: {},
  boundaries: null,
  offset: 0,
  offsetUncertain: false,
  dosageMax: null,
  lowSeparation: false,
  ntcCorner: null,

  setScatterData: (points, allele2Dye, channelLabels, ratioOrigin, normalization) =>
    set({
      scatterPoints: points,
      allele2Dye,
      channelLabels: channelLabels ?? null,
      ratioOrigin: ratioOrigin ?? ZERO_ORIGIN,
      normalizationApplied: normalization?.applied ?? false,
      normalizationReported: typeof normalization?.applied === 'boolean',
      roxOutlierWells: normalization?.roxOutlierWells ?? [],
    }),
  setPlateData: (wells) => set({ plateWells: wells }),
  setClusterAssignments: (assignments, confidences) =>
    set((state) => ({
      clusterAssignments: assignments,
      // Keep the already-loaded plate AND scatter points in sync without
      // another /plate or /scatter request. Cycle changes still fetch fresh
      // RFU values; clustering only changes the call (and its confidence)
      // shown on each existing well.
      // Regression: WellDetailPanel/ResultsTable read auto_cluster and
      // confidence off `scatterPoints`, not off `clusterAssignments` or
      // `plateWells`. A fresh session's auto-cluster-on-load never triggers
      // a scatter refetch, so without this the Confidence/genotype columns
      // stayed blank forever even after a real clustering result arrived.
      plateWells: state.plateWells.map((well) => ({
        ...well,
        auto_cluster: assignments[well.well] ?? null,
        confidence: confidences?.[well.well] ?? null,
      })),
      scatterPoints: state.scatterPoints.map((point) => ({
        ...point,
        auto_cluster: assignments[point.well] ?? null,
        confidence: confidences?.[point.well] ?? null,
      })),
    })),
  setWellTypeAssignments: (assignments) =>
    set({ wellTypeAssignments: assignments }),
  setBoundaries: (boundaries) => set({ boundaries }),
  setOffset: (offset) => set({ offset }),
  setOffsetUncertain: (v) => set({ offsetUncertain: v }),
  setDosageMax: (v) => set({ dosageMax: v }),
  setLowSeparation: (v) => set({ lowSeparation: v }),
  setNtcCorner: (ntcCorner) => set({ ntcCorner }),
  clearData: () =>
    set({
      scatterPoints: [],
      plateWells: [],
      allele2Dye: '',
      channelLabels: null,
      ratioOrigin: ZERO_ORIGIN,
      normalizationApplied: false,
      normalizationReported: false,
      roxOutlierWells: [],
      clusterAssignments: {},
      wellTypeAssignments: {},
      boundaries: null,
      offset: 0,
      offsetUncertain: false,
      dosageMax: null,
      lowSeparation: false,
      ntcCorner: null,
    }),
}));
