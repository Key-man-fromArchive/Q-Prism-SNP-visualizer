// @TASK P4-S2 - Analysis surface (per-marker results)
// @SPEC docs/multi-marker-ux-decision.md §1 Q8, §3, §1 Q5
// @TEST e2e/p4-s2-analysis-tab.spec.ts
//
// Replaces the single-marker `<AnalysisTab/>` view inside
// `workspace-panel-analysis` whenever the session has >=1 saved marker
// (assay). Scopes the whole analysis view (scatter/counts/ploidy/NTC note)
// to ONE selected marker at a time -- markers are genotyped, backgrounded
// and NTC-baselined completely independently (Q4/Q5).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, Target } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSessionQc } from "@/stores/qc-ui-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore, ZERO_ORIGIN } from "@/stores/data-store";
import { getScatter, listMarkerCatalog } from "@/lib/api";
import { analyzeCurrent, analyzeRecommended } from "@/lib/analysis-actions";
import { useAnalysisStore } from "@/stores/analysis-store";
import { useNavigationStore, isResultsSurfaceActive } from "@/stores/navigation-store";
import { useSettledAnalysis } from "@/hooks/use-settled-analysis";
import { useCurrentAnalysisRequest } from '@/hooks/use-current-analysis-request';
import { ClusteringAlgorithm } from "@/types/api";
import type { AlleleLabels, MarkerCatalogEntry, MarkerRegion } from "@/types/api";
import { MARKER_PALETTE } from "@/lib/constants";
import { dosageTrustForMarker } from "@/lib/marker-catalog";
import { analysisWarningTexts } from "@/lib/analysis-warnings";
import { qcConfigFromSettings, useNoAmplificationWells } from "@/lib/amplification-qc";
import { AmplificationQcSummary } from "./AmplificationQcSummary";
import { MarkerChipBar } from "./MarkerChipBar";
import type { MarkerChipState } from "@/lib/marker-chip";
import { MarkerScatterPlot } from "./MarkerScatterPlot";
import { AmplificationCurvePanel } from "./AmplificationCurvePanel";
import { callForWell } from "@/lib/well-call";
import { CycleControl } from "./CycleControl";
import { PlateView } from "./PlateView";
import { WellSelectionToolbar } from "./WellSelectionToolbar";
import { WellDetailPanel } from "./WellDetailPanel";
import { ResultsTable } from "./ResultsTable";
import { AmplificationOverlay } from "./AmplificationOverlay";
import { AnalysisCardHeader } from "./AnalysisCardHeader";
import { GenotypeSummary } from "./GenotypeSummary";
import { usePlotViewToggle } from "@/hooks/use-plot-view-toggle";
import { useWellContextMenu } from "@/hooks/use-well-context-menu";
import { WellTypePopup } from "./WellTypePopup";

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
// P17-MARKER-FLASH follow-up: `backgrounded` (the Results surface isn't the
// active tab) is also a pause reason. This panel now stays mounted and keeps
// its `markers` prop live the whole time the surface is backgrounded (see
// AnalysisWorkspace.tsx), instead of being unmounted/remounted per
// markers-changed event. Without this, every marker add/edit made from the
// Plate Setup tab -- while nobody is looking at Results -- settles this
// debounce and fires a real (immediately-superseded) clustering request for
// each intermediate marker set, not just the final one the user actually
// lands on. `previous.current` in useSettledAnalysis simply goes stale while
// paused, so returning to the surface schedules exactly one analyze for
// whatever the input has become by then -- same one-shot behavior as before.
//
// P21-BACKGROUND: `backgrounded` used to be `surface !== 'analysis'` alone.
// That misses leaving the workspace for a plain top-level tab (settings,
// quality, project, ...): `setTab` only updates `surface` for `plate`/
// `results`, so `surface` is left reading whatever it was on Results, even
// though the whole workspace (this panel included) is now App.tsx CSS-hidden.
// A settings/ROX change made from that other tab was therefore treated as
// "still on Results" and fired a real, wasted clustering request for a panel
// nobody could see -- see navigation-store.ts's `isResultsSurfaceActive`.
function settledAnalysisPaused(playing: boolean, unconfirmed: boolean, exporting: boolean, navigating: boolean, backgrounded: boolean) {
  return playing || unconfirmed || exporting || navigating || backgrounded;
}

