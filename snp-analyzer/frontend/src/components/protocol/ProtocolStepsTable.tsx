// @TASK P10-PROTOCOL - PCR protocol step list: read-only summary rows and
// editable input rows, sharing one grouping/coloring pass
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
// @TEST src/components/protocol/ProtocolTab.test.tsx
//
// Two render modes over the exact same steps/bands:
//  - editable=false (the tab's default): plain text rows, no inputs, no
//    delete button -- most users open Raw data to READ the protocol, not
//    edit it (see evidence/P10-PROTOCOL-UI.md for the "most users are not
//    trying to fix it" framing).
//  - editable=true: the original input-per-cell table, entered only via
//    ProtocolTab's "Edit protocol" button.
// Both share `ProtocolPhaseGroupHeader` (one banner row per phase band,
// colored identically to ProtocolThermalProfile's stripes) instead of each
// duplicating phase-label/GOTO rendering.
//
// Stays a real <table>/<tr>/<td> tree in BOTH modes (not a div/grid
// rewrite) specifically so existing tests that do
// `screen.getByDisplayValue(...).closest('tr')` keep resolving a real
// <tr> -- the ≤768px 2-column "field card" layout (task 5) is CSS-only
// (see .protocol-edit-table media query in index.css); the DOM shape does
// not change per breakpoint, only how it's painted.
import { Fragment } from 'react';
import type { ProtocolStep } from '@/types/api';
import type { Translations } from '@/locales/en';
import { getPhaseColor, groupPhaseBands } from './protocol-phase-groups';
import { ProtocolPhaseGroupHeader } from './ProtocolPhaseGroupHeader';
import { stepEndTemperature, roundTo1 } from './protocol-step-temp';

type EditHandlers = {
  editable: true;
  onChange: <K extends keyof ProtocolStep>(index: number, field: K, value: ProtocolStep[K]) => void;
  onDelete: (index: number) => void;
};
type ReadOnly = { editable: false };

