import { useMemo } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { UNASSIGNED_TYPE } from "@/lib/constants";
import { wellInfo, genotypeShortLabel } from "@/lib/genotype";
import { useWellFilter } from "@/hooks/use-well-filter";
import { useWellGrid } from "@/hooks/use-well-grid";
import { useI18n } from "@/hooks/use-i18n";
import { StatusState } from "@/components/shared/ui";
import type { ScatterPoint } from "@/types/api";
import { useIsDarkMode } from "@/hooks/use-dark-mode";

const LABEL_MAP: Record<string, string> = {
  "Allele 1 Homo": "A1",
  "Allele 2 Homo": "A2",
  Heterozygous: "Het",
  NTC: "NTC",
  "Positive Control": "PC",
  Unknown: "Unk",
  Undetermined: "Und",
  Empty: "E",
  Omit: "Om",
  Unassigned: "",
};

function isLightColor(hex: string): boolean {
  if (!hex || hex.length < 7) return true;
  const [r, g, b] = [1, 3, 5].map(index => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179;
}

function effectiveType(
  autoCluster: string | null,
  manualType: string | null,
  showAuto: boolean,
  showManual: boolean
): string | null {
  if (showManual && manualType) return manualType;
  if (showAuto && autoCluster) return autoCluster;
  return null;
}

type ResultsTableProps = { ploidyOverride?: number };

function resultAppearance(type: string | null, ploidy: number, dark: boolean) {
  const info = type ? wellInfo(type, ploidy, dark) : UNASSIGNED_TYPE;
  return {
    label: type ? LABEL_MAP[type] ?? genotypeShortLabel(type, ploidy) : '',
    bgColor: type ? info.color : 'transparent',
    textColor: type && !isLightColor(info.color) ? '#ffffff' : '#000000',
  };
}

export function ResultsTable({ ploidyOverride }: ResultsTableProps = {}) {
  const { t } = useI18n();
  const dark = useIsDarkMode();
  const scatterPoints = useDataStore((s) => s.scatterPoints);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const showAutoCluster = useSettingsStore((s) => s.showAutoCluster);
  const showManualTypes = useSettingsStore((s) => s.showManualTypes);
  const storedPloidy = useSettingsStore((s) => s.ploidy);
  const ploidy = ploidyOverride ?? storedPloidy;

  const { visibleRows, visibleCols } = useWellFilter();
  const grid = useWellGrid(visibleRows, visibleCols, scatterPoints.map(point => point.well));

  const wellMap = useMemo(() => {
    const map = new Map<string, ScatterPoint>();
    for (const p of scatterPoints) map.set(p.well, p);
    return map;
  }, [scatterPoints]);

  return (
    <div className="panel results-panel">
      <h3 className="text-sm font-semibold mb-2 text-text">{t.genotypeResults}</h3>
      <p role="status" aria-live="polite" className="sr-only">{t.selectedWellCount(selectedWells.length)}</p>

      {scatterPoints.length === 0 ? (
        <StatusState variant="empty" message={t.scatterEmpty} />
      ) : (
      <div
        id="results-plate"
        role="grid"
        aria-label={t.genotypeResults}
        onKeyDown={grid.onKeyDown}
        style={{
          display: "grid",
          gridTemplateColumns: `auto repeat(${visibleCols.length}, 1fr)`,
          gap: "2px",
          fontSize: "0.7rem",
        }}
      >
        {/* Corner */}
        <div role="row" style={{ display: 'contents' }}>
        <div role="columnheader" className="plate-label" />

        {/* Column headers */}
        {visibleCols.map((col, c) => (
          <button
            {...grid.cell(-1, c)}
            type="button"
            role="columnheader"
            aria-label={t.toggleColumnAria(col)}
            key={`col-${col}`}
            className="text-center text-xs text-text-muted font-medium"
            style={{ padding: "2px" }}
          >
            {col}
          </button>
        ))}
        </div>

        {/* Rows */}
        {visibleRows.map((row, r) => (
          <div role="row" key={row} style={{ display: 'contents' }}>
            <button
              {...grid.cell(r, -1)}
              type="button"
              role="rowheader"
              aria-label={t.toggleRowAria(row)}
              className="text-center text-xs text-text-muted font-medium"
              style={{ padding: "2px" }}
            >
              {row}
            </button>

            {visibleCols.map((col, c) => {
              const well = `${row}${col}`;
              const point = wellMap.get(well);

              if (!point) {
                return (
                  <button
                    {...grid.cell(r, c)}
                    type="button"
                    role="gridcell"
                    aria-label={`${well}, ${t.wellEmptyState}`}
                    aria-selected={false}
                    key={well}
                    className="result-cell text-center text-text-muted"
                    data-well={well}
                    style={{
                      padding: "4px 2px",
                      borderRadius: "3px",
                      background: "transparent",
                    }}
                  >
                    <span className="text-[9px]">{well}</span>
                  </button>
                );
              }

              const type = effectiveType(
                point.auto_cluster,
                point.manual_type,
                showAutoCluster,
                showManualTypes
              );
              const { label, bgColor, textColor } = resultAppearance(type, ploidy, dark);

              const confPct =
                point.confidence != null ? ` · ${t.confidence} ${Math.round(point.confidence * 100)}%` : "";
              return (
                <button
                  {...grid.cell(r, c)}
                  type="button"
                  role="gridcell"
                  aria-label={`${well}, ${type ?? t.wellEmptyState}${selectedWells.includes(well) ? `, ${t.wellSelectedState}` : ''}`}
                  aria-selected={selectedWells.includes(well)}
                  key={well}
                  className="result-cell text-center cursor-pointer hover:opacity-80"
                  data-well={well}
                  title={`${well}${type ? ": " + type : ""}${confPct}`}
                  style={{
                    padding: "4px 2px",
                    borderRadius: "3px",
                    backgroundColor: bgColor,
                    color: textColor,
                    transition: "all 0.15s",
                  }}
                >
                  <div className="text-[9px]">{well}</div>
                  <div className="font-medium">{label}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