export function MultiMarkerAnalysisPanel({ markers }: MultiMarkerAnalysisPanelProps) {
  const { t } = useI18n();
  // P12-PLOT-TOGGLE (FB-12): same scatter/curve switch as the single-marker
  // results screen (ResultsPlotToggle.tsx), sharing its state/buttons via
  // this hook rather than duplicating them.
  const { view: plotView, toggle: plotToggle } = usePlotViewToggle();
  const wellMenu = useWellContextMenu();
  const expert = useSettingsStore((s) => s.expertMode);
  const sessionId = useSessionStore((s) => s.sessionId);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const isPlaying = useSelectionStore((s) => s.isPlaying);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const scatterPoints = useDataStore((s) => s.scatterPoints);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  const ratioOrigin = useDataStore((s) => s.ratioOrigin);
  const setScatterData = useDataStore((s) => s.setScatterData);
  const result = useAnalysisStore(state => state.result);
  const regionsById = useMemo(() => Object.fromEntries((result?.regions ?? []).map(region => [region.id, region])), [result]);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const selectedMarkerId = useNavigationStore(state => state.marker);
  const setSelectedMarkerId = useNavigationStore(state => state.setMarker);
  const loading = useAnalysisStore(state => state.pending);
  const analysisError = useAnalysisStore(state => state.error);
  const error = analysisError instanceof Error ? analysisError.message : null;
  const inputRevision = useAnalysisStore(state => state.currentInputRevision);
  const revisionUnconfirmed = useAnalysisStore(state => state.inputRevisionRefreshing || state.inputRevisionError !== null);
  const restoreStatus = useNavigationStore(state => state.status);
  const exportRestoring = useNavigationStore(state => state.exportRestoring);
  const qualityNavigating = useNavigationStore(state => state.qualityNavigating);
  const qualityEpoch = useNavigationStore(state => state.qualityEpoch);
  const backgrounded = !useNavigationStore(isResultsSurfaceActive);
  const entry = useSessionStore(state => state.entryGeneration);
  const scatterRequestRef = useRef(0);
  const skipAutoClusterCycleRef = useRef<number | null>(null);
  // Per-marker dosage-trust hedge (feat/marker-catalog): fetched once
  // per-USER (not per-session), same as the catalog picker in
  // PlateSetupTab.tsx. A fetch failure never blocks analysis -- an unknown
  // catalog state just falls back to the honest "putative" default.
  const [catalogEntries, setCatalogEntries] = useState<MarkerCatalogEntry[]>([]);
  const [scatterProvenance, setScatterProvenance] = useState<{ cycle: number; useRox: boolean; backgroundMode: typeof backgroundMode } | null>(null);

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

  const { settings: qcSettings } = useSessionQc();
  const request = useMemo(() => {
    const amplification_qc = qcConfigFromSettings(qcSettings);
    return { algorithm: ClusteringAlgorithm.AUTO, cycle: currentCycle,
      n_clusters: 4, background: backgroundMode, use_rox: useRox, ...(amplification_qc ? { amplification_qc } : {}) };
  }, [currentCycle, backgroundMode, useRox, qcSettings]);
  useCurrentAnalysisRequest(request, 'analysis');
  const inputKey = JSON.stringify([request, inputRevision, markers.map(marker =>
    [marker.id, marker.wells, marker.ploidy, marker.threshold_config])]);
  const runCluster = useCallback(() => {
    if (skipAutoClusterCycleRef.current === currentCycle) { skipAutoClusterCycleRef.current = null; return; }
    void analyzeCurrent(request);
  }, [request, currentCycle]);
  useSettledAnalysis(
    `${sessionId}:${entry}:${qualityEpoch}`, inputKey, settledAnalysisPaused(isPlaying, revisionUnconfirmed, exportRestoring, qualityNavigating, backgrounded),
    runCluster, restoreStatus === 'ready', exportRestoring,
  );

  const fetchScatter = useCallback(async () => {
    if (!sessionId) return;
    const requestId = ++scatterRequestRef.current;
    const ownership = useAnalysisStore.getState();
    const sessionEntry = useSessionStore.getState().entryGeneration;
    // Captured before the request goes out -- see ScatterPlot.tsx's fetchData
    // for why (P20-STALE-DATA: a cluster merge that lands while this request
    // is in flight must survive this response's own stale auto_cluster/
    // confidence fields).
    const startedAtGeneration = useDataStore.getState().dataGeneration;
    try {
      const res = await getScatter(sessionId, currentCycle, useRox, backgroundMode);
      if (requestId !== scatterRequestRef.current) return;
      const current = useAnalysisStore.getState();
      if (current.sessionId !== ownership.sessionId || current.ownerId !== ownership.ownerId
        || useSessionStore.getState().entryGeneration !== sessionEntry) return;
      setScatterData(
        res.points,
        res.allele2_dye,
        res.channel_labels,
        res.ratio_origin ?? ZERO_ORIGIN,
        // Whether the reporters really were divided by the passive reference.
        // The plot titles its axes off this, not off the `use_rox` request.
        { applied: res.normalization_applied, roxOutlierWells: res.rox_outlier_wells },
        startedAtGeneration
      );
      setScatterProvenance({ cycle: res.cycle, useRox, backgroundMode: res.background_mode ?? backgroundMode });
    } catch (err) {
      console.error("Failed to fetch scatter data:", err);
    }
  }, [sessionId, currentCycle, useRox, backgroundMode, setScatterData]);

  // Scatter follows the cycle immediately. Clustering is deferred until the
  // input settles, and is paused during playback, avoiding three heavy server
  // requests on every animation frame.
  //
  // P21-BACKGROUND: also skipped entirely while `backgrounded` -- unlike
  // clustering this isn't debounced, so a settings/cycle change made while
  // nobody can see this panel used to fire a real `/scatter` request right
  // away. `backgrounded` flipping back to false re-runs this effect (nothing
  // else needs to change) for exactly one catch-up fetch reflecting whatever
  // the input became while backgrounded.
  useEffect(() => {
    if (backgrounded) return;
    void fetchScatter();
    return () => { scatterRequestRef.current += 1; };
  }, [fetchScatter, backgrounded]);

  const handleAnalyze = () => analyzeCurrent(request);
  const handleRecommended = () => analyzeRecommended(request, cycle => {
    skipAutoClusterCycleRef.current = cycle;
    window.dispatchEvent(new CustomEvent("goto-cycle", { detail: cycle }));
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await listMarkerCatalog();
        setCatalogEntries(res.entries);
      } catch {
        setCatalogEntries([]);
      }
    })();
  }, []);

  const catalogById = useMemo(() => {
    const map = new Map<string, MarkerCatalogEntry>();
    for (const e of catalogEntries) map.set(e.id, e);
    return map;
  }, [catalogEntries]);

  const selectedMarker = useMemo(
    () => markers.find((m) => m.id === selectedMarkerId) ?? null,
    [markers, selectedMarkerId]
  );
  const selectedRegion = selectedMarkerId ? regionsById[selectedMarkerId] : undefined;
  // No catalog link (or an unresolvable one) => the honest "putative"
  // default hedge, never breaking / never silently claiming validated.
  const dosageTrust = selectedMarker
    ? dosageTrustForMarker(selectedMarker.catalog_id, catalogById)
    : "putative";

  // Wells that no marker claims: the plate shows them grey with a count.
  const unassignedWells = useMemo(() => {
    const claimed = new Set(markers.flatMap((m) => m.wells));
    return scatterPoints.map((p) => p.well).filter((w) => !claimed.has(w));
  }, [markers, scatterPoints]);

  // Each well is named by the marker it belongs to; the selected marker wins an overlap.
  const wellAlleleLabels = useMemo(() => {
    const map = new Map<string, AlleleLabels | null>();
    const ordered = selectedMarker ? [selectedMarker, ...markers.filter((m) => m !== selectedMarker)] : markers;
    for (const m of ordered) {
      for (const w of m.wells) if (!map.has(w)) map.set(w, m.allele_labels ?? null);
    }
    return map;
  }, [markers, selectedMarker]);

  // Curve view: a well's call is the selected marker's assignment (wells outside
  // it have none and draw as unassigned); its call name is that marker's allele names.
  const curveCallOf = useMemo(() => {
    const assignments = selectedRegion?.assignments ?? null;
    return (well: string) => callForWell(well, { assignments });
  }, [selectedRegion]);
  const curveAlleleLabelsOf = useCallback((well: string) => wellAlleleLabels.get(well), [wellAlleleLabels]);

  const expectedClasses = selectedMarker ? selectedMarker.ploidy + 1 : 0;
  const countsEntries = useMemo(() => {
    if (!selectedRegion?.genotype_counts) return [];
    return Object.entries(selectedRegion.genotype_counts).filter(([k]) => k !== "excluded");
  }, [selectedRegion]);
  // Flagged wells keep the backend's `Undetermined` call; they are counted in their own cell instead.
  const noAmplification = useNoAmplificationWells();
  const noAmplificationCount = selectedMarker
    ? selectedMarker.wells.filter((w) => noAmplification.has(w)
      && [null, undefined, "Undetermined"].includes(selectedRegion?.assignments?.[w])).length
    : 0;
  const chipState = (m: MarkerRegion): MarkerChipState => {
    if (m.wells.length > 0 && m.wells.every((w) => noAmplification.has(w))) return "none";
    return regionsById[m.id] ? "called" : "pending";
  };
  const chipWarnings = (m: MarkerRegion) => regionsById[m.id]?.warnings ?? [];
  const markerNotAmplified = !!selectedMarker && selectedMarker.wells.length > 0
    && selectedMarker.wells.every((w) => noAmplification.has(w));
  const summaryEntries = selectedMarker
    ? countsEntries.map(([key, n]) => {
      const label = countKeyToLabel(key, selectedMarker.ploidy);
      return { label, count: label === "Undetermined" ? Math.max(0, n - noAmplificationCount) : n };
    })
    : [];
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
    <div onContextMenu={wellMenu.onContextMenu}>
      <div className="analysis-primary-toolbar sticky top-0 z-20 border-b border-border bg-surface">
      <CycleControl />
      <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-1">
        {expert && <button type="button" data-testid="multi-analyze-recommended" onClick={handleRecommended} disabled={loading}>{t.analyzeRecommended}</button>}
        <button
          type="button"
          data-testid="multi-analyze-current"
          onClick={handleAnalyze}
          disabled={loading || !sessionId}
          title={t.analyzeHint}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? t.analyzing : <><Target size={14} aria-hidden="true" /> {t.analyzeButton}</>}
        </button>
      </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 p-4 sm:p-6">
      {/* Selected marker's results */}
      <div className="flex flex-col gap-4">
        {/* One-row marker picker above the scatter card, same for every marker count. */}
        <MarkerChipBar markers={markers} selectedId={selectedMarkerId} onSelect={setSelectedMarkerId}
          statusOf={chipState} warningsOf={chipWarnings} />
        {error && (
          <div className="px-3 py-2 rounded-md text-sm text-danger bg-danger/10">{error}</div>
        )}

        {selectedMarker && (
          <>
            <div className="analysis-grid grid gap-4">
            <div className="panel min-w-0">
              <AnalysisCardHeader name={selectedMarker.name} color={selectedMarker.color ?? MARKER_PALETTE[0]}
                ploidy={selectedMarker.ploidy} wells={selectedMarker.wells.length}>
                {expert && <span
                  data-testid="marker-expected-classes"
                  className="rounded-full px-3 py-1 text-xs bg-bg border border-border text-text"
                >
                  {t.wsAnalysisExpectedClasses(expectedClasses)}
                </span>}
                {/* The header's QC summary already carries the review state, so the
                    hedge badge only repeats it in expert mode (or says "validated"). */}
                {(expert || dosageTrust === "validated") && <span
                  data-testid="analysis-dosage-trust"
                  data-trust={dosageTrust}
                  title={
                    dosageTrust === "validated"
                      ? t.wsAnalysisDosageTrustValidatedHint
                      : t.wsAnalysisDosageTrustPutativeHint
                  }
                  className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                    dosageTrust === "validated"
                      ? "bg-success/15 border-success text-success"
                      : "bg-warning/15 border-warning text-warning"
                  }`}
                >
                  {dosageTrust === "validated"
                    ? t.wsAnalysisDosageTrustValidated
                    : t.wsAnalysisDosageTrustPutative}
                </span>}
                {expert && <span
                  data-testid="marker-observed-classes"
                  className={`rounded-full px-3 py-1 text-xs border ${
                    observedExceedsExpected
                      ? "text-danger border-danger bg-danger/10"
                      : "bg-bg border-border text-text"
                  }`}
                  title={observedExceedsExpected ? t.wsAnalysisObservedExceedsWarning : undefined}
                >
                  {t.wsAnalysisObservedClasses(observedClasses)}
                  {observedExceedsExpected ? (
                    <AlertTriangle size={12} aria-hidden="true" className="ml-1 inline" />
                  ) : null}
                </span>}
              </AnalysisCardHeader>

              {markerNotAmplified && (
                <p data-testid="marker-no-amplification" className="mb-3 text-sm text-text-muted">{t.ampQcMarkerNone}</p>
              )}

              {/* Row 1: well selection and the scatter/curve switch; row 2 (the
                  plot's own controls) holds the analysis settings. */}
              <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="analysis-selection-row">
                <div className="min-w-0 flex-1"><WellSelectionToolbar /></div>
                <div className="ml-auto">{plotToggle}</div>
              </div>

              {loading && !selectedRegion && scatterPoints.length === 0 ? (
                <p className="text-sm text-text-muted py-10 text-center">{t.wsAnalysisLoading}</p>
              ) : (
                <>
                  <div style={{ display: plotView === "scatter" ? undefined : "none" }}>
                    <MarkerScatterPlot
                      sessionId={sessionId ?? ""}
                      marker={selectedMarker}
                      region={selectedRegion}
                      points={scatterPoints}
                      scatterProvenance={scatterProvenance}
                      ratioOrigin={ratioOrigin}
                      allele2Dye={allele2Dye}
                      roleLabels={roleLabels}
                      onBoundariesPersisted={runCluster}
                      active={plotView === "scatter"}
                    />
                  </div>
                  <div style={{ display: plotView === "curve" ? undefined : "none" }}>
                    <AmplificationCurvePanel
                      active={plotView === "curve"}
                      bare
                      callOf={curveCallOf}
                      alleleLabelsOf={curveAlleleLabelsOf}
                      ploidyOverride={selectedMarker.ploidy}
                    />
                  </div>
                </>
              )}

              {expert && <div
                data-testid="marker-ntc-note"
                className="flex items-start gap-2 mt-3 px-3 py-2 rounded-md text-xs"
                style={{ background: "var(--color-primary-soft, rgba(37,99,235,0.08))" }}
              >
                <Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{t.wsAnalysisNtcNote}</span>
              </div>}

              {selectedRegion?.warnings && selectedRegion.warnings.length > 0 && (
                <div
                  data-testid="marker-warnings"
                  className="mt-2 px-3 py-2 rounded-md text-xs text-warning"
                  style={{ background: "rgba(217,119,6,0.12)" }}
                >
                  <b>{t.wsAnalysisWarningsTitle}:</b>{" "}
                  {analysisWarningTexts(selectedRegion.warnings, t).join(" ")}
                </div>
              )}
            </div>

            <div className="analysis-review-stack">
              {/* The call summary leads the stack: a tall (384-well) plate must
                  not push the verdict below the first screen. */}
              <GenotypeSummary ploidy={selectedMarker.ploidy} entries={summaryEntries}
                noAmplification={noAmplificationCount} excluded={excludedCount} />
              {/* P4-S3-T1 (FB-03 §3-2): same relocation as the single-marker
                  view -- only meaningful before anything is selected. */}
              {selectedWells.length === 0 && (
                <p data-testid="plate-view-hint" className="text-xs text-text-muted">{t.selectionHelp}</p>
              )}
              <PlateView scopeWells={selectedMarker.wells} ploidyOverride={selectedMarker.ploidy}
                alleleLabels={selectedMarker.allele_labels} wellAlleleLabels={wellAlleleLabels} unassignedWells={unassignedWells} />
              <AmplificationQcSummary />
              <WellDetailPanel ploidyOverride={selectedMarker.ploidy} alleleLabels={selectedMarker.allele_labels} />
            </div>
            </div>

            {expert && <>
              <ResultsTable ploidyOverride={selectedMarker.ploidy} alleleLabels={selectedMarker.allele_labels}
                wellAlleleLabels={wellAlleleLabels} />
              <AmplificationOverlay ploidyOverride={selectedMarker.ploidy} alleleLabels={selectedMarker.allele_labels} />
            </>}
          </>
        )}
      </div>
      </div>
      {wellMenu.position && wellMenu.wells.length > 0 && (
        <WellTypePopup
          wells={wellMenu.wells}
          position={wellMenu.position}
          onAssign={wellMenu.onAssign}
          onClose={wellMenu.close}
          alleleLabels={selectedMarker?.allele_labels}
        />
      )}
      <p role="status" aria-live="polite">{wellMenu.message}</p>
    </div>
  );
}
