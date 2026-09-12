// @TASK P4-S0/P4-S1/P3-S1-T1 - Multi-marker workspace shell (Plate Setup / Results)
// @SPEC docs/multi-marker-ux-decision.md §0 (2-surface workspace, free navigation)
//       docs/planning/feedback-2026-09-11/FB-07-identity-and-ia.md §3-1 (top-level Plate Setup / Results tabs)
// @TEST e2e/p4-s0-single-marker-default.spec.ts, e2e/p4-s1-plate-setup.spec.ts

import { type ReactNode } from "react";
import type { MarkerRegion } from '@/types/api';
import { Plus } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { StatusState } from "@/components/shared/ui";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useAnalysisWorkspace } from "@/hooks/use-analysis-workspace";
import { useNavigationStore } from "@/stores/navigation-store";
import { AnalysisTab } from "./AnalysisTab";
import { PlateSetupTab } from "./PlateSetupTab";
import { MultiMarkerAnalysisPanel } from "./MultiMarkerAnalysisPanel";
import { AnalysisResultStatus } from './AnalysisResultStatus';
import { PlateScopeSummary } from './PlateScopeSummary';

function panelClass(active: string, surface: string): string { return active === surface ? '' : 'hidden'; }
function availableScope(markers: MarkerRegion[], available: boolean) { return available ? markers : null; }
function MarkerAvailability({ available, children }: { available: boolean; children: ReactNode }) {
  return available ? children : null;
}

/**
 * Always-present 2-surface workspace (Plate Setup + Results), mounted once a
 * session is ready. Free back-and-forth between surfaces -- never a wizard
 * gate (§0/§1 Q2).
 *
 * P3-S1-T1: this used to be reached through a single top-level "Analysis" tab
 * with its own `WorkspaceTabs` sub-navigation (Plate Setup | Analysis). Each
 * surface is now its own top-level tab (`plate` / `results`, see
 * TabNavigation.tsx) -- there is no more sub-tab hop to Plate Setup, and the
 * inner `role="tablist"` is gone. `navigation-store`'s `surface` field is kept
 * (still read by quality-navigation.ts/quality-target.ts for routing back to
 * the correct surface) but is now driven by `setTab`, so switching surfaces
 * from inside this component goes through `setTab` too, keeping the
 * top-level tab highlight and the visible surface in sync.
 *
 * S0: on load, the whole plate is auto-analysed as one marker (existing
 * `AnalysisTab` behavior, unchanged) and shown wrapped in
 * `single-marker-analysis-view`, with an always-present `analysis-scope-selector`
 * ("Whole plate" / "+ Split into markers") in place of the old dismissible
 * split-marker banner (P4-S3-T1, FB-03 §3-3) -- once >=1 marker exists, this
 * selector's spot is filled by MultiMarkerAnalysisPanel's own
 * `marker-selector-sidebar`/`marker-selector-dropdown` instead.
 */
export function AnalysisWorkspace() {
  const { t } = useI18n();
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const activeSurface = useNavigationStore(state => state.surface);
  const setTab = useNavigationStore(state => state.setTab);
  const { ready, status, markers, markersAvailable, retry } = useAnalysisWorkspace();

  // The session's saved marker (assay) set decides which Results surface
  // renders: >=1 marker => the per-marker MultiMarkerAnalysisPanel (P4-S2),
  // 0 markers => the legacy single-marker (whole-plate) view + scope
  // selector (P4-S0/P4-S3). Re-fetched on session change and every time this
  // surface is updated through the markers-changed event, so merely
  // switching surfaces does not repeat an identical API request and
  // analysis render.

  const summaryLine = t.analysisContextSummaryLine(
    currentCycle, sessionInfo?.num_cycles ?? 0, sessionInfo?.num_wells ?? 0,
    markersAvailable ? markers.length : null,
  );

  return (
    <div>
      <div
        data-testid="workspace-panel-plate"
        id="main-panel-plate" role="tabpanel" aria-labelledby="tab-plate"
        className={panelClass(activeSurface, 'plate')}
      >
        {ready && <PlateSetupTab />}
      </div>

      <div
        data-testid="workspace-panel-analysis"
        id="main-panel-results" role="tabpanel" aria-labelledby="tab-results"
        className={panelClass(activeSurface, 'analysis')}
      >
        {/* P4-S3-T1 (FB-03 §3-1): collapsed by default -- only the one-line
            summary is on by default; the full status/scope detail is a
            disclosure, not a permanent block above the results. */}
        {ready && <details className="analysis-context-summary" data-testid="analysis-context-summary">
          <summary data-testid="analysis-context-summary-line" className="cursor-pointer select-none px-6 py-2 text-xs text-text-muted">
            {summaryLine}
          </summary>
          <div className="analysis-context-summary-body">
            <AnalysisResultStatus markers={availableScope(markers, markersAvailable)} />
            <PlateScopeSummary markers={availableScope(markers, markersAvailable)} />
          </div>
        </details>}
        {!ready ? <StatusState variant={status === 'error' ? 'error' : 'loading'} message={status === 'error' ? t.analysisLoadFailed : t.loading} action={status === 'error' ? { label: t.retry, onClick: retry } : undefined} /> : <MarkerAvailability available={markersAvailable}>{markers.length > 0 ? (
          <MultiMarkerAnalysisPanel markers={markers} />
        ) : (
          <div data-testid="single-marker-analysis-view">
            {/* P4-S3-T1 (FB-03 §3-3): always-present scope selector, in the
                spot the dismissible split-marker banner used to occupy.
                Once markers exist, MultiMarkerAnalysisPanel's own
                marker-selector-sidebar/-dropdown fills this same role. */}
            <div
              data-testid="analysis-scope-selector"
              role="group"
              aria-label={t.wsScopeSelectorLabel}
              className="flex flex-wrap items-center gap-2 px-6 pt-4"
            >
              <button
                type="button"
                data-testid="scope-whole-plate"
                aria-pressed={true}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
              >
                {t.wsScopeWholePlateOption}
              </button>
              <button
                type="button"
                data-testid="scope-split-marker-cta"
                onClick={() => setTab("plate")}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-text-muted hover:border-primary hover:text-primary cursor-pointer"
              >
                <Plus size={14} aria-hidden="true" /> {t.wsSplitBannerCta}
              </button>
            </div>
            <AnalysisTab />
          </div>
        )}</MarkerAvailability>}
      </div>
    </div>
  );
}
