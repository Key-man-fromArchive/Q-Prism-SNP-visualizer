import { create } from 'zustand';

interface SelectionState {
  selectedWell: string | null;
  selectedWells: string[]; // multi-select
  selectedGroup: string | null; // well group filter (null = all)
  focusSelectedWells: boolean; // show only selected wells in scatter plots
  currentCycle: number;
  currentDataWindow: string | null; // "Pre-read", "Amplification", "Post-read"
  isPlaying: boolean;
  // Actions
  selectWell: (well: string | null, source?: 'scatter' | 'plate' | 'table') => void;
  selectWells: (wells: string[]) => void;
  /** Union with the current selection. The scatter plot can only ever box one
   *  rectangle at a time, and the wells an operator needs to act on are rarely
   *  a rectangle — on a real plate they are scattered across it. Without this,
   *  every new box wiped the previous one. */
  addWells: (wells: string[]) => void;
  /** Ctrl-click on a single point: in if it was out, out if it was in. */
  toggleWell: (well: string) => void;
  clearSelection: () => void;
  setGroup: (group: string | null) => void;
  setFocusSelectedWells: (focus: boolean) => void;
  setCycle: (cycle: number) => void;
  setDataWindow: (name: string | null) => void;
  setPlaying: (v: boolean) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedWell: null,
  selectedWells: [],
  selectedGroup: null,
  focusSelectedWells: false,
  currentCycle: 0,
  currentDataWindow: null,
  isPlaying: false,

  selectWell: (well) =>
    set({
      selectedWell: well,
      selectedWells: well ? [well] : [],
    }),
  selectWells: (wells) =>
    set({
      selectedWells: wells,
      selectedWell: wells.length === 1 ? wells[0] : null,
    }),
  addWells: (wells) =>
    set((state) => {
      const merged = Array.from(new Set([...state.selectedWells, ...wells]));
      return {
        selectedWells: merged,
        selectedWell: merged.length === 1 ? merged[0] : null,
      };
    }),
  toggleWell: (well) =>
    set((state) => {
      const next = state.selectedWells.includes(well)
        ? state.selectedWells.filter((w) => w !== well)
        : [...state.selectedWells, well];
      return {
        selectedWells: next,
        selectedWell: next.length === 1 ? next[0] : null,
      };
    }),
  clearSelection: () =>
    set({
      selectedWell: null,
      selectedWells: [],
      // `focusSelectedWells` deliberately survives: it is a view preference,
      // not part of the selection. Resetting it here meant a stray click on
      // empty plot canvas silently threw away the "selected only" view as
      // well as the selection.
    }),
  setGroup: (group) => set({ selectedGroup: group }),
  setFocusSelectedWells: (focus) => set({ focusSelectedWells: focus }),
  setCycle: (cycle) => set({ currentCycle: cycle }),
  setDataWindow: (name) => set({ currentDataWindow: name }),
  setPlaying: (v) => set({ isPlaying: v }),
}));
