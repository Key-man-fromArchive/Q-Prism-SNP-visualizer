// @TASK P4-S2 - Analysis surface (per-marker results)
// @SPEC docs/multi-marker-ux-decision.md §1 Q8, §3, §1 Q5
// @TEST e2e/p4-s2-analysis-tab.spec.ts
//
// Replaces the single-marker `<AnalysisTab/>` view inside
// `workspace-panel-analysis` whenever the session has >=1 saved marker
// (assay). Scopes the whole analysis view (scatter/counts/ploidy/NTC note)
// to ONE selected marker at a time -- markers are genotyped, backgrounded
// and NTC-baselined completely independently (Q4/Q5).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { getScatter, runClustering } from "@/lib/api";
import { ClusteringAlgorithm } from "@/types/api";
import type { ChannelLabels, MarkerRegion, RegionResult, ScatterPoint } from "@/types/api";
import { genotypeShortLabel, wellInfo } from "@/lib/genotype";
import { MARKER_PALETTE } from "@/lib/constants";
import { MarkerScatterPlot } from "./MarkerScatterPlot";

const SIDEBAR_THRESHOLD = 4; // >=4 markers -> sidebar; <=3 -> dropdown (Q8)

// The backend keys ploidy=2 genotype_counts by short diploid codes for
// backward compatibility (AA/BB/AB), unlike ploidy>2 (full dosage strings
// e.g. "AAAB"). Map those to the same label vocabulary as wellInfo/
// genotypeShortLabel expect so the tile renders correctly at every ploidy.
function countKeyToLabel(key: string, ploidy: number): string {
  if (ploidy === 2) {
    if (key === "AA") return "Allele 1 Homo";
    if (key === "BB") return "Allele 2 Homo";
    if (key === "AB") return "Heterozygous";
  }
  return key;
}

type MultiMarkerAnalysisPanelProps = {
  markers: MarkerRegion[];
};

