// @TASK P10-PROTOCOL - shared touchdown end-temperature calculation
// @TEST src/components/protocol/ProtocolThermalProfile.test.tsx,
//       src/components/protocol/ProtocolTab.test.tsx
//
// Split out of ProtocolThermalProfile.tsx (a component file) so
// ProtocolStepsTable.tsx's read-only summary rows can show the same
// touchdown end-temperature as the diagram without a second copy of the
// formula, and without importing a component file back into a component
// file (react-refresh/only-export-components would flag a component file
// that also exports a plain function -- see this directory's
// use-protocol-editor.ts / protocol-thermal-label-fit.ts for the same
// pattern already established here).
import type { ProtocolStep } from '@/types/api';

/** The temperature this step ends at: its starting temperature, ramped by
 *  `temp_increment` across its own cycles (touchdown), or unchanged. */
export function stepEndTemperature(step: ProtocolStep): number {
  if (step.temp_increment == null || step.cycles <= 1) return step.temperature;
  return step.temperature + step.temp_increment * (step.cycles - 1);
}

/** Rounds to 1 decimal place for display -- touchdown arithmetic
 *  (temperature + increment * (cycles - 1)) can land on values like
 *  55.599999999999994 in floating point. */
export function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}
