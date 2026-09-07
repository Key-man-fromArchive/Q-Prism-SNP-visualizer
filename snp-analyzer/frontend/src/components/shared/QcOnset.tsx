import { useAnalysisStore } from '@/stores/analysis-store';
import { useI18n } from '@/hooks/use-i18n';

/** Only a user-requested full-curve recommendation produces this independent evaluation. */
export function QcOnset() {
  const recommendation = useAnalysisStore(state => state.recommendation);
  const { t } = useI18n();
  if (!recommendation) return null;
  const value = recommendation.suggestion;
  const message = value.ntc_onset_status === 'detected' && value.ntc_onset_cycle !== null
    ? t.qcOnsetDetected(value.ntc_onset_cycle) : t.qcOnsetStatus(value.ntc_onset_status);
  return <section aria-label={t.qcOnsetScope} className="mt-3">
    <h3>{t.qcOnsetScope}</h3><p>{message}</p>
    <p>{t.qcOnsetReason(value.ntc_onset_reason)}</p>
    <p>{t.qcOnsetRevision(recommendation.inputRevision)}</p>
  </section>;
}
