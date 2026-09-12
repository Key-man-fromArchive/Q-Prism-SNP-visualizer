// @TASK P4-S0/P4-S1/P3-S1-T1 - Multi-marker workspace shell (Plate Setup / Results)
// @SPEC docs/multi-marker-ux-decision.md §0 (2-surface workspace, free navigation)
//       docs/planning/feedback-2026-09-11/FB-07-identity-and-ia.md §3-1 (top-level Plate Setup / Results tabs)
// @TEST e2e/p4-s0-single-marker-default.spec.ts, e2e/p4-s1-plate-setup.spec.ts

import { useState, type ReactNode } from "react";
import type { MarkerRegion } from '@/types/api';
import { X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { Callout, StatusState } from "@/components/shared/ui";
import { useSessionStore } from "@/stores/session-store";
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
 * `single-marker-analysis-view`, with a non-blocking, dismissible
 * `split-marker-banner` inviting the user to split into markers via the
 * Plate Setup surface.
 */
export function AnalysisWorkspace() {
  const { t } = useI18n();
  const sessionId = useSessionStore((s) => s.sessionId);
  const activeSurface = useNavigationStore(state => state.surface);
  const setTab = useNavigationStore(state => state.setTab);
  const { ready, status, markers, markersAvailable, retry } = useAnalysisWorkspace();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // The session's saved marker (assay) set decides which Results surface
  // renders: >=1 marker => the per-marker MultiMarkerAnalysisPanel (P4-S2),
  // 0 markers => the legacy single-marker (whole-plate) view + split banner
  // (P4-S0). Re-fetched on session change and every time this surface is
  // updated through the markers-changed event, so merely switching surfaces
  // does not repeat an identical API request and analysis render.

  // A freshly-loaded session starts back on the Results surface with the
  // banner re-offered (zero friction for the single-marker case, §0/Q1), and
  // its marker list reset (the new session hasn't been fetched yet). Computed
  // during render (React's documented "adjusting state when a prop changes"
  // pattern) rather than in an effect.
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setBannerDismissed(false);
  }

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
        {ready && <div className="analysis-context-summary">
          <AnalysisResultStatus markers={availableScope(markers, markersAvailable)} />
          <PlateScopeSummary markers={availableScope(markers, markersAvailable)} />
        </div>}
        {!ready ? <StatusState variant={status === 'error' ? 'error' : 'loading'} message={status === 'error' ? t.analysisLoadFailed : t.loading} action={status === 'error' ? { label: t.retry, onClick: retry } : undefined} /> : <MarkerAvailability available={markersAvailable}>{markers.length > 0 ? (
          <MultiMarkerAnalysisPanel markers={markers} />
        ) : (
          <div data-testid="single-marker-analysis-view">
            {!bannerDismissed && (
              <Callout
                tone="warning"
                className="mx-6 mt-4"
                data-testid="split-marker-banner"
                actions={
                  <>
                    <button
                      type="button"
                      data-testid="split-marker-cta"
                      onClick={() => setTab("plate")}
                      className="px-3 py-1 rounded-md text-sm font-semibold text-primary hover:bg-bg cursor-pointer"
                    >
                      {t.wsSplitBannerCta}
                    </button>
                    <button
                      type="button"
                      data-testid="split-marker-dismiss"
                      aria-label={t.wsSplitBannerDismiss}
                      onClick={() => setBannerDismissed(true)}
                      className="px-2 py-1 rounded-md text-text-muted hover:text-text cursor-pointer inline-flex items-center"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </>
                }
              >
                {t.wsSplitBannerText}
              </Callout>
            )}
            <AnalysisTab />
          </div>
        )}</MarkerAvailability>}
      </div>
    </div>
  );
}
