import { create } from 'zustand';

interface SelectionState {
  selectedWell: string | null;
  selectedWells: string[]; // multi-select
  currentCycle: number;
  currentDataWindow: string | null; // "Pre-read", "Amplification", "Post-read"
  isPlaying: boolean;
  // Actions
  selectWell: (well: string | null, source?: 'scatter' | 'plate' | 'table') => void;
  selectWells: (wells: string[]) => void;
  clearSelection: () => void;
  setCycle: (cycle: number) => void;
  setDataWindow: (name: string | null) => void;
  setPlaying: (v: boolean) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedWell: null,
  selectedWells: [],
  currentCycle: 0,
  currentDataWindow: null,
  isPlaying: false,

  selectWell: (well, _source) =>
    set({
      selectedWell: well,
      selectedWells: well ? [well] : [],
    }),
  selectWells: (wells) =>
    set({
      selectedWells: wells,
      selectedWell: wells.length === 1 ? wells[0] : null,
    }),
  clearSelection: () =>
    set({
      selectedWell: null,
      selectedWells: [],
    }),
  setCycle: (cycle) => set({ currentCycle: cycle }),
  setDataWindow: (name) => set({ currentDataWindow: name }),
  setPlaying: (v) => set({ isPlaying: v }),
}));