export function ProtocolStepsTable(
  props: { steps: ProtocolStep[]; t: Translations } & (EditHandlers | ReadOnly),
) {
  const { steps, t } = props;
  const bands = groupPhaseBands(steps);
  const bandAtStart = new Map(bands.map((band) => [band.startIndex, band]));
  const colSpan = props.editable ? 6 : 5;

  return (
    <div
      role="region"
      aria-label={t.pcrProtocolSteps}
      tabIndex={0}
      style={{ overflow: 'auto', maxHeight: '500px', marginBottom: '16px' }}
    >
      <table
        id="protocol-table"
        className={props.editable ? 'protocol-edit-table' : undefined}
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
      >
        <thead>
          <tr className="border-b-2 border-border bg-bg">
            <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.step}</th>
            <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.label}</th>
            <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.tempC}</th>
            <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.durationS}</th>
            <th className="text-left text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.cycles}</th>
            {props.editable && (
              <th className="text-center text-text" style={{ padding: '10px 8px', fontWeight: '600' }}>{t.actions}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {steps.map((step, stepIndex) => {
            const band = bandAtStart.get(stepIndex);
            const color = getPhaseColor(step.phase || '');
            return (
              <Fragment key={step.step}>
                {band && <ProtocolPhaseGroupHeader band={band} steps={steps} colSpan={colSpan} t={t} />}
                {props.editable ? (
                  <EditableStepRow
                    step={step}
                    stepIndex={stepIndex}
                    color={color}
                    onChange={props.onChange}
                    onDelete={props.onDelete}
                    t={t}
                  />
                ) : (
                  <ReadOnlyStepRow step={step} color={color} t={t} />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReadOnlyStepRow({
  step,
  color,
  t,
}: {
  step: ProtocolStep;
  color: { border: string; label: string };
  t: Translations;
}) {
  const hasTouchdown = step.temp_increment != null && step.cycles > 1;
  const endTemp = roundTo1(stepEndTemperature(step));
  return (
    <tr className="border-b border-border" style={{ borderLeft: `3px solid ${color.border}` }}>
      <td className="text-text-muted" style={{ padding: '6px 8px' }}>{step.step}</td>
      <td className="text-text" style={{ padding: '6px 8px' }}>
        {step.label}
        {step.plate_read && (
          <span
            className="ml-2 rounded-full bg-info/10 text-info"
            style={{ fontSize: '10px', padding: '1px 6px', fontWeight: 600 }}
          >
            {t.protocolStepRead}
          </span>
        )}
        {/* read_channels is always [] for every current parser -- see
            types/api.ts's field comment -- so this only ever renders once
            a format actually reports per-step channels. Never inferred
            from the run-wide role_channels metadata shown in the card
            header; that would misrepresent a run-wide fact as
            step-specific. */}
        {step.read_channels.length > 0 && (
          <span className="ml-2 text-text-muted" style={{ fontSize: '10px' }}>
            {step.read_channels.join(', ')}
          </span>
        )}
      </td>
      <td className="text-text" style={{ padding: '6px 8px' }}>
        {hasTouchdown ? t.protocolTempChange(step.temperature, endTemp, step.temp_increment as number) : `${step.temperature}°C`}
      </td>
      <td className="text-text" style={{ padding: '6px 8px' }}>{step.duration_sec}s</td>
      <td className="text-text" style={{ padding: '6px 8px' }}>{step.cycles}</td>
    </tr>
  );
}

function EditableStepRow({
  step,
  stepIndex,
  color,
  onChange,
  onDelete,
  t,
}: {
  step: ProtocolStep;
  stepIndex: number;
  color: { border: string; label: string };
  onChange: <K extends keyof ProtocolStep>(index: number, field: K, value: ProtocolStep[K]) => void;
  onDelete: (index: number) => void;
  t: Translations;
}) {
  return (
    <tr className="protocol-edit-row border-b border-border" style={{ borderLeft: `3px solid ${color.border}` }}>
      <td data-field="step" style={{ padding: '8px' }}>{step.step}</td>
      <td data-field="label" style={{ padding: '8px' }}>
        <input
          type="text"
          aria-label={`${t.label} ${step.step}`}
          value={step.label}
          onChange={(e) => onChange(stepIndex, 'label', e.target.value)}
          className="border border-border rounded bg-surface text-text"
          style={{ width: '100%', padding: '4px 8px', fontSize: '13px' }}
        />
        {step.plate_read && (
          <span style={{ marginLeft: '6px', fontSize: '14px' }} title={t.protocolStepRead}>{'📷'}</span>
        )}
      </td>
      <td data-field="temperature" style={{ padding: '8px' }}>
        <input
          type="number"
          value={step.temperature}
          aria-label={`${t.tempC} ${step.step}`}
          onChange={(e) => onChange(stepIndex, 'temperature', parseFloat(e.target.value) || 0)}
          className="border border-border rounded bg-surface text-text"
          style={{ width: '70px', padding: '4px 8px', fontSize: '13px' }}
        />
      </td>
      <td data-field="duration" style={{ padding: '8px' }}>
        <input
          type="number"
          value={step.duration_sec}
          aria-label={`${t.durationS} ${step.step}`}
          onChange={(e) => onChange(stepIndex, 'duration_sec', parseInt(e.target.value) || 0)}
          className="border border-border rounded bg-surface text-text"
          style={{ width: '70px', padding: '4px 8px', fontSize: '13px' }}
        />
      </td>
      <td data-field="cycles" style={{ padding: '8px' }}>
        <input
          type="number"
          value={step.cycles}
          aria-label={`${t.cycles} ${step.step}`}
          onChange={(e) => onChange(stepIndex, 'cycles', parseInt(e.target.value) || 1)}
          className="border border-border rounded bg-surface text-text"
          style={{ width: '60px', padding: '4px 8px', fontSize: '13px' }}
        />
      </td>
      <td data-field="actions" style={{ padding: '8px', textAlign: 'center' }}>
        <button
          type="button"
          aria-label={`${t.delete} ${step.step}`}
          className="del-btn bg-danger text-on-danger min-h-11"
          onClick={() => onDelete(stepIndex)}
          style={{
            padding: '4px 8px',
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
  );
}
