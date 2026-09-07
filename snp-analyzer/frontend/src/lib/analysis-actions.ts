import type { ClusteringRequest } from '@/types/api';
import { runClustering, suggestCycle } from '@/lib/api';
import { useAnalysisStore, type AnalysisTicket } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';

function readyToAnalyze() {
  const state = useAnalysisStore.getState();
  return useNavigationStore.getState().status === 'ready' && state.sessionId !== null && state.ownerId !== null;
}

async function submit(ticket: AnalysisTicket, request: ClusteringRequest): Promise<boolean> {
  useAnalysisStore.getState().captureRequest(request);
  const result = await runClustering(ticket.sessionId, request);
  return useAnalysisStore.getState().accept(ticket, result);
}
/** Every analysis entry point shares the same session/owner/generation authority. */
export async function analyzeCurrent(request: ClusteringRequest): Promise<boolean> {
  if (!readyToAnalyze()) return false;
  useAnalysisStore.getState().setCurrentRequest(request);
  const ticket = useAnalysisStore.getState().beginRequest('analysis');
  try { return await submit(ticket, structuredClone(request)); }
  catch (error) { useAnalysisStore.getState().fail(ticket, error); return false; }
}
export async function analyzeRecommended(request: ClusteringRequest, navigate: (cycle: number) => void): Promise<boolean> {
  if (!readyToAnalyze()) return false;
  useAnalysisStore.getState().setCurrentRequest(request);
  const ticket = useAnalysisStore.getState().beginRequest('analysis');
  const captured = structuredClone(request);
  try {
    const suggestion = await suggestCycle(ticket.sessionId);
    if (!useAnalysisStore.getState().isCurrent(ticket)) return false;
    const cycle = suggestion.suggested_cycle ?? captured.cycle;
    navigate(cycle);
    if (!useAnalysisStore.getState().isCurrent(ticket)) return false;
    return await submit(ticket, { ...captured, cycle });
  } catch (error) { useAnalysisStore.getState().fail(ticket, error); return false; }
}