export function MultiMarkerAnalysisPanel({ markers }: MultiMarkerAnalysisPanelProps) {
  const { t } = useI18n();
  const sessionId = useSessionStore((s) => s.sessionId);

  const [regionsById, setRegionsById] = useState<Record<string, RegionResult>>({});
  const [scatterPoints, setScatterPoints] = useState<ScatterPoint[]>([]);
  const [allele2Dye, setAllele2Dye] = useState<string>("");
  const [roleLabels, setRoleLabels] = useState<ChannelLabels | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(
    markers[0]?.id ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the selection valid if the marker set changes (e.g. a marker is
  // renamed/removed on the Plate Setup surface).
  useEffect(() => {
    if (markers.length === 0) {
      setSelectedMarkerId(null);
      return;
    }
    if (!selectedMarkerId || !markers.some((m) => m.id === selectedMarkerId)) {
      setSelectedMarkerId(markers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  const runCluster = useCallback(async () => {
    if (!sessionId || markers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      // No `regions` on the request -> backend clusters the SAVED marker set
      // (each marker independently, honoring any per-marker manual boundary
      // override in threshold_config).
      const result = await runClustering(sessionId, {
        algorithm: ClusteringAlgorithm.AUTO,
        cycle: 0, // 0 => backend uses the last cycle
        n_clusters: 4,
      });
      const byId: Record<string, RegionResult> = {};
      for (const r of result.regions ?? []) byId[r.id] = r;
      setRegionsById(byId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, markers.length]);

  const fetchScatter = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await getScatter(sessionId);
      setScatterPoints(res.points);
      setAllele2Dye(res.allele2_dye);
      setRoleLabels(res.channel_labels ?? null);
    } catch (err) {
      console.error("Failed to fetch scatter data:", err);
    }
  }, [sessionId]);

  // Trigger clustering of the saved markers + load scatter points whenever
  // this surface is entered with markers defined.
  useEffect(() => {
    void runCluster();
    void fetchScatter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, markers.map((m) => m.id).join(","), markers.length]);

  const selectedMarker = useMemo(
    () => markers.find((m) => m.id === selectedMarkerId) ?? null,
    [markers, selectedMarkerId]
  );
  const selectedRegion = selectedMarkerId ? regionsById[selectedMarkerId] : undefined;

  const useSidebar = markers.length >= SIDEBAR_THRESHOLD;

  const expectedClasses = selectedMarker ? selectedMarker.ploidy + 1 : 0;
  const countsEntries = useMemo(() => {
    if (!selectedRegion?.genotype_counts) return [];
    return Object.entries(selectedRegion.genotype_counts).filter(([k]) => k !== "excluded");
  }, [selectedRegion]);
  const observedClasses = countsEntries.filter(([, n]) => n > 0).length;
  const excludedCount = selectedRegion?.genotype_counts?.excluded ?? 0;
  const observedExceedsExpected = selectedMarker
    ? observedClasses > selectedMarker.ploidy + 1
    : false;

  if (markers.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-text-muted">{t.wsAnalysisNoMarkersNote}</p>
      </div>
    );
  }

  return (
    <div className="p-6 grid gap-4" style={{ gridTemplateColumns: "260px minmax(0,1fr)" }}>
      {/* Marker selector */}
      <div className="panel">
        <h3 className="text-sm font-semibold mb-3 text-text">{t.wsAnalysisListTitle}</h3>

        {!useSidebar && (
          <select
            data-testid="marker-selector-dropdown"
            aria-label={t.wsAnalysisSelectMarkerLabel}
            value={selectedMarkerId ?? ""}
            onChange={(e) => setSelectedMarkerId(e.target.value)}
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text mb-1"
          >
            {markers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}

        {useSidebar && (
          <div data-testid="marker-selector-sidebar" className="flex flex-col gap-2">
            {markers.map((m) => {
              const region = regionsById[m.id];
              const wellCount = m.wells.length;
              return (
                <button
                  key={m.id}
                  type="button"
                  data-testid="marker-sidebar-card"
                  onClick={() => setSelectedMarkerId(m.id)}
                  className="text-left border border-border bg-bg rounded-md p-2.5 cursor-pointer"
                  style={
                    selectedMarkerId === m.id
                      ? { boxShadow: "0 0 0 2px var(--color-primary) inset" }
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ background: m.color ?? MARKER_PALETTE[0] }}
                    />
                    <span className="font-semibold text-sm text-text flex-1 truncate">
                      {m.name}
                    </span>
                    <span className="text-xs font-bold text-primary bg-bg rounded px-1.5 py-0.5">
                      {t.wsMarkerPloidyUnit(m.ploidy)}
                    </span>
                    {region?.warnings && region.warnings.length > 0 && (
                      <span title={region.warnings.join(", ")}>⚠</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {t.wsAnalysisWellsCount(wellCount)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected marker's results */}
      <div className="flex flex-col gap-4">
        {error && (
          <div className="px-3 py-2 rounded-md text-sm text-danger bg-danger/10">{error}</div>
        )}

        {selectedMarker && (
          <>
            <div className="panel">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-bg border border-border text-text"
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ background: selectedMarker.color ?? MARKER_PALETTE[0] }}
                  />
                  <b>{selectedMarker.name}</b>
                </span>
                <span
                  data-testid="marker-ploidy-badge"
                  className="rounded-full px-3 py-1 text-xs bg-bg border border-border text-text"
                >
                  {t.wsMarkerPloidyUnit(selectedMarker.ploidy)}
                </span>
                <span
                  data-testid="marker-expected-classes"
                  className="rounded-full px-3 py-1 text-xs bg-bg border border-border text-text"
                >
                  {t.wsAnalysisExpectedClasses(expectedClasses)}
                </span>
                <span
                  data-testid="marker-observed-classes"
                  className={`rounded-full px-3 py-1 text-xs border ${
                    observedExceedsExpected
                      ? "text-danger border-danger bg-danger/10"
                      : "bg-bg border-border text-text"
                  }`}
                  title={observedExceedsExpected ? t.wsAnalysisObservedExceedsWarning : undefined}
                >
                  {t.wsAnalysisObservedClasses(observedClasses)}
                  {observedExceedsExpected ? " ⚠" : ""}
                </span>
                <span className="ml-auto text-xs text-text-muted">
                  {t.wsAnalysisWellsCount(selectedMarker.wells.length)}
                </span>
              </div>

              {loading ? (
                <p className="text-sm text-text-muted py-10 text-center">{t.wsAnalysisLoading}</p>
              ) : (
                <MarkerScatterPlot
                  key={selectedMarker.id}
                  sessionId={sessionId ?? ""}
                  marker={selectedMarker}
                  region={selectedRegion}
                  points={scatterPoints}
                  allele2Dye={allele2Dye}
                  roleLabels={roleLabels}
                  onBoundariesPersisted={runCluster}
                />
              )}

              <div
                data-testid="marker-ntc-note"
                className="flex items-start gap-2 mt-3 px-3 py-2 rounded-md text-xs"
                style={{ background: "var(--color-primary-soft, rgba(37,99,235,0.08))" }}
              >
                <span>ℹ</span>
                <span>{t.wsAnalysisNtcNote}</span>
              </div>

              {selectedRegion?.warnings && selectedRegion.warnings.length > 0 && (
                <div
                  data-testid="marker-warnings"
                  className="mt-2 px-3 py-2 rounded-md text-xs text-amber-700"
                  style={{ background: "rgba(217,119,6,0.12)" }}
                >
                  <b>{t.wsAnalysisWarningsTitle}:</b> {selectedRegion.warnings.join(", ")}
                </div>
              )}
            </div>

            <div className="panel">
              <h3 className="text-sm font-semibold mb-3 text-text">
                {t.wsAnalysisGenotypeCountsTitle}
              </h3>
              <div
                data-testid="genotype-counts"
                className="grid gap-2"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))" }}
              >
                {countsEntries.map(([key, n]) => {
                  const label = countKeyToLabel(key, selectedMarker.ploidy);
                  const info = wellInfo(label, selectedMarker.ploidy);
                  const short = genotypeShortLabel(label, selectedMarker.ploidy);
                  return (
                    <div
                      key={key}
                      className="border border-border rounded-md p-2 text-center"
                      style={{ background: "var(--color-bg)" }}
                    >
                      <div
                        className="text-lg font-bold tabular-nums"
                        style={{ color: info.color }}
                      >
                        {n}
                      </div>
                      <div className="text-[10px] text-text-muted font-mono mt-0.5">{short}</div>
                    </div>
                  );
                })}
                <div className="border border-border rounded-md p-2 text-center">
                  <div className="text-lg font-bold tabular-nums text-text-muted">
                    {excludedCount}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {t.wsAnalysisExcludedLabel}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
