// @TASK P2-S1-T1 - Thermal-cycling profile diagram (read-only summary)
// @SPEC docs/planning/feedback-2026-09-11/FB-05-protocol-visualization.md#3-2
// @TEST src/components/protocol/ProtocolThermalProfile.test.tsx
//
// Inline SVG by design (no Plotly): this is a summary picture, not an
// exploration surface. Zero extra dependency, `currentColor` for dark mode,
// and stable output for print/PDF. See evidence/P2-S1-T1.md for the
// alternative considered and rejected.
import { useId } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import type { ProtocolStep } from '@/types/api';
import { fitPhaseLabel } from './protocol-thermal-label-fit';
import { getPhaseColor, groupPhaseBands } from './protocol-phase-groups';
import { stepEndTemperature } from './protocol-step-temp';

const STEP_WIDTH = 72;
const MARGIN_LEFT = 44;
const MARGIN_RIGHT = 16;
const MARGIN_TOP = 56;
const PLOT_HEIGHT = 120;
const MARGIN_BOTTOM = 40;

function formatIncrement(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}°C/cyc`;
}

/** " ×N" for a band whose steps agree on a cycle count > 1, or '' when
 *  there's nothing to show OR the band's steps disagree (see
 *  groupPhaseBands' `cyclesVary` -- printing one count would assert a
 *  single truth that isn't true for the whole band). */
function bandCyclesSuffix(band: { cycles: number; cyclesVary: boolean }): string {
  if (band.cyclesVary || band.cycles <= 1) return '';
  return ` ×${band.cycles}`;
}

export function ProtocolThermalProfile({ steps }: { steps: ProtocolStep[] }) {
  const { t } = useI18n();
  const titleId = useId();
  if (steps.length === 0) return null;

  const endTemps = steps.map(stepEndTemperature);
  const allTemps = [...steps.map((s) => s.temperature), ...endTemps];
  let minTemp = Math.min(...allTemps);
  let maxTemp = Math.max(...allTemps);
  if (minTemp === maxTemp) { minTemp -= 5; maxTemp += 5; }
  const range = maxTemp - minTemp;

  const xStart = (i: number) => MARGIN_LEFT + i * STEP_WIDTH;
  const xEnd = (i: number) => xStart(i) + STEP_WIDTH;
  const xCenter = (i: number) => xStart(i) + STEP_WIDTH / 2;
  const yTemp = (temp: number) => MARGIN_TOP + PLOT_HEIGHT - ((temp - minTemp) / range) * PLOT_HEIGHT;

  const width = MARGIN_LEFT + steps.length * STEP_WIDTH + MARGIN_RIGHT;
  const height = MARGIN_TOP + PLOT_HEIGHT + MARGIN_BOTTOM;

  let path = '';
  steps.forEach((step, i) => {
    const yStartTemp = yTemp(step.temperature);
    const yEndTemp = yTemp(endTemps[i]);
    path += i === 0 ? `M ${xStart(i)} ${yStartTemp} ` : `L ${xStart(i)} ${yStartTemp} `;
    path += `L ${xEnd(i)} ${yEndTemp} `;
  });

  const bands = groupPhaseBands(steps);
  const readCount = steps.filter((s) => s.plate_read).length;

  const summary = t.protocolThermalProfileSummary(steps.length, readCount, Math.round(minTemp), Math.round(maxTemp));

  return (
    <div className="protocol-thermal-profile-scroll" style={{ overflowX: 'auto', marginBottom: '16px' }}>
      <svg
        data-testid="protocol-thermal-profile"
        role="img"
        aria-labelledby={titleId}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="text-text"
      >
        <title id={titleId}>{t.protocolThermalProfile}</title>
        <desc>{summary}</desc>

        {bands.map((band, bandIndex) => {
          const color = getPhaseColor(band.phase);
          const x0 = xStart(band.startIndex);
          const x1 = xEnd(band.endIndex);
          const cyclesSuffix = bandCyclesSuffix(band);
          const fullLabel = `${band.phase}${cyclesSuffix}`;
          const displayLabel = fitPhaseLabel(band.phase, cyclesSuffix, x1 - x0);
          return (
            <g key={`${band.phase}-${bandIndex}`} data-testid={`protocol-phase-band-${band.phase}-${bandIndex}`}>
              {/* Native tooltip on hover, and the SVG-spec accessible name
                  for this group -- must be the first child to serve as
                  either. Always the full, un-abbreviated text, so a mouse
                  user can still read a shortened/hidden label on hover. */}
              <title>{fullLabel}</title>
              <rect x={x0} y={MARGIN_TOP} width={x1 - x0} height={PLOT_HEIGHT} fill={color.border} fillOpacity={0.12} />
              {displayLabel && (
                <text
                  x={(x0 + x1) / 2}
                  y={16}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={color.label}
                  paintOrder="stroke"
                  stroke="var(--color-bg)"
                  strokeWidth={3}
                >
                  {displayLabel}
                </text>
              )}
            </g>
          );
        })}

        <path d={path.trim()} fill="none" stroke="currentColor" strokeWidth={2} />

        {/* Temperature axis labels */}
        <text x={MARGIN_LEFT - 6} y={yTemp(maxTemp) + 4} textAnchor="end" fontSize={10} fill="currentColor">{Math.round(maxTemp)}°C</text>
        <text x={MARGIN_LEFT - 6} y={yTemp(minTemp) + 4} textAnchor="end" fontSize={10} fill="currentColor">{Math.round(minTemp)}°C</text>

        {steps.map((step, i) => (
          <g key={step.step} data-testid={`protocol-step-${step.step}`}>
            {step.plate_read && (
              <text
                data-testid={`protocol-read-marker-${step.step}`}
                x={xCenter(i)}
                y={36}
                textAnchor="middle"
                fontSize={13}
                aria-hidden="true"
              >
                {'📷'}
              </text>
            )}
            {step.temp_increment != null && (
              <text
                data-testid={`protocol-touchdown-${step.step}`}
                x={xCenter(i)}
                y={(yTemp(step.temperature) + yTemp(endTemps[i])) / 2 - 6}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                paintOrder="stroke"
                stroke="var(--color-bg)"
                strokeWidth={3}
              >
                {formatIncrement(step.temp_increment)}
              </text>
            )}
            <text
              x={xCenter(i)}
              y={MARGIN_TOP + PLOT_HEIGHT + 18}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
            >
              {step.duration_sec}s
            </text>
          </g>
        ))}
      </svg>
      {/* Screen-reader-only fallback for phase-band information: the
          on-diagram label above may be abbreviated or hidden entirely for
          a narrow band (see fitPhaseLabel), but the full phase name and
          cycle count must never be lost, only re-routed. This list always
          carries the complete, untruncated set, independent of what the
          SVG happened to have room to draw. */}
      <ul className="sr-only" aria-label={t.protocolThermalProfilePhaseLegend}>
        {bands.map((band, bandIndex) => {
          const cyclesSuffix = bandCyclesSuffix(band);
          return <li key={`legend-${band.phase}-${bandIndex}`}>{`${band.phase}${cyclesSuffix}`}</li>;
        })}
      </ul>
    </div>
  );
}
