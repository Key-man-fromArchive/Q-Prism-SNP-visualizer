import { create } from 'zustand';

/** Session-only (not persisted) UI state of the amplification QC editor, so it survives remounts on marker switch or re-analysis. */
interface QcUiState {
  controlsOpen: boolean;
  setControlsOpen: (open: boolean) => void;
}

export const useQcUiStore = create<QcUiState>()((set) => ({
  controlsOpen: false,
  setControlsOpen: (controlsOpen) => set({ controlsOpen }),
}));
