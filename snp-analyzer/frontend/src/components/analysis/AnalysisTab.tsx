import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import {
  setWellTypes,
  getWellGroups,
  getWellTypes,
  getCluster,
  runClustering as apiRunClustering,
  suggestCycle,
  type CycleSuggestion,
} from "@/lib/api";
import { CycleControl } from "./CycleControl";
import { ScatterPlot } from "./ScatterPlot";
import { PlateView } from "./PlateView";
import { WellDetailPanel } from "./WellDetailPanel";
import { ResultsTable } from "./ResultsTable";
import { AmplificationOverlay } from "./AmplificationOverlay";
import { WellTypePopup } from "./WellTypePopup";
import { GroupManager } from "./GroupManager";

export function AnalysisTab() {
  const { t } = useI18n();
  const sessionId = useSessionStore((s) => s.sessionId);
  const wellGroups = useSessionStore((s) => s.wellGroups);
  const setWellGroups = useSessionStore((s) => s.setWellGroups);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const selectedGroup = useSelectionStore((s) => s.selectedGroup);
  const setGroup = useSelectionStore((s) => s.setGroup);
  const { showEmptyWells, setShowEmptyWells } = useSettingsStore();
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);
  const setWellTypeAssignments = useDataStore((s) => s.setWellTypeAssignments);

  // Clustering / analysis
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const setClusterAssignments = useDataStore((s) => s.setClusterAssignments);
  const setBoundaries = useDataStore((s) => s.setBoundaries);
  const { ntcThreshold, allele1RatioMax, allele2RatioMin, nClusters } = useSettingsStore();
  const ploidy = useSettingsStore((s) => s.ploidy);
  const setPloidy = useSettingsStore((s) => s.setPloidy);
  const showManualTypes = useSettingsStore((s) => s.showManualTypes);
  const showBoundaryLines = useSettingsStore((s) => s.showBoundaryLines);
  const setShowBoundaryLines = useSettingsStore((s) => s.setShowBoundaryLines);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<CycleSuggestion | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const autoRanSession = useRef<string | null>(null);

  const stageLabel = (w: string) =>
    w === "Pre-read"
      ? t.stagePreRead
      : w === "Amplification"
      ? t.stageAmplification
      : w === "Post-read"
      ? t.stagePostRead
      : w;

  const [showGroupManager, setShowGroupManager] = useState(false);

  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [popupWells, setPopupWells] = useState<string[]>([]);

  // Show popup when multiple wells are selected (right-click or multi-select)
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      let wells = useSelectionStore.getState().selectedWells;
      // If nothing is selected, right-clicking directly on a well targets it
      // (so a single well can be omitted without selecting it first).
      if (wells.length === 0) {
        const el = (e.target as HTMLElement).closest('[data-well]');
        const wellId = el?.getAttribute('data-well');
        if (wellId) wells = [wellId];
      }
      if (wells.length > 0) {
        e.preventDefault();
        setPopupPos({ x: e.clientX, y: e.clientY });
        setPopupWells(wells);
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Auto-show popup on multi-select (more than 1 well selected via drag)
  useEffect(() => {
    if (selectedWells.length > 1) {
      // Position popup near center of viewport
      setPopupPos({
        x: window.innerWidth / 2 - 90,
        y: window.innerHeight / 2 - 150,
      });
      setPopupWells(selectedWells);
    }
  }, [selectedWells]);

  const handleAssignType = useCallback(
    async (wellType: string) => {
      if (!sessionId || popupWells.length === 0) return;
      try {
        await setWellTypes(sessionId, { wells: popupWells, well_type: wellType as any });
        window.dispatchEvent(new CustomEvent("welltypes-changed"));
      } catch (err) {
        console.error("Failed to assign well type:", err);
      }
      setPopupPos(null);
      setPopupWells([]);
      clearSelection();
    },
    [sessionId, popupWells, clearSelection]
  );

  const handleClosePopup = useCallback(() => {
    setPopupPos(null);
    setPopupWells([]);
  }, []);

  // Fetch merged well groups (parsed + manual) when session changes
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const res = await getWellGroups(sessionId);
        const merged: Record<string, string[]> = {};
        for (const [name, info] of Object.entries(res.groups)) {
          merged[name] = info.wells;
        }
        if (Object.keys(merged).length > 0) {
          setWellGroups(merged);
        }
      } catch {
        // groups endpoint may not exist yet on old data
      }
    })();
  }, [sessionId, setWellGroups]);

  // Keep the well-type store in sync with the backend so filters that depend
  // on it (Omit/Empty exclusion in scatter, plate, results) actually work.
  useEffect(() => {
    if (!sessionId) return;
    const load = async () => {
      try {
        const res = await getWellTypes(sessionId);
        setWellTypeAssignments(res.assignments || {});
      } catch {
        // welltypes endpoint may be empty for a fresh session
      }
    };
    load();
    window.addEventListener("welltypes-changed", load);
    return () => window.removeEventListener("welltypes-changed", load);
  }, [sessionId, setWellTypeAssignments]);

  // Intelligent one-click analysis: suggest the best cycle (max separation
  // before NTC background rises), jump the cycle control to it, and cluster.
  const handleAnalyze = useCallback(async () => {
    if (!sessionId) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const suggestion = await suggestCycle(sessionId);
      const cycle = suggestion.suggested_cycle ?? currentCycle ?? 0;
      if (suggestion.suggested_cycle) {
        // Move the cycle control (and thus scatter/plate) to the suggested cycle.
        window.dispatchEvent(
          new CustomEvent("goto-cycle", { detail: suggestion.suggested_cycle })
        );
      }
      // "auto" = data-driven, rank-based labeling (handles hets that lean to
      // one allele instead of sitting at ratio 0.5).
      const result = await apiRunClustering(sessionId, {
        algorithm: "auto",
        cycle,
        threshold_config: {
          ntc_threshold: ntcThreshold,
          allele1_ratio_max: allele1RatioMax,
          allele2_ratio_min: allele2RatioMin,
        },
        n_clusters: nClusters,
        ploidy: useSettingsStore.getState().ploidy,
      });
      setClusterAssignments(result.assignments);
      setBoundaries(result.boundaries ?? null);
      setAnalysis(suggestion);
      // Force scatter/plate to re-fetch so points pick up auto_cluster calls.
      window.dispatchEvent(new CustomEvent("welltypes-changed"));
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : t.analyzeFailed);
      console.error("Analysis failed:", err);
    } finally {
      setAnalyzing(false);
    }
  }, [
    sessionId,
    currentCycle,
    ntcThreshold,
    allele1RatioMax,
    allele2RatioMin,
    nClusters,
    setClusterAssignments,
    t,
  ]);

  // Run the analysis automatically the first time a session's data is ready, so
  // the allele-discrimination plot opens already grouped instead of a raw mess.
  // Skip if the session was already analysed (don't clobber an existing result).
  useEffect(() => {
    if (!sessionId || !currentCycle) return;
    if (autoRanSession.current === sessionId) return;
    autoRanSession.current = sessionId;
    (async () => {
      try {
        const existing = await getCluster(sessionId);
        if (existing?.assignments && Object.keys(existing.assignments).length > 0) {
          setClusterAssignments(existing.assignments);
          setBoundaries(existing.boundaries ?? null);
          return;
        }
      } catch {
        // no existing clustering — fall through to auto-analyse
      }
      handleAnalyze();
    })();
  }, [sessionId, currentCycle, handleAnalyze, setClusterAssignments]);

  // Check if any wells are typed as Empty
  const hasEmptyWells = useMemo(
    () => Object.values(wellTypeAssignments).some((t) => t === "Empty"),
    [wellTypeAssignments]
  );

  // Group names for dropdown
  const groupNames = useMemo(
    () => (wellGroups ? Object.keys(wellGroups) : []),
    [wellGroups]
  );

  const totalWells = useMemo(() => {
    if (!wellGroups) return 0;
    const all = new Set<string>();
    for (const wells of Object.values(wellGroups)) {
      for (const w of wells) all.add(w);
    }
    return all.size;
  }, [wellGroups]);

  return (
    <div>
      {/* Cycle Control */}
      <CycleControl />

      {/* Analyze bar */}
      <div
        className="flex flex-wrap items-center justify-end gap-3 px-6 py-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {analysis && !analyzeError && (
          <span className="text-xs text-text-muted">
            {analysis.suggested_cycle != null &&
              t.analyzeSuggestedCycle(
                (analysis.suggested_low != null &&
                analysis.suggested_high != null &&
                analysis.suggested_low !== analysis.suggested_high
                  ? `${analysis.suggested_low}~${analysis.suggested_high}`
                  : String(analysis.suggested_cycle)) +
                  (analysis.suggested_window
                    ? ` (${stageLabel(analysis.suggested_window)})`
                    : "")
              )}
            {analysis.ntc_onset_cycle != null
              ? ` · ${t.analyzeNtcOnset(analysis.ntc_onset_cycle)}`
              : ` · ${t.analyzeNtcNone}`}
          </span>
        )}
        {analyzeError && <span className="text-xs text-danger">{analyzeError}</span>}
        <label className="flex items-center gap-1.5 text-xs text-text-muted" title={t.ploidyHint}>
          {t.ploidyLabel}
          <select
            value={ploidy}
            onChange={(e) => {
              setPloidy(Number(e.target.value));
              // Re-cluster with the new ploidy (handleAnalyze reads it fresh).
              handleAnalyze();
            }}
            disabled={analyzing || !sessionId}
            className="rounded-md border px-1.5 py-1 text-sm bg-surface cursor-pointer"
            style={{ borderColor: "var(--border)" }}
          >
            {[2, 3, 4, 5, 6, 7, 8].map((p) => (
              <option key={p} value={p}>
                {p === 2 ? t.ploidyDiploid : `${p}x`}
              </option>
            ))}
          </select>
        </label>
        {/* Draggable genotype-boundary lines — only meaningful in manual mode */}
        <button
          onClick={() => setShowBoundaryLines(!showBoundaryLines)}
          disabled={!showManualTypes || !sessionId}
          title={showManualTypes ? t.boundaryLinesHint : t.boundaryLinesManualOnly}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer disabled:opacity-50 ${
            showBoundaryLines && showManualTypes
              ? "bg-primary text-white"
              : "border text-text"
          }`}
          style={showBoundaryLines && showManualTypes ? undefined : { borderColor: "var(--border)" }}
        >
          📏 {t.boundaryLines}
        </button>
        <button
          onClick={handleAnalyze}
          disabled={analyzing || !sessionId}
          title={t.analyzeHint}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary-hover disabled:opacity-60 cursor-pointer"
        >
          {analyzing ? t.analyzing : `🎯 ${t.analyzeButton}`}
        </button>
      </div>

      {/* Group Filter Bar */}
      {(groupNames.length > 0 || hasEmptyWells) && (
        <div
          className="flex items-center gap-3 px-6 py-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {groupNames.length > 0 && (
            <>
              <label className="text-xs text-text-muted font-medium">{t.group}</label>
              <select
                className="px-2 py-1 border border-border rounded text-xs bg-surface text-text"
                value={selectedGroup || ""}
                onChange={(e) => setGroup(e.target.value || null)}
              >
                <option value="">{t.allWells(totalWells)}</option>
                {groupNames.map((name) => (
                  <option key={name} value={name}>
                    {name} ({wellGroups![name].length})
                  </option>
                ))}
              </select>
              <button
                className="text-xs px-2 py-1 rounded border border-border bg-surface text-text hover:bg-bg cursor-pointer"
                onClick={() => setShowGroupManager(true)}
                title={t.manageGroups}
              >
                +
              </button>
            </>
          )}
          {!groupNames.length && (
            <button
              className="text-xs px-2 py-1 rounded border border-border bg-surface text-text hover:bg-bg cursor-pointer"
              onClick={() => setShowGroupManager(true)}
              title={t.createWellGroups}
            >
              {t.plusGroup}
            </button>
          )}
          {hasEmptyWells && (
            <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer ml-auto">
              <input
                type="checkbox"
                checked={showEmptyWells}
                onChange={(e) => setShowEmptyWells(e.target.checked)}
              />
              {t.showEmpty}
            </label>
          )}
        </div>
      )}

      {/* Analysis Grid - 2x2 layout */}
      <div
        className="analysis-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          padding: "16px 24px",
        }}
      >
        {/* Scatter Plot - top left */}
        <ScatterPlot />

        {/* Plate View - top right */}
        <PlateView />

        {/* Well Detail - bottom left */}
        <WellDetailPanel />

        {/* Results Table - bottom right */}
        <ResultsTable />
      </div>

      {/* Amplification Overlay - full width below grid */}
      <div style={{ padding: "0 24px 16px" }}>
        <AmplificationOverlay />
      </div>

      {/* Well Type Popup */}
      {popupPos && popupWells.length > 0 && (
        <WellTypePopup
          wells={popupWells}
          position={popupPos}
          onAssign={handleAssignType}
          onClose={handleClosePopup}
        />
      )}

      {/* Group Manager Dialog */}
      {showGroupManager && sessionId && (
        <GroupManager
          sessionId={sessionId}
          onClose={() => setShowGroupManager(false)}
        />
      )}
    </div>
  );
}
