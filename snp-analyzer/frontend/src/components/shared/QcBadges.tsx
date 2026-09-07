import { useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { qcRequestKey, useQcResponse, type QcQuery } from '@/hooks/use-qc-response';
import { useI18n } from '@/hooks/use-i18n';
import { QcDetails } from './QcDetails';

function LoadedQc(query: QcQuery) {
  const response = useQcResponse(query);
  const { t } = useI18n();
  if (response.status === 'loading') return <span role="status" aria-busy="true">{t.qcLoading}</span>;
  if (response.status === 'error') return <span role="alert">{t.qcLoadFailed}</span>;
  return <QcDetails data={response.data} />;
}
export function QcBadges() {
  const session = useSessionStore();
  const settings = useSettingsStore();
  const navigation = useNavigationStore();
  const owner = useAuthStore(state => state.user?.id);
  useAnalysisStore();
  const [retry, setRetry] = useState(0);
  const { t } = useI18n();
  if (!session.sessionId || !owner || navigation.status !== 'ready' || navigation.cycle === null) return null;
  const requestKey = qcRequestKey();
  return <div className="flex flex-wrap items-center gap-2" data-testid="qc-summary">
    <LoadedQc key={`${requestKey}:${retry}`} requestKey={requestKey} sid={session.sessionId}
      cycle={navigation.cycle} useRox={settings.useRox} background={settings.backgroundMode} />
    <button type="button" className="text-xs underline" onClick={() => setRetry(value => value + 1)}>{t.qcRefresh}</button>
  </div>;
}
