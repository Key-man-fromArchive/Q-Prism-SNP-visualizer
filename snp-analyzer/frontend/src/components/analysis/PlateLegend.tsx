// @TASK P4-LEGEND - Plate view legend (color + glyph + label key)
// @SPEC docs/planning/feedback-2026-09-11/evidence/P4-LEGEND.md
// @TEST src/components/analysis/PlateLegend.test.tsx
import { useMemo } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { callAppearance, displayedCall } from '@/lib/chart-semantics';
import { dosageOfLabel } from '@/lib/genotype';
import type { PlateWell } from '@/types/api';

type PlateLegendProps = {
  wells: readonly PlateWell[];
  showManualTypes: boolean;
  showAutoCluster: boolean;
  ploidy: number;
  dark: boolean;
};

/** Same ordering convention as MarkerScatterPlot's trace order: dosage
 *  classes highest dosage first, then any other assigned type
 *  alphabetically, Unassigned last. Kept local (not exported from
 *  chart-semantics) since it is presentation-only ordering, not an
 *  assignment rule. */
function orderKeys(keys: readonly string[], ploidy: number): string[] {
  return [...keys].sort((a, b) => {
    const da = dosageOfLabel(a, ploidy);
    const db = dosageOfLabel(b, ploidy);
    if (da !== null && db !== null) return db - da;
    if (da !== null) return -1;
    if (db !== null) return 1;
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });
}

/** Plate-view legend: color swatch + glyph + label + well count, for every
 * call that ACTUALLY occurs on the current plate -- not every call the
 * assay could produce. Renders nothing when the plate has no displayed
 * calls yet, so it never shows up as an empty box. Every visual (color,
 * glyph, label) is derived from callAppearance(), the same function
 * PlateView uses to paint each well, so the two can never drift apart. */
export function PlateLegend({ wells, showManualTypes, showAutoCluster, ploidy, dark }: PlateLegendProps) {
  const { t } = useI18n();

  const entries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const well of wells) {
      const key = displayedCall(well, showManualTypes, showAutoCluster);
      if (key === null) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return orderKeys([...counts.keys()], ploidy).map((key) => ({
      key,
      count: counts.get(key)!,
      appearance: callAppearance(key, ploidy, dark, t),
    }));
  }, [wells, showManualTypes, showAutoCluster, ploidy, dark, t]);

  if (entries.length === 0) return null;

  return (
    <div
      role="list"
      aria-label={t.plateLegendAria}
      data-testid="plate-legend"
      className="plate-legend flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs"
    >
      {entries.map(({ key, count, appearance }) => (
        <div
          role="listitem"
          key={key}
          aria-label={`${appearance.description}: ${count}`}
          className="plate-legend-item flex items-center gap-1"
        >
          <span
            aria-hidden="true"
            className="plate-legend-swatch inline-flex h-4 w-4 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: appearance.bgColor }}
          >
            <span style={{ color: appearance.textColor, fontSize: '9px', lineHeight: 1 }}>{appearance.glyph}</span>
          </span>
          <span className="whitespace-nowrap text-text-muted">{appearance.label}</span>
          <span className="font-medium text-text-muted">{count}</span>
        </div>
      ))}
    </div>
  );
}
