// @TASK Protocol Tab Component
// @SPEC Editable PCR protocol table

import { Fragment } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useProtocolEditor } from './use-protocol-editor';
import { ProtocolThermalProfile } from './ProtocolThermalProfile';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useI18n } from '@/hooks/use-i18n';
import type { ProtocolStep, RoleLabelMetadata } from '@/types/api';
import type { Translations } from '@/locales/en';
import { PROTOCOL_PHASE_COLORS, PROTOCOL_AMP_COLORS, PROTOCOL_PHASE_FALLBACK } from '@/lib/constants';

function getPhaseColor(phase: string) {
  if (PROTOCOL_PHASE_COLORS[phase]) return PROTOCOL_PHASE_COLORS[phase];
  const m = phase.match(/Amplification\s+(\d+)/);
  if (m) return PROTOCOL_AMP_COLORS[(parseInt(m[1]) - 1) % PROTOCOL_AMP_COLORS.length];
  return PROTOCOL_PHASE_FALLBACK;
}

export function ProtocolTab() {
  const sessionId = useSessionStore(s => s.sessionId);
  const entry = useSessionStore(s => s.entryGeneration);
  const owner = useAuthStore(s => s.generation);
  const { t } = useI18n();
  if (!sessionId) return <p role="status" className="p-6">{t.noData}</p>;
  return <ProtocolEditor key={`${owner}:${entry}:${sessionId}`} sessionId={sessionId} />;
}

function ProtocolEditor({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const { steps, setSteps, channels, phase, save: handleSave, cancel, retry } = useProtocolEditor(sessionId);
  const loading = phase === 'loading' || phase === 'saving';

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

  return (
    <form onSubmit={event => { event.preventDefault(); void handleSave(); }} className="protocol-editor p-4 sm:px-6" aria-busy={loading}>
      <div className="panel" style={{ borderRadius: '8px', padding: '20px' }}>
        <h3 className="text-lg font-semibold text-text" style={{ margin: '0 0 16px 0' }}>
          {t.pcrProtocolSteps}
        </h3>

        <ProtocolFeedback phase={phase} retry={retry} />

        <ProtocolStatus phase={phase} empty={steps.length === 0} />
        <ProtocolChannelCard channels={channels} t={t} />
        <ProtocolThermalProfile steps={steps} />
        <fieldset disabled={loading || phase === 'load-error'} className="min-w-0">
        <div role="region" aria-label={t.pcrProtocolSteps} tabIndex={0} style={{ overflow: 'auto', maxHeight: '500px', marginBottom: '16px' }}>
          <table id="protocol-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr className="border-b-2 border-border bg-bg">
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.step}</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.label}</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.tempC}</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.durationS}</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.cycles}</th>
                <th className="text-center text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, stepIndex) => {
                const color = getPhaseColor(step.phase || '');
                const isFirstInPhase = stepIndex === 0 || steps[stepIndex - 1]?.phase !== step.phase;

                return (
                  <Fragment key={step.step}>
                    <tr className="border-b border-border" style={{ borderLeft: `3px solid ${color.border}` }}>
                      <td style={{ padding: '8px' }}>
                        {isFirstInPhase && step.phase && (
                          <div style={{ fontSize: '10px', fontWeight: '600', color: color.label, marginBottom: '2px' }}>
                            {step.phase} {step.cycles > 1 ? `(\u00d7${step.cycles})` : ''}
                          </div>
                        )}
                        {step.step}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="text"
                          aria-label={`${t.label} ${step.step}`}
                          value={step.label}
                          onChange={(e) => handleStepChange(stepIndex, 'label', e.target.value)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '100%', padding: '4px 8px', fontSize: '13px' }}
                        />
                        {step.plate_read && (
                          <span style={{ marginLeft: '6px', fontSize: '14px' }} title={t.dataCollection}>{'\uD83D\uDCF7'}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={step.temperature}
                          aria-label={`${t.tempC} ${step.step}`}
                          onChange={(e) => handleStepChange(stepIndex, 'temperature', parseFloat(e.target.value) || 0)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '70px', padding: '4px 8px', fontSize: '13px' }}
                        />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={step.duration_sec}
                          aria-label={`${t.durationS} ${step.step}`}
                          onChange={(e) => handleStepChange(stepIndex, 'duration_sec', parseInt(e.target.value) || 0)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '70px', padding: '4px 8px', fontSize: '13px' }}
                        />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={step.cycles}
                          aria-label={`${t.cycles} ${step.step}`}
                          onChange={(e) => handleStepChange(stepIndex, 'cycles', parseInt(e.target.value) || 1)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '60px', padding: '4px 8px', fontSize: '13px' }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <button
                          type="button"
                          aria-label={`${t.delete} ${step.step}`}
                          className="del-btn"
                          onClick={() => handleDeleteStep(stepIndex)}
                          style={{
                            padding: '4px 8px',
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '500',
                          }}
                        >
                          {t.delete}
                        </button>
                      </td>
                    </tr>

                    {/* GOTO Row */}
                    {step.goto_label && (
                      <tr style={{ background: '#fefce8', borderLeft: `3px solid ${color.border}` }}>
                        <td colSpan={6} style={{ padding: '6px 12px', fontSize: '12px', fontStyle: 'italic', color: '#854d0e' }}>
                          {'\u2192'} GOTO: {step.goto_label}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            id="add-step-btn"
            onClick={handleAddStep}
            disabled={loading}
            style={{
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
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
            style={{
              padding: '8px 16px',
              background: '#10b981',
              color: 'white',
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
          <button type="button" onClick={cancel} className="px-4 py-2 border border-border rounded">{t.cancel}</button>
        </div>
        </fieldset>
      </div>
    </form>
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
