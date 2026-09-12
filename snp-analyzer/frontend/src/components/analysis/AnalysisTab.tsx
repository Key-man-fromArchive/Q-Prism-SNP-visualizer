import { useState, useCallback, useEffect, useMemo } from "react";
import { AlertTriangle, Ruler, Target } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import {
  getWellGroups,
} from "@/lib/api";
import { analyzeCurrent, analyzeRecommended } from "@/lib/analysis-actions";
import { useAnalysisStore } from "@/stores/analysis-store";
import { CycleControl } from "./CycleControl";
import { ScatterPlot } from "./ScatterPlot";
import { PlateView } from "./PlateView";
import { WellDetailPanel } from "./WellDetailPanel";
import { ResultsTable } from "./ResultsTable";
import { AmplificationOverlay } from "./AmplificationOverlay";
import { WellTypePopup } from "./WellTypePopup";
import { GroupManager } from "./GroupManager";
import { WellSelectionToolbar } from "./WellSelectionToolbar";
import { Callout } from "@/components/shared/ui";
import { analysisWarningTexts } from "@/lib/analysis-warnings";
import { parseWellType } from "@/lib/well-type-input";
import { useWellTypeAssignments } from "@/hooks/use-well-type-assignments";
import { useCurrentAnalysisRequest } from '@/hooks/use-current-analysis-request';
import { useKeyboardAssignment } from '@/hooks/use-keyboard-assignment';

