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
import { PROTOCOL_PHASE_COLORS, PROTOCOL_AMP_COLORS, PROTOCOL_PHASE_FALLBACK } from '@/lib/constants';

// Duplicated (not imported) from ProtocolTab.tsx: importing it back from
// there would create a component <-> component import cycle. Both read the
// same source-of-truth color maps from src/lib/constants.ts, so the two
// copies cannot drift into different colors, only into different
// *selection* code -- and this selection logic is a 3-line lookup.
function getPhaseColor(phase: string) {
  if (PROTOCOL_PHASE_COLORS[phase]) return PROTOCOL_PHASE_COLORS[phase];
  const m = phase.match(/Amplification\s+(\d+)/);
  if (m) return PROTOCOL_AMP_COLORS[(parseInt(m[1]) - 1) % PROTOCOL_AMP_COLORS.length];
  return PROTOCOL_PHASE_FALLBACK;
}

const STEP_WIDTH = 72;
const MARGIN_LEFT = 44;
const MARGIN_RIGHT = 16;
const MARGIN_TOP = 56;
const PLOT_HEIGHT = 120;
const MARGIN_BOTTOM = 40;

type PhaseBand = { phase: string; startIndex: number; endIndex: number; cycles: number };

function groupPhaseBands(steps: ProtocolStep[]): PhaseBand[] {
  const bands: PhaseBand[] = [];
  steps.forEach((step, i) => {
    const phase = step.phase || '';
    if (!phase) return;
    const last = bands[bands.length - 1];
    if (last && last.phase === phase && last.endIndex === i - 1) {
      last.endIndex = i;
    } else {
      bands.push({ phase, startIndex: i, endIndex: i, cycles: step.cycles });
    }
  });
  return bands;
}

/** The temperature this step ends at: its starting temperature, ramped by
 *  `temp_increment` across its own cycles (touchdown), or unchanged. */
function stepEndTemperature(step: ProtocolStep): number {
  if (step.temp_increment == null || step.cycles <= 1) return step.temperature;
  return step.temperature + step.temp_increment * (step.cycles - 1);
}

function formatIncrement(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}°C/cyc`;
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
          return (
            <g key={`${band.phase}-${bandIndex}`} data-testid={`protocol-phase-band-${band.phase}-${bandIndex}`}>
              <rect x={x0} y={MARGIN_TOP} width={x1 - x0} height={PLOT_HEIGHT} fill={color.border} fillOpacity={0.12} />
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
                {band.phase}{band.cycles > 1 ? ` ×${band.cycles}` : ''}
              </text>
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
    </div>
  );
}
