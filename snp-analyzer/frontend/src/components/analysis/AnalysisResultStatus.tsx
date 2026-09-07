import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { compareAnalysisView, inspectResult, resolveAnalysisView } from '@/lib/analysis-context';
import { useI18n } from '@/hooks/use-i18n';
import type { MarkerRegion } from '@/types/api';
import type { Translations } from '@/locales/en';

function revisionMessage(state: ReturnType<typeof useAnalysisStore.getState>, input: string, t: Translations) {
  if (state.inputRevisionRefreshing) return t.resultInputRefreshing;
  if (state.inputRevisionError !== null || input === 'unknown') return t.resultInputUnknown;
  return input === 'stale' ? t.resultInputStale : null;
}
function ViewComparison({ markers }: { markers: MarkerRegion[] }) {
  const state = useAnalysisStore();
  const cycles = useNavigationStore(value => value.availableCycles);
  const ploidy = useSettingsStore(value => value.ploidy);
  const { t } = useI18n();
  if (!state.currentRequest) return <p>{t.resultViewUnknown}</p>;
  try {
    const view = resolveAnalysisView(state.currentRequest, { markers, ploidy, cycles }, 'absolute');
    const compared = compareAnalysisView(state.result?.analysis_context, view);
    if (compared.status === 'unknown') return <p>{t.resultViewUnknown}</p>;
    if (compared.status === 'mismatch') return <p>{t.resultViewMismatch} {compared.reasons.map(t.resultReason).join(', ')}</p>;
    return <p>{t.resultMatched}</p>;
  } catch { return <p>{t.resultViewUnknown}</p>; }
}
function CompletedStatus({ markers }: { markers: MarkerRegion[] }) {
  const state = useAnalysisStore();
  const { t } = useI18n();
  const inspection = inspectResult(state.result, state.currentInputRevision);
  if (inspection.availability === 'missing') return state.pending || state.status === 'failed' ? null : <p>{t.resultMissing}</p>;
  const provenance = { legacy_unknown: t.resultLegacy, incomplete: t.resultIncomplete, verified: null, missing: null };
  const revision = revisionMessage(state, inspection.input, t);
  return <>
    <p>{t.resultCycle(state.result!.cycle)}</p>
    {provenance[inspection.provenance] && <p>{provenance[inspection.provenance]}</p>}
    {revision && <p>{revision}</p>}
    {inspection.provenance === 'verified' && <ViewComparison markers={markers} />}
  </>;
}
/** Last completion, latest request and input verification are independent facts. */
export function AnalysisResultStatus({ markers }: { markers: MarkerRegion[] }) {
  const pending = useAnalysisStore(state => state.pending);
  const failed = useAnalysisStore(state => state.status === 'failed');
  const retained = useAnalysisStore(state => state.result !== null);
  const { t } = useI18n();
  return <section role="status" aria-live="polite" aria-busy={pending} className="mx-6 my-2 rounded border border-border p-3 text-sm" data-testid="analysis-result-status">
    {pending && <p>{retained ? t.resultPending : t.resultPendingOnly}</p>}
    {failed && <p>{retained ? t.resultFailed : t.resultFailedOnly}</p>}
    <CompletedStatus markers={markers} />
  </section>;
}
