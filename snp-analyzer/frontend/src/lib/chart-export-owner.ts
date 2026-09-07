import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useAnalysisStore } from '@/stores/analysis-store';

/** The render's captured ownership must still describe the published result. */
export function ownsChartResult(entry: number, ownerId: string | undefined, revision: string): boolean {
  return useSessionStore.getState().entryGeneration === entry
    && useAuthStore.getState().user?.id === ownerId
    && useAnalysisStore.getState().result?.analysis_context?.result_revision === revision;
}
