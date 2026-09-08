import { useI18n } from '@/hooks/use-i18n';
import { useQualityReveal } from '@/hooks/use-quality-reveal';
import { useNavigationStore } from '@/stores/navigation-store';
import { returnFromQuality } from '@/lib/quality-navigation';
import { Callout } from './ui';
function hasNotice(stored: unknown, pending: boolean, error: unknown) { return Boolean(stored || pending || error); }

export function QualityNavigationNotice() {
  const { t } = useI18n();
  const target = useQualityReveal();
  const stored = useNavigationStore(state => state.qualityTarget);
  const pending = useNavigationStore(state => state.qualityNavigating);
  const error = useNavigationStore(state => state.qualityError);
  const previous = useNavigationStore(state => state.qualityReturn);
  if (!hasNotice(stored, pending, error)) return null;
  const unavailable = Boolean(error) || (stored !== null && target === null);
  return <Callout role="status" aria-live="polite" aria-busy={pending}
    tone={unavailable ? 'warning' : 'info'} className="mx-4 my-2" data-testid="quality-navigation-notice">
    <span className="block">{pending ? t.qualityJumpLoading : unavailable ? t.qualityJumpUnavailable : t.qualityTemporaryReveal(target!.well)}</span>
    {target && <span className="block break-all">{target.source === 'curve'
      ? t.qualityCurveScope(target.session, target.useRox)
      : t.qualityNtcScope(target.inputRevision, target.resultRevision, target.cycle, target.useRox, target.background)}</span>}
    {previous ? <button type="button" disabled={pending} className="text-primary underline"
      onClick={() => { void returnFromQuality(); }}>{t.qualityReturn}</button>
      : <button type="button" disabled={pending} className="text-primary underline"
        onClick={() => useNavigationStore.setState({ qualityError: null, qualityTarget: null, qualityLease: null })}>{t.qualityDismiss}</button>}
  </Callout>;
}
