// @TASK Protocol Tab Component
// @SPEC Editable PCR protocol table

import { Fragment, useEffect, useState } from 'react';
import { getProtocol, updateProtocol } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import type { ProtocolStep } from '@/types/api';

// Phase color system
const PHASE_COLORS: Record<string, { border: string; label: string }> = {
  'Pre-read': { border: '#3b82f6', label: '#2563eb' },
  'Initial Denaturation': { border: '#ef4444', label: '#dc2626' },
  'Post-read': { border: '#10b981', label: '#059669' },
};

const AMP_COLORS = [
  { border: '#f59e0b', label: '#d97706' },
  { border: '#f97316', label: '#ea580c' },
  { border: '#ea580c', label: '#c2410c' },
  { border: '#dc2626', label: '#b91c1c' },
];

function getPhaseColor(phase: string) {
  if (PHASE_COLORS[phase]) return PHASE_COLORS[phase];
  const m = phase.match(/Amplification\s+(\d+)/);
  if (m) return AMP_COLORS[(parseInt(m[1]) - 1) % AMP_COLORS.length];
  return { border: '#94a3b8', label: '#64748b' };
}

function isReadingStep(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes('data collection') || lower.includes('pre-read') || lower.includes('post-read');
}

export function ProtocolTab() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const [steps, setSteps] = useState<ProtocolStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load protocol on mount
  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    getProtocol(sessionId)
      .then((res) => {
        setSteps(res.steps);
        setError(null);
      })
      .catch((err) => {
        console.error('Failed to load protocol:', err);
        setError('Failed to load protocol');
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  const handleSave = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await updateProtocol(sessionId, steps);
      setError(null);
    } catch (err) {
      console.error('Failed to save protocol:', err);
      setError('Failed to save protocol');
    } finally {
      setLoading(false);
    }
  };

  const handleStepChange = (index: number, field: keyof ProtocolStep, value: any) => {
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
      },
    ]);
  };

  return (
    <div style={{ padding: '16px 24px', maxWidth: '800px' }}>
      <div className="panel" style={{ borderRadius: '8px', padding: '20px' }}>
        <h3 className="text-lg font-semibold text-text" style={{ margin: '0 0 16px 0' }}>
          PCR Protocol Steps
        </h3>

        {error && (
          <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px', marginBottom: '12px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <div style={{ overflowY: 'auto', maxHeight: '500px', marginBottom: '16px' }}>
          <table id="protocol-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr className="border-b-2 border-border bg-bg">
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>Step</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>Label</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>Temp (&deg;C)</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>Duration (s)</th>
                <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>Cycles</th>
                <th className="text-center text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>Actions</th>
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
                          value={step.label}
                          onChange={(e) => handleStepChange(stepIndex, 'label', e.target.value)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '100%', padding: '4px 8px', fontSize: '13px' }}
                        />
                        {isReadingStep(step.label) && (
                          <span style={{ marginLeft: '6px', fontSize: '14px' }} title="Data Collection">{'\uD83D\uDCF7'}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={step.temperature}
                          onChange={(e) => handleStepChange(stepIndex, 'temperature', parseFloat(e.target.value) || 0)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '70px', padding: '4px 8px', fontSize: '13px' }}
                        />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={step.duration_sec}
                          onChange={(e) => handleStepChange(stepIndex, 'duration_sec', parseInt(e.target.value) || 0)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '70px', padding: '4px 8px', fontSize: '13px' }}
                        />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={step.cycles}
                          onChange={(e) => handleStepChange(stepIndex, 'cycles', parseInt(e.target.value) || 1)}
                          className="border border-border rounded bg-surface text-text"
                          style={{ width: '60px', padding: '4px 8px', fontSize: '13px' }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <button
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
                          Delete
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

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
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
            Add Step
          </button>
          <button
            id="save-protocol-btn"
            onClick={handleSave}
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
            {loading ? 'Saving...' : 'Save Protocol'}
          </button>
        </div>
      </div>
    </div>
  );
}