export function AnalysisTab() {
  const { t } = useI18n();
  const { assign, message: assignmentMessage } = useKeyboardAssignment();
  const sessionId = useSessionStore((s) => s.sessionId);
  const wellGroups = useSessionStore((s) => s.wellGroups);
  const setWellGroups = useSessionStore((s) => s.setWellGroups);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectedGroup = useSelectionStore((s) => s.selectedGroup);
  const setGroup = useSelectionStore((s) => s.setGroup);
  const showEmptyWells = useSettingsStore((s) => s.showEmptyWells);
  const setShowEmptyWells = useSettingsStore((s) => s.setShowEmptyWells);
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);
  useWellTypeAssignments();

  // Clustering / analysis
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const lowSeparation = useDataStore((s) => s.lowSeparation);
  const ntcThreshold = useSettingsStore((s) => s.ntcThreshold);
  const allele1RatioMax = useSettingsStore((s) => s.allele1RatioMax);
  const allele2RatioMin = useSettingsStore((s) => s.allele2RatioMin);
  const nClusters = useSettingsStore((s) => s.nClusters);
  const ploidy = useSettingsStore((s) => s.ploidy);
  const useRox = useSettingsStore(s => s.useRox);
  const backgroundMode = useSettingsStore(s => s.backgroundMode);
  const ntcCorner = useDataStore(s => s.ntcCorner);
  const setPloidy = useSettingsStore((s) => s.setPloidy);
  const showManualTypes = useSettingsStore((s) => s.showManualTypes);
  const showBoundaryLines = useSettingsStore((s) => s.showBoundaryLines);
  const setShowBoundaryLines = useSettingsStore((s) => s.setShowBoundaryLines);
  const analyzing = useAnalysisStore(state => state.pending);
  const error = useAnalysisStore(state => state.error);
  const analyzeError = error instanceof Error ? error.message : null;
  const analysisWarnings = useAnalysisStore(state => state.result?.warnings) ?? [];

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

  const handleAssignType = useCallback(
    async (wellType: string) => {
      if (!sessionId || popupWells.length === 0) return;
      const assignment = parseWellType(wellType);
      if (!assignment) return;
      const succeeded = await assign(assignment, popupWells);
      if (!succeeded) return;
      setPopupPos(null);
      setPopupWells([]);
      if (useSelectionStore.getState().selectedWells.join('|') === popupWells.join('|')) clearSelection();
    },
    [sessionId, popupWells, clearSelection, assign]
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

  const currentRequest = useMemo(() => ({
    algorithm: "auto" as const, cycle: currentCycle, n_clusters: nClusters,
    ploidy, background: backgroundMode, use_rox: useRox,
    threshold_config: { ntc_threshold: ntcThreshold, allele1_ratio_max: allele1RatioMax,
      allele2_ratio_min: allele2RatioMin, ntc_fam_max: ntcCorner?.fam ?? null,
      ntc_allele2_max: ntcCorner?.allele2 ?? null },
  }), [currentCycle, nClusters, ploidy, backgroundMode, useRox, ntcThreshold, allele1RatioMax, allele2RatioMin, ntcCorner]);
  useCurrentAnalysisRequest(currentRequest, 'analysis');
  const handleAnalyze = () => analyzeCurrent(currentRequest);
  const handleRecommended = () => analyzeRecommended(currentRequest, cycle =>
    window.dispatchEvent(new CustomEvent("goto-cycle", { detail: cycle })));

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
      {/* Single sticky analysis toolbar: cycle control + analyze/ploidy/boundary
          controls read as one bar and stay visible while scrolling (PRD FR-NAV-2). */}
      <div className="analysis-primary-toolbar sticky top-0 z-20 bg-surface border-b border-border">
      {/* Cycle Control */}
      <CycleControl />

      {/* Analyze bar */}
      <div
        className="flex flex-wrap items-center justify-end gap-3 px-6 py-2"
      >
        {analyzeError && <span className="text-xs text-danger">{analyzeError}</span>}
        <label className="flex items-center gap-1.5 text-xs text-text-muted" title={t.ploidyHint}>
          {t.ploidyLabel}
          <select
            value={ploidy}
            onChange={(e) => {
              setPloidy(Number(e.target.value));
            }}
            disabled={analyzing || !sessionId}
            className="rounded-md border border-border px-1.5 py-1 text-sm bg-surface cursor-pointer"
          >
            {[2, 3, 4, 5, 6, 7, 8].map((p) => (
              <option key={p} value={p}>
                {p === 2 ? t.ploidyDiploid : `${p}x`}
              </option>
            ))}
          </select>
        </label>
        {ploidy > 2 && lowSeparation && (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-warning bg-warning/10"
            title={t.lowSeparationHint}
          >
            <AlertTriangle size={13} aria-hidden="true" /> {t.lowSeparation}
          </span>
        )}
        {/* Draggable genotype-boundary lines — only meaningful in manual mode */}
        <button
          onClick={() => {
            if (showBoundaryLines) useAnalysisStore.getState().setCurrentRequest(currentRequest);
            setShowBoundaryLines(!showBoundaryLines);
          }}
          data-testid="boundary-mode-toggle"
          disabled={!showManualTypes || !sessionId}
          title={showManualTypes ? t.boundaryLinesHint : t.boundaryLinesManualOnly}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer disabled:opacity-50 ${
            showBoundaryLines && showManualTypes
              ? "bg-primary text-white"
              : "border border-border text-text"
          }`}
        >
          <Ruler size={14} aria-hidden="true" /> {t.boundaryLines}
        </button>
        <button type="button" data-testid="analyze-recommended" onClick={handleRecommended} disabled={analyzing || !sessionId}>{t.analyzeRecommended}</button>
        <button
          data-testid="analyze-current"
          onClick={handleAnalyze}
          disabled={analyzing || !sessionId}
          title={t.analyzeHint}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary-hover disabled:opacity-60 cursor-pointer"
        >
          {analyzing ? (
            t.analyzing
          ) : (
            <>
              <Target size={14} aria-hidden="true" /> {t.analyzeButton}
            </>
          )}
        </button>
      </div>
      </div>{/* end sticky analysis toolbar */}

      {/* Group Filter Bar */}
      {(groupNames.length > 0 || hasEmptyWells) && (
        <div
          className="flex items-center gap-3 px-6 py-2 border-b border-border"
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

      {analysisWarnings.length > 0 && (
        <Callout
          tone="warning"
          className="mx-4 mt-4 sm:mx-6"
          data-testid="analysis-warnings"
        >
          <b>{t.analysisWarningsTitle}:</b>
          <ul className="mt-1 list-disc pl-4">
            {analysisWarningTexts(analysisWarnings, t).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="px-4 pt-4 sm:px-6">
        <WellSelectionToolbar />
      </div>

      {/* Shared responsive foundation defines the 1280px two-column breakpoint. */}
      <div className="analysis-grid grid gap-4 p-4 sm:px-6">
        {/* Scatter Plot - top left */}
        <ScatterPlot />

        <div className="analysis-review-stack">
          <PlateView />
          <WellDetailPanel />
        </div>
      </div>

      <div className="analysis-secondary px-4 pb-4 sm:px-6"><ResultsTable /></div>
      {/* FB-06: this stays the auxiliary, collapsed-by-default overlay for
          checking curves mid-analysis -- the Raw data (protocol) tab now
          also mounts a plate-wide one (ProtocolTab.tsx), and this one is
          NOT removed in favor of it: it's the only overlay that can take
          MultiMarkerAnalysisPanel's `ploidyOverride` for marker-scoped
          curves. Default (empty) idPrefix keeps its ids unscoped, matching
          e2e/p4-s2-analysis-tab.spec.ts's `#toggle-overlay-btn` locator. */}
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
      <p role="status" aria-live="polite">{assignmentMessage}</p>

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
