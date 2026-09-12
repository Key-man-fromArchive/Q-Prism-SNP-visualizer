import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
import { gradedAnalysisWarnings } from "@/lib/analysis-warnings";
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
  const selectedWells = useSelectionStore((s) => s.selectedWells);
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
  // P4-S3-T1 (FB-03 §3-1): "blocking" warnings bear on genotype-call
  // reliability and stay above the fold; only "advisory" ones (none exist
  // yet -- see lib/analysis-warnings.ts) are demoted below ResultsTable. The
  // toolbar badge counts and jumps to both together.
  // Small, per-render arrays (a handful of warning codes at most) -- not
  // worth memoizing against an already-unstable `?? []` reference.
  const gradedWarnings = gradedAnalysisWarnings(analysisWarnings, t);
  const blockingWarnings = gradedWarnings.filter((w) => w.severity === 'blocking');
  const advisoryWarnings = gradedWarnings.filter((w) => w.severity === 'advisory');
  const blockingWarningsRef = useRef<HTMLDivElement>(null);
  const advisoryWarningsRef = useRef<HTMLDivElement>(null);
  // Plain handler (not passed to a memoized child, so no useCallback needed).
  const jumpToWarnings = () => {
    const target = advisoryWarnings.length > 0 ? advisoryWarningsRef.current : blockingWarningsRef.current;
    target?.focus();
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

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
        {gradedWarnings.length > 0 && (
          <button
            type="button"
            data-testid="analysis-warnings-badge"
            onClick={jumpToWarnings}
            className="mr-auto inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning"
          >
            <AlertTriangle size={13} aria-hidden="true" /> {t.analysisWarningsBadge(gradedWarnings.length)}
          </button>
        )}
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
              ? "bg-primary text-on-primary"
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
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-on-primary rounded-md text-sm font-medium hover:bg-primary-hover disabled:opacity-60 cursor-pointer"
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

      {/* P4-S3-T1 (FB-03 §8): "blocking" warnings bear on genotype-call
          reliability and stay here, above the fold -- only "advisory" ones
          (none exist yet) are demoted below ResultsTable. */}
      {blockingWarnings.length > 0 && (
        <div ref={blockingWarningsRef} tabIndex={-1} aria-live="assertive">
          <Callout
            tone="warning"
            className="mx-4 mt-4 sm:mx-6"
            data-testid="analysis-warnings"
          >
            <b>{t.analysisWarningsTitle}:</b>
            <ul className="mt-1 list-disc pl-4">
              {blockingWarnings.map((w) => (
                <li key={w.code}>{w.text}</li>
              ))}
            </ul>
          </Callout>
        </div>
      )}

      {/* P4-S3-T1 followup3 (FB-03, feedback `2d1ca7ee9f444564`): this used
          to sit in its own "Group Filter Bar" directly above
          WellSelectionToolbar -- with no groups and no selection, that bar's
          only content was a "+ Group" button, stacked right on top of this
          one's "+ Add group". Both did the same thing (open a way to create
          the first manual group), so this bar's group filter/manage button
          and empty-wells toggle now render as part of WellSelectionToolbar's
          single row instead of a second one. */}
      <div className="px-4 pt-4 sm:px-6">
        <WellSelectionToolbar
          groupFilter={{ groupNames, wellGroups: wellGroups ?? {}, totalWells, onManageGroups: () => setShowGroupManager(true) }}
          emptyWellsToggle={{ hasEmptyWells, showEmptyWells, setShowEmptyWells }}
        />
      </div>

      {/* Shared responsive foundation defines the 1280px two-column breakpoint. */}
      <div className="analysis-grid grid gap-4 p-4 sm:px-6">
        {/* Scatter Plot - top left */}
        <ScatterPlot />

        <div className="analysis-review-stack">
          {/* P4-S3-T1 (FB-03 §3-2): only meaningful before anything is
              selected -- moved here from WellSelectionToolbar's always-on
              banner, as the plate view's secondary hint. */}
          {selectedWells.length === 0 && (
            <p data-testid="plate-view-hint" className="text-xs text-text-muted">{t.selectionHelp}</p>
          )}
          <PlateView />
          <WellDetailPanel />
        </div>
      </div>

      <div className="analysis-secondary px-4 pb-4 sm:px-6"><ResultsTable /></div>

      {/* P4-S3-T1 (FB-03 §3-1): "advisory" warnings are demoted below the
          results, not hidden -- aria-live keeps them announced as they
          arrive even though they are no longer above the fold. */}
      {advisoryWarnings.length > 0 && (
        <div ref={advisoryWarningsRef} tabIndex={-1} aria-live="polite" className="px-4 pb-4 sm:px-6">
          <Callout tone="warning" data-testid="analysis-warnings-advisory">
            <b>{t.analysisWarningsTitle}:</b>
            <ul className="mt-1 list-disc pl-4">
              {advisoryWarnings.map((w) => (
                <li key={w.code}>{w.text}</li>
              ))}
            </ul>
          </Callout>
        </div>
      )}
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
