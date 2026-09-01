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
  clusterAssignments: Record<string, string>;
  wellTypeAssignments: Record<string, string>;
  boundaries: number[] | null; // K-1 internal radial-line positions (descending fam-fraction)
  offset: number;              // dosage of the lowest observed class (window position in 0..ploidy)
  offsetUncertain: boolean;    // true when auto could not anchor the offset
  lowSeparation: boolean;      // true when adjacent dosage classes overlap (poorly resolved)
  ntcCorner: { fam: number; allele2: number } | null;
  // Actions
  setScatterData: (
    points: ScatterPoint[],
    allele2Dye: string,
    channelLabels?: ChannelLabels | null,
    ratioOrigin?: RatioOrigin | null
  ) => void;
  setPlateData: (wells: PlateWell[]) => void;
  setClusterAssignments: (assignments: Record<string, string>) => void;
  setWellTypeAssignments: (assignments: Record<string, string>) => void;
  setBoundaries: (boundaries: number[] | null) => void;
  setOffset: (offset: number) => void;
  setOffsetUncertain: (v: boolean) => void;
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
  clusterAssignments: {},
  wellTypeAssignments: {},
  boundaries: null,
  offset: 0,
  offsetUncertain: false,
  lowSeparation: false,
  ntcCorner: null,

  setScatterData: (points, allele2Dye, channelLabels, ratioOrigin) =>
    set({
      scatterPoints: points,
      allele2Dye,
      channelLabels: channelLabels ?? null,
      ratioOrigin: ratioOrigin ?? ZERO_ORIGIN,
    }),
  setPlateData: (wells) => set({ plateWells: wells }),
  setClusterAssignments: (assignments) =>
    set((state) => ({
      clusterAssignments: assignments,
      // Keep the already-loaded plate in sync without another /plate request.
      // Cycle changes still fetch fresh RFU values; clustering only changes the
      // call displayed on each existing well.
      plateWells: state.plateWells.map((well) => ({
        ...well,
        auto_cluster: assignments[well.well] ?? null,
      })),
    })),
  setWellTypeAssignments: (assignments) =>
    set({ wellTypeAssignments: assignments }),
  setBoundaries: (boundaries) => set({ boundaries }),
  setOffset: (offset) => set({ offset }),
  setOffsetUncertain: (v) => set({ offsetUncertain: v }),
  setLowSeparation: (v) => set({ lowSeparation: v }),
  setNtcCorner: (ntcCorner) => set({ ntcCorner }),
  clearData: () =>
    set({
      scatterPoints: [],
      plateWells: [],
      allele2Dye: '',
      channelLabels: null,
      ratioOrigin: ZERO_ORIGIN,
      clusterAssignments: {},
      wellTypeAssignments: {},
      boundaries: null,
      offset: 0,
      offsetUncertain: false,
      lowSeparation: false,
      ntcCorner: null,
    }),
}));
