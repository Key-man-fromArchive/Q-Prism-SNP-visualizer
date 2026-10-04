// @TASK MULTI-CURVE-T2 - amplification curve display choices
// @SPEC docs/planning/multi-well-curves-2026-10-04/PLAN.md#d6-상태접근성기타
//
// Held for the browser session (not persisted): the choices survive switching
// between the scatter and curve views, and between screens that remount the
// curve panel, but a reload starts from the defaults again.
import { create } from 'zustand';
import type { ColourBasis, CurveChannels, YScale } from '@/lib/amplification-traces';

type CurveViewState = {
  channels: CurveChannels;
  colourBasis: ColourBasis;
  yScale: YScale;
  setChannels: (v: CurveChannels) => void;
  setColourBasis: (v: ColourBasis) => void;
  setYScale: (v: YScale) => void;
};

export const useCurveViewStore = create<CurveViewState>((set) => ({
  channels: 'both',
  colourBasis: 'channel',
  yScale: 'linear',
  setChannels: (channels) => set({ channels }),
  setColourBasis: (colourBasis) => set({ colourBasis }),
  setYScale: (yScale) => set({ yScale }),
}));
