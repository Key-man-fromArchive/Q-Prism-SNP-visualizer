// @TASK Protocol Tab Component
// @SPEC Editable PCR protocol table with temperature profile visualization

import { Fragment, useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { getProtocol, updateProtocol } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import type { ProtocolStep } from '@/types/api';

// Phase color system
const PHASE_COLORS: Record<string, { bg: string; border: string; label: string; bgSolid: string }> = {
  'Pre-read': {
    bg: 'rgba(59,130,246,0.12)',
    border: '#3b82f6',
    label: '#2563eb',
    bgSolid: '#eff6ff',
  },
  'Initial Denaturation': {
    bg: 'rgba(239,68,68,0.10)',
    border: '#ef4444',
    label: '#dc2626',
    bgSolid: '#fef2f2',
  },
  'Post-read': {
    bg: 'rgba(16,185,129,0.12)',
    border: '#10b981',
    label: '#059669',
    bgSolid: '#ecfdf5',
  },
};

const AMP_COLORS = [
  { bg: 'rgba(245,158,11,0.10)', border: '#f59e0b', label: '#d97706', bgSolid: '#fffbeb' },
  { bg: 'rgba(249,115,22,0.10)', border: '#f97316', label: '#ea580c', bgSolid: '#fff7ed' },
  { bg: 'rgba(234,88,12,0.10)', border: '#ea580c', label: '#c2410c', bgSolid: '#fff7ed' },
  { bg: 'rgba(220,38,38,0.10)', border: '#dc2626', label: '#b91c1c', bgSolid: '#fef2f2' },
];

function getPhaseColor(phase: string) {
  if (PHASE_COLORS[phase]) return PHASE_COLORS[phase];
  const m = phase.match(/Amplification\s+(\d+)/);
  if (m) return AMP_COLORS[(parseInt(m[1]) - 1) % AMP_COLORS.length];
  return {
    bg: 'rgba(148,163,184,0.10)',
    border: '#94a3b8',
    label: '#64748b',
    bgSolid: '#f8fafc',
  };
}

function isReadingStep(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes('data collection') || lower.includes('pre-read') || lower.includes('post-read');
}

interface PhaseRange {
  phase: string;
  startTime: number;
  endTime: number;
  cycles: number;
}

export function ProtocolTab() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const plotRef = useRef<HTMLDivElement>(null);
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

  // Render plot when steps change
  useEffect(() => {
    if (steps.length > 0) {
      renderPlot();
    }
  }, [steps]);

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

  const buildTimeProfile = () => {
    const timePoints: number[] = [];
    const tempPoints: number[] = [];
    const phaseRanges: PhaseRange[] = [];
    const readingMarkers: { time: number; label: string }[] = [];

    let currentTime = 0;
    let currentPhase = '';
    let phaseStartTime = 0;
    let phaseCycles = 0;

    steps.forEach((step) => {
      // Detect phase change
      if (step.phase && step.phase !== currentPhase) {
        if (currentPhase) {
          phaseRanges.push({
            phase: currentPhase,
            startTime: phaseStartTime,
            endTime: currentTime,
            cycles: phaseCycles,
          });
        }
        currentPhase = step.phase;
        phaseStartTime = currentTime;
        phaseCycles = step.cycles;
      }

      // Add time points for this step (repeated for cycles)
      for (let cycle = 0; cycle < step.cycles; cycle++) {
        timePoints.push(currentTime);
        tempPoints.push(step.temperature);

        // Check if this is a reading step
        if (isReadingStep(step.label)) {
          readingMarkers.push({
            time: currentTime + step.duration_sec / 2,
            label: step.label,
          });
        }

        currentTime += step.duration_sec;
        timePoints.push(currentTime);
        tempPoints.push(step.temperature);
      }
    });

    // Close final phase
    if (currentPhase) {
      phaseRanges.push({
        phase: currentPhase,
        startTime: phaseStartTime,
        endTime: currentTime,
        cycles: phaseCycles,
      });
    }

    return { timePoints, tempPoints, phaseRanges, readingMarkers };
  };

  const renderPlot = () => {
    if (!plotRef.current || steps.length === 0) return;

    const { timePoints, tempPoints, phaseRanges, readingMarkers } = buildTimeProfile();

    // Convert time to minutes
    const timeMinutes = timePoints.map((t) => t / 60);
    const readingMinutes = readingMarkers.map((m) => m.time / 60);

    // Build shapes for phase backgrounds
    const shapes: any[] = [];
    phaseRanges.forEach((range) => {
      const color = getPhaseColor(range.phase);
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: range.startTime / 60,
        x1: range.endTime / 60,
        y0: 0,
        y1: 1,
        fillcolor: color.bg,
        line: { width: 0 },
        layer: 'below',
      });

      // Phase divider lines
      if (range.startTime > 0) {
        shapes.push({
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: range.startTime / 60,
          x1: range.startTime / 60,
          y0: 0,
          y1: 1,
          line: { color: color.border, width: 1, dash: 'dot' },
        });
      }
    });

    // Build annotations for cycle counts
    const annotations: any[] = [];
    phaseRanges.forEach((range) => {
      if (range.cycles > 1) {
        const color = getPhaseColor(range.phase);
        annotations.push({
          x: (range.startTime / 60 + range.endTime / 60) / 2,
          y: 0,
          xref: 'x',
          yref: 'paper',
          text: `↻ ×${range.cycles}`,
          showarrow: false,
          font: { size: 11, color: color.label },
          bgcolor: 'white',
          bordercolor: color.border,
          borderwidth: 1,
          borderpad: 3,
          yanchor: 'top',
        });
      }
    });

    // Main temperature trace
    const trace: any = {
      x: timeMinutes,
      y: tempPoints,
      type: 'scatter',
      mode: 'lines',
      line: { color: '#dc2626', width: 2.5 },
      fill: 'tozeroy',
      fillcolor: 'rgba(220,38,38,0.08)',
      name: 'Temperature',
      hovertemplate: '%{y:.1f}°C at %{x:.2f} min<extra></extra>',
    };

    // Reading markers
    const readingTrace: any = {
      x: readingMinutes,
      y: readingMarkers.map((m) => {
        // Find temperature at this time
        const idx = timePoints.findIndex((t) => t >= m.time * 60);
        return idx >= 0 ? tempPoints[idx] : tempPoints[tempPoints.length - 1];
      }),
      type: 'scatter',
      mode: 'markers',
      marker: {
        symbol: 'star',
        size: 14,
        color: '#f59e0b',
        line: { color: '#d97706', width: 1 },
      },
      name: 'Data Collection',
      hovertemplate: '%{text}<extra></extra>',
      text: readingMarkers.map((m) => m.label),
    };

    const layout: any = {
      xaxis: {
        title: 'Time (minutes)',
        showgrid: true,
        gridcolor: '#e5e7eb',
      },
      yaxis: {
        title: 'Temperature (°C)',
        showgrid: true,
        gridcolor: '#e5e7eb',
      },
      margin: { t: 30, r: 20, b: 60, l: 60 },
      hovermode: 'closest',
      shapes,
      annotations,
      showlegend: false,
      plot_bgcolor: 'white',
      paper_bgcolor: 'white',
    };

    const config: any = {
      responsive: true,
      displayModeBar: false,
    };

    Plotly.react(plotRef.current, [trace, readingTrace], layout, config);
  };

  const phaseBarData = (() => {
    if (steps.length === 0) return [];
    const { phaseRanges } = buildTimeProfile();
    const totalTime = phaseRanges.reduce((sum, r) => sum + (r.endTime - r.startTime), 0);
    if (totalTime === 0) return [];
    return phaseRanges.map((range) => {
      const color = getPhaseColor(range.phase);
      const width = ((range.endTime - range.startTime) / totalTime) * 100;
      return { phase: range.phase, width, color, label: width > 8 ? range.phase : range.phase.slice(0, 3) };
    });
  })();

  // Group steps by phase for rendering
  const groupedSteps: { phase: string; steps: ProtocolStep[] }[] = [];
  steps.forEach((step) => {
    if (!step.phase || groupedSteps.length === 0 || groupedSteps[groupedSteps.length - 1].phase !== step.phase) {
      groupedSteps.push({ phase: step.phase || 'Unknown', steps: [step] });
    } else {
      groupedSteps[groupedSteps.length - 1].steps.push(step);
    }
  });

  return (
    <div
      className="protocol-grid"
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px 24px' }}
    >
      {/* Left: Table */}
      <div className="panel" style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600' }}>PCR Protocol Steps</h3>

        {error && (
          <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px', marginBottom: '12px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <div style={{ overflowY: 'auto', maxHeight: '500px', marginBottom: '16px' }}>
          <table id="protocol-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '600' }}>Step</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '600' }}>Label</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '600' }}>Temp (°C)</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '600' }}>Duration (s)</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '600' }}>Cycles</th>
                <th style={{ padding: '10px 8px', textAlign: 'center', fontWeight: '600' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedSteps.map((group, groupIdx) => {
                const color = getPhaseColor(group.phase);
                const phaseCycles = group.steps[0]?.cycles || 1;

                return (
                  <Fragment key={groupIdx}>
                    {/* Phase Header */}
                    <tr style={{ background: '#f9fafb' }}>
                      <td colSpan={6} style={{ padding: '8px', fontWeight: '600', fontSize: '12px', color: color.label }}>
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: color.border,
                          marginRight: '8px',
                        }} />
                        {group.phase} {phaseCycles > 1 ? `(×${phaseCycles})` : ''}
                      </td>
                    </tr>

                    {/* Step Rows */}
                    {group.steps.map((step) => {
                      const stepIndex = steps.findIndex((s) => s.step === step.step);
                      return (
                        <Fragment key={step.step}>
                          <tr style={{ borderBottom: '1px solid #f3f4f6', borderLeft: `3px solid ${color.border}` }}>
                            <td style={{ padding: '8px' }}>{step.step}</td>
                            <td style={{ padding: '8px' }}>
                              <input
                                type="text"
                                value={step.label}
                                onChange={(e) => handleStepChange(stepIndex, 'label', e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '4px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  fontSize: '13px',
                                }}
                              />
                              {isReadingStep(step.label) && (
                                <span style={{ marginLeft: '6px', fontSize: '14px' }} title="Data Collection">📷</span>
                              )}
                            </td>
                            <td style={{ padding: '8px' }}>
                              <input
                                type="number"
                                value={step.temperature}
                                onChange={(e) => handleStepChange(stepIndex, 'temperature', parseFloat(e.target.value) || 0)}
                                style={{
                                  width: '70px',
                                  padding: '4px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  fontSize: '13px',
                                }}
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <input
                                type="number"
                                value={step.duration_sec}
                                onChange={(e) => handleStepChange(stepIndex, 'duration_sec', parseInt(e.target.value) || 0)}
                                style={{
                                  width: '70px',
                                  padding: '4px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  fontSize: '13px',
                                }}
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <input
                                type="number"
                                value={step.cycles}
                                onChange={(e) => handleStepChange(stepIndex, 'cycles', parseInt(e.target.value) || 1)}
                                style={{
                                  width: '60px',
                                  padding: '4px 8px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  fontSize: '13px',
                                }}
                              />
                            </td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>
                              <button
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
                                → GOTO: {step.goto_label}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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

      {/* Right: Plot */}
      <div className="panel" style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600' }}>Temperature Profile</h3>
        {phaseBarData.length > 0 && (
          <div id="protocol-phase-bar" style={{ display: 'flex', marginBottom: '12px', borderRadius: '6px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            {phaseBarData.map((seg) => (
              <div
                key={seg.phase}
                style={{
                  flex: `0 0 ${seg.width}%`,
                  background: seg.color.bgSolid,
                  borderBottom: `3px solid ${seg.color.border}`,
                  padding: '6px 8px',
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: seg.color.label,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={seg.phase}
              >
                {seg.label}
              </div>
            ))}
          </div>
        )}
        <div id="protocol-plot" ref={plotRef} style={{ width: '100%', height: '350px' }} />
      </div>
    </div>
  );
}
