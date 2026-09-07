import { useUploadJobStore } from '@/stores/upload-job-store';
import { useAuthStore } from '@/stores/auth-store';
import { useI18n } from '@/hooks/use-i18n';
import { RecoveryNotice } from '@/components/shared/RecoveryNotice';

export function UploadJobSummary({ onCheckSessions }: { onCheckSessions?: () => void }) {
  const state = useUploadJobStore();
  const owner = useAuthStore(value => value.user?.id);
  const { t } = useI18n();
  if (state.ownerId !== owner || state.jobs.length === 0) return null;
  const labels = { queued: t.jobQueued, packaging: t.jobPackaging, uploading: t.jobUploading,
    success: t.jobSuccess, failed: t.jobFailed, unknown: t.jobUnknown };
  return <section aria-label={t.uploadJobTitle} className="my-4 p-4 border border-border rounded bg-surface">
    <h3 className="font-semibold">{t.uploadJobTitle}</h3>
    <p role="status" aria-live="polite">{state.pending ? t.jobUploading : t.jobFinished}</p>
    <ul className="space-y-2">{state.jobs.map(job => <li key={job.id} className="text-sm break-words">
      <span>{job.filename}</span> — <span>{labels[job.stage]}</span>
      {job.sessionId && <code className="block text-xs">{job.sessionId}</code>}
      <RecoveryNotice reason={job.reason} />
    </li>)}</ul>
    {onCheckSessions && <button type="button" className="mt-3 underline" onClick={onCheckSessions}>{t.jobCheckSessions}</button>}
  </section>;
}
