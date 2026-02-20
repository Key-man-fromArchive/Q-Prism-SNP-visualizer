import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  useRox: boolean;
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
  showAutoCluster: boolean;
  showManualTypes: boolean;
  showEmptyWells: boolean;
  // Actions
  setUseRox: (v: boolean) => void;
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
  setShowAutoCluster: (v: boolean) => void;
  setShowManualTypes: (v: boolean) => void;
  setShowEmptyWells: (v: boolean) => void;
  resetToDefaults: () => void;
}

const defaults = {
  useRox: true,
  fixAxis: false,
  xMin: 0,
  xMax: 12,
  yMin: 0,
  yMax: 12,
  clusterAlgorithm: 'threshold' as const,
  ntcThreshold: 0.1,
  allele1RatioMax: 0.4,
  allele2RatioMin: 0.6,
  nClusters: 4,
  showAutoCluster: true,
  showManualTypes: true,
  showEmptyWells: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,

      setUseRox: (v) => set({ useRox: v }),
      setFixAxis: (v) => set({ fixAxis: v }),
      setXMin: (v) => set({ xMin: v }),
      setXMax: (v) => set({ xMax: v }),
      setYMin: (v) => set({ yMin: v }),
      setYMax: (v) => set({ yMax: v }),
      setClusterAlgorithm: (algo) => set({ clusterAlgorithm: algo }),
      setNtcThreshold: (v) => set({ ntcThreshold: v }),
      setAllele1RatioMax: (v) => set({ allele1RatioMax: v }),
      setAllele2RatioMin: (v) => set({ allele2RatioMin: v }),
      setNClusters: (n) => set({ nClusters: n }),
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
