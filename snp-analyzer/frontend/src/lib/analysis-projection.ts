import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import type { ClusteringResult } from '@/types/api';

/** Compatibility projection for existing plot/table consumers, never an independent result owner. */
function metadata(result: ClusteringResult | null) {
  if (!result) return { boundaries: null, offset: 0, offsetUncertain: false, dosageMax: null, lowSeparation: false };
  return { boundaries: result.boundaries ?? null, offset: result.offset ?? 0,
    offsetUncertain: result.offset_uncertain ?? false, dosageMax: result.dosage_max ?? null,
    lowSeparation: result.low_separation ?? false };
}
function project(result: ClusteringResult | null) {
  const data = useDataStore.getState();
  data.setClusterAssignments(result?.assignments ?? {});
  useDataStore.setState(metadata(result));
}
export function connectAnalysisProjection(): () => void {
  project(useAnalysisStore.getState().result);
  return useAnalysisStore.subscribe((state, previous) => {
    if (state.result !== previous.result) project(state.result);
  });
}
