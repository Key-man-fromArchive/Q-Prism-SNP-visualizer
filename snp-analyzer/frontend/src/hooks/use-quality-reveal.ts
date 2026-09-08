import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { qualityTargetMatchesView, type QualityTarget } from '@/lib/quality-target';

function currentRevision(target: QualityTarget, input: number | null, result: string | null) {
  return target.source === 'curve' || (target.inputRevision === input && target.resultRevision === result);
}

/** Display-only exception. Never writes user filters or changes scientific input roles. */
export function useQualityReveal() {
  const target = useNavigationStore(state => state.qualityTarget);
  const lease = useNavigationStore(state => state.qualityLease);
  const owner = useAuthStore(state => state.user?.id);
  const auth = useAuthStore(state => state.generation);
  const session = useSessionStore(state => state.sessionId);
  const entry = useSessionStore(state => state.entryGeneration);
  const useRox = useSettingsStore(state => state.useRox);
  const backgroundMode = useSettingsStore(state => state.backgroundMode);
  const input = useAnalysisStore(state => state.currentInputRevision);
  const result = useAnalysisStore(state => state.result?.analysis_context?.result_revision ?? null);
  if (!target || !lease) return null;
  if (lease.owner !== owner || lease.auth !== auth || lease.entry !== entry) return null;
  if (target.session !== session || !qualityTargetMatchesView(target, { useRox, backgroundMode })) return null;
  if (!currentRevision(target, input, result)) return null;
  return target;
}
export function useQualityRevealedWell() { return useQualityReveal()?.well ?? null; }
