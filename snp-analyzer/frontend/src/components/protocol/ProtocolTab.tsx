// @TASK Protocol Tab Component
// @SPEC Read-only PCR protocol summary, edit on demand
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useProtocolEditor } from './use-protocol-editor';
import { ProtocolThermalProfile } from './ProtocolThermalProfile';
import { ProtocolStepsTable } from './ProtocolStepsTable';
import { FluorescenceDataCard } from '@/components/analysis/FluorescenceDataCard';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useI18n } from '@/hooks/use-i18n';
import type { ProtocolStep, RoleLabelMetadata } from '@/types/api';
import type { Translations } from '@/locales/en';

export function ProtocolTab() {
  const sessionId = useSessionStore(s => s.sessionId);
  const entry = useSessionStore(s => s.entryGeneration);
  const owner = useAuthStore(s => s.generation);
  const { t } = useI18n();
  if (!sessionId) return <p role="status" className="p-6">{t.noData}</p>;
  return (
    <>
      <ProtocolEditor key={`${owner}:${entry}:${sessionId}`} sessionId={sessionId} />
      {/* FB-06 / P10: a single merged curve+value card lives here, outside
          the protocol-save <form> (a bare <button> defaults to type="submit"
          inside a form) -- see FluorescenceDataCard.tsx. */}
      <div className="px-4 pb-4 sm:px-6">
        <FluorescenceDataCard />
      </div>
    </>
  );
}

function ProtocolEditor({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const { steps, setSteps, channels, phase, save: handleSave, cancel, retry } = useProtocolEditor(sessionId);
  const loading = phase === 'loading' || phase === 'saving';
  // Read-only summary is the default view (P10): most people open this tab
  // to check the protocol, not to change it. Editing is opt-in, and always
  // returns here afterwards (on a successful save, or on Cancel).
  const [editing, setEditing] = useState(false);

  const handleStepChange = <K extends keyof ProtocolStep,>(index: number, field: K, value: ProtocolStep[K]) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleDeleteStep = (index: number) => {
    setSteps((prev) =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step: i + 1 }))
    );
  };

  const handleAddStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        step: prev.length + 1,
        label: '',
        temperature: 55,
        duration_sec: 60,
        cycles: 1,
        phase: '',
        goto_label: '',
        // Explicit, not left to fall through as undefined: a new step reads
        // nothing and has no touchdown until the user says otherwise.
        plate_read: false,
        temp_increment: null,
        read_channels: [],
      },
    ]);
  };

  const handleCancel = () => {
    cancel();
    setEditing(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const succeeded = await handleSave();
    if (succeeded) setEditing(false);
  };

  const canEdit = phase !== 'loading' && phase !== 'load-error';

  return (
    <div className="protocol-editor p-4 sm:px-6">
      <div className="panel" style={{ borderRadius: '8px', padding: '20px' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: '4px' }}>
          <h3 className="text-lg font-semibold text-text" style={{ margin: 0 }}>
            {t.pcrProtocolSteps}
          </h3>
          {!editing && canEdit && (
            <button
              type="button"
              id="edit-protocol-btn"
              onClick={() => setEditing(true)}
              className="badge cursor-pointer text-xs min-h-11"
            >
              {t.protocolEditButton}
            </button>
          )}
        </div>

        {/* Read-channel metadata folded into the card's own header line
            (P10): a run-wide fact belongs next to the card title, not in a
            separate boxed sub-card competing for attention with the steps
            themselves. */}
        <ProtocolChannelCard channels={channels} t={t} />

        <ProtocolFeedback phase={phase} retry={retry} />
        <ProtocolStatus phase={phase} empty={steps.length === 0} />
        <ProtocolThermalProfile steps={steps} />

        {editing ? (
          <form onSubmit={event => { void handleSubmit(event); }} aria-busy={loading}>
            <fieldset disabled={loading || phase === 'load-error'} className="min-w-0">
              <ProtocolStepsTable steps={steps} t={t} editable onChange={handleStepChange} onDelete={handleDeleteStep} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  id="add-step-btn"
                  onClick={handleAddStep}
                  disabled={loading}
                  className="min-h-11"
                  style={{
                    padding: '8px 16px',
                    background: 'var(--color-primary)',
                    color: 'var(--color-on-primary)',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {t.addStep}
                </button>
                <button
                  type="submit"
                  id="save-protocol-btn"
                  disabled={loading}
                  className="bg-success text-on-success min-h-11"
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {phase === 'saving' ? t.saving : t.saveProtocol}
                </button>
                <button type="button" onClick={handleCancel} className="px-4 py-2 border border-border rounded min-h-11">{t.cancel}</button>
              </div>
            </fieldset>
          </form>
        ) : (
          steps.length > 0 && <ProtocolStepsTable steps={steps} t={t} editable={false} />
        )}
      </div>
    </div>
  );
}

function ProtocolStatus({ phase, empty }: { phase: string; empty: boolean }) {
  const { t } = useI18n();
  const messages: Record<string, string> = { loading: t.loading, saving: t.saving, saved: t.protocolSaved };
  const message = messages[phase] ?? (phase === 'ready' && empty ? t.protocolEmpty : '');
  return <p role="status" aria-live="polite" className="text-sm text-text-muted mb-2">{message}</p>;
}

/** Reads channel/role metadata straight from the protocol response contract
 *  (see use-protocol-editor.ts), never from data-store's cache -- that cache
 *  can be stale relative to whichever session this tab currently shows.
 *  Shows nothing (not an empty/guessed chip) when the run carries no
 *  channel metadata at all. */
function ProtocolChannelCard({ channels, t }: { channels: RoleLabelMetadata | null; t: Translations }) {
  const entries = Object.entries(channels?.role_channels ?? {}).filter(([, channel]) => !!channel);
  if (entries.length === 0) return null;
  return (
    <div data-testid="protocol-channel-card" className="mb-3 flex flex-wrap items-center gap-2 text-text" style={{ fontSize: '13px' }}>
      <span className="font-semibold">{t.protocolReadChannels}</span>
      {entries.map(([role, channelName]) => (
        <span
          key={role}
          data-testid={`protocol-channel-chip-${role}`}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5"
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block', width: '8px', height: '8px', borderRadius: '9999px',
              background: role === 'WT' ? 'var(--color-fam)' : role === 'MT1' ? 'var(--color-allele2)' : 'var(--color-text-muted)',
            }}
          />
          {channelName} → {role === 'normalization' ? t.normalization : role}
        </span>
      ))}
    </div>
  );
}

function ProtocolFeedback({ phase, retry }: { phase: string; retry: () => void }) {
  const { t } = useI18n();
  const messages: Record<string, string> = { 'load-error': t.errLoadProtocol, 'save-error': t.errSaveProtocol };
  if (!messages[phase]) return null;
  return <div role="alert" className="p-3 border border-danger bg-danger/10 rounded mb-3 text-text">
    <AlertTriangle size={18} aria-hidden="true" className="inline-block mr-2" />
    {messages[phase]}
    {phase === 'load-error' && <button type="button" onClick={retry} className="ml-2 underline">{t.retry}</button>}
  </div>;
}
