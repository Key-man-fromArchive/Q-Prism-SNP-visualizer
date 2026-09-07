import { useI18n } from '@/hooks/use-i18n';
import type { usePresetOperations } from '@/hooks/use-preset-operations';
import { RecoveryNotice } from '@/components/shared/RecoveryNotice';

export function PresetFeedback({ state }: { state: ReturnType<typeof usePresetOperations> }) {
  const { t } = useI18n();
  const operations = { idle: '', error: '', saving: t.presetSaving, deleting: t.presetDeleting, saved: t.presetSaved, deleted: t.presetDeleted };
  const listText = state.listStatus === 'loading' ? t.presetLoading : state.listStatus === 'ready' && state.presets.length === 0 ? t.presetEmpty : '';
  return <>
    <p role="status" aria-live="polite">{operations[state.operation]}</p>
    <p role="status" aria-live="polite">{listText}</p>
    <RecoveryNotice reason={state.operationError} />
    <RecoveryNotice reason={state.listError} onRetry={() => void state.reload()} />
  </>;
}
