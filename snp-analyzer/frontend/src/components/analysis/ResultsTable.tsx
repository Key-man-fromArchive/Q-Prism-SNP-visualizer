import { Fragment, useMemo } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { UNASSIGNED_TYPE } from "@/lib/constants";
import { wellInfo, genotypeShortLabel } from "@/lib/genotype";
import { useWellFilter } from "@/hooks/use-well-filter";
import { useI18n } from "@/hooks/use-i18n";
import { StatusState } from "@/components/shared/ui";
import type { ScatterPoint } from "@/types/api";

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
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
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

export function ResultsTable() {
  const { t } = useI18n();
  const scatterPoints = useDataStore((s) => s.scatterPoints);
  const { selectWell } = useSelectionStore();
  const { showAutoCluster, showManualTypes } = useSettingsStore();
  const ploidy = useSettingsStore((s) => s.ploidy);

  const { visibleRows, visibleCols } = useWellFilter();

  const wellMap = useMemo(() => {
    const map = new Map<string, ScatterPoint>();
    for (const p of scatterPoints) map.set(p.well, p);
    return map;
  }, [scatterPoints]);

  return (
    <div className="panel results-panel">
      <h3 className="text-sm font-semibold mb-2 text-text">{t.genotypeResults}</h3>

      {scatterPoints.length === 0 ? (
        <StatusState variant="empty" message={t.scatterEmpty} />
      ) : (
      <div
        id="results-plate"
        style={{
          display: "grid",
          gridTemplateColumns: `auto repeat(${visibleCols.length}, 1fr)`,
          gap: "2px",
          fontSize: "0.7rem",
        }}
      >
        {/* Corner */}
        <div className="plate-label" />

        {/* Column headers */}
        {visibleCols.map((col) => (
          <div
            key={`col-${col}`}
            className="text-center text-xs text-text-muted font-medium"
            style={{ padding: "2px" }}
          >
            {col}
          </div>
        ))}

        {/* Rows */}
        {visibleRows.map((row) => (
          <Fragment key={row}>
            <div
              className="text-center text-xs text-text-muted font-medium"
              style={{ padding: "2px" }}
            >
              {row}
            </div>

            {visibleCols.map((col) => {
              const well = `${row}${col}`;
              const point = wellMap.get(well);

              if (!point) {
                return (
                  <div
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
                  </div>
                );
              }

              const type = effectiveType(
                point.auto_cluster,
                point.manual_type,
                showAutoCluster,
                showManualTypes
              );
              const info = type ? wellInfo(type, ploidy) : UNASSIGNED_TYPE;
              const label = type ? LABEL_MAP[type] ?? genotypeShortLabel(type, ploidy) : "";
              const bgColor = type ? info.color : "transparent";
              const textColor = type && !isLightColor(info.color) ? "#ffffff" : "#1a1a2e";

              const confPct =
                point.confidence != null ? ` · ${t.confidence} ${Math.round(point.confidence * 100)}%` : "";
              return (
                <div
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
                  onClick={() => selectWell(well, "table")}
                >
                  <div className="text-[9px] opacity-70">{well}</div>
                  <div className="font-medium">{label}</div>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      )}
    </div>
  );
}
