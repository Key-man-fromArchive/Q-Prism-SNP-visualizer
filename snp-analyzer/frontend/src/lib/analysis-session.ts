import type { MarkerRegion, SessionInfoResponse } from '@/types/api';
import { getCluster, getMarkers, getPloidy, getSessionInfo } from '@/lib/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { isRevision } from '@/lib/analysis-context';

export type ReadyAnalysisSession = { markers: MarkerRegion[]; ploidy: number; hasCompletedResult: boolean; info: SessionInfoResponse };
/** A failed/obsolete load is not an empty plate and must never authorize first-run analysis. */
export async function loadAnalysisSession(): Promise<ReadyAnalysisSession | null> {
  const ticket = useAnalysisStore.getState().beginRequest('load');
  try {
    const [result, { markers }, { ploidy }, info] = await Promise.all([
      getCluster(ticket.sessionId), getMarkers(ticket.sessionId), getPloidy(ticket.sessionId), getSessionInfo(ticket.sessionId),
    ]);
    if (!Array.isArray(info.cycles) || info.cycles.length === 0 || !info.cycles.every(cycle => Number.isInteger(cycle) && cycle >= 0)) throw new Error('Actual acquisition cycles unavailable');
    if (!isRevision(info.input_revision)) throw new Error('Input revision unavailable');
    if (!useAnalysisStore.getState().accept(ticket, result)) return null;
    useAnalysisStore.getState().updateInputRevision(ticket.sessionId, ticket.ownerId, info.input_revision);
    return { markers: structuredClone(markers), ploidy, hasCompletedResult: result.algorithm !== null, info: structuredClone(info) };
  } catch (error) {
    useAnalysisStore.getState().fail(ticket, error);
    return null;
  }
}
