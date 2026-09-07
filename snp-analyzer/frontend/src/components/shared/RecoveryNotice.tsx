import { useI18n } from '@/hooks/use-i18n';
import { useAuthStore } from '@/stores/auth-store';
import type { RecoveryReason } from '@/stores/upload-job-store';

export function RecoveryNotice({ reason, onRetry }: { reason: RecoveryReason | null; onRetry?: () => void }) {
  const { t } = useI18n();
  if (!reason) return null;
  const text = { unauthorized: t.recoveryUnauthorized, forbidden: t.recoveryForbidden,
    not_found: t.recoveryNotFound, network: t.recoveryNetwork, server: t.recoveryServer,
    invalid: t.recoveryInvalid, response_lost: t.recoveryUnknown }[reason];
  return <div role="alert" className="my-2 text-sm text-danger">
    <p>{text}</p>
    {reason === 'unauthorized' ? <button type="button" onClick={() => useAuthStore.getState().clearAuth()}>{t.recoverySignIn}</button>
      : onRetry && <button type="button" className="underline mt-1" onClick={onRetry}>{t.recoveryRetry}</button>}
  </div>;
}
