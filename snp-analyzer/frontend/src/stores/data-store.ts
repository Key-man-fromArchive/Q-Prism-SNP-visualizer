import { create } from 'zustand';
import type { ChannelLabels, ScatterPoint, PlateWell } from '@/types/api';

interface DataState {
  scatterPoints: ScatterPoint[];
  plateWells: PlateWell[];
  allele2Dye: string;
  channelLabels: ChannelLabels | null;
  clusterAssignments: Record<string, string>;
  wellTypeAssignments: Record<string, string>;
  // Actions
  setScatterData: (
    points: ScatterPoint[],
    allele2Dye: string,
    channelLabels?: ChannelLabels | null
  ) => void;
  setPlateData: (wells: PlateWell[]) => void;
  setClusterAssignments: (assignments: Record<string, string>) => void;
  setWellTypeAssignments: (assignments: Record<string, string>) => void;
  clearData: () => void;
}

export const useDataStore = create<DataState>((set) => ({
  scatterPoints: [],
  plateWells: [],
  allele2Dye: '',
  channelLabels: null,
  clusterAssignments: {},
  wellTypeAssignments: {},

  setScatterData: (points, allele2Dye, channelLabels) =>
    set({ scatterPoints: points, allele2Dye, channelLabels: channelLabels ?? null }),
  setPlateData: (wells) => set({ plateWells: wells }),
  setClusterAssignments: (assignments) =>
    set({ clusterAssignments: assignments }),
  setWellTypeAssignments: (assignments) =>
    set({ wellTypeAssignments: assignments }),
  clearData: () =>
    set({
      scatterPoints: [],
      plateWells: [],
      allele2Dye: '',
      channelLabels: null,
      clusterAssignments: {},
      wellTypeAssignments: {},
    }),
}));
