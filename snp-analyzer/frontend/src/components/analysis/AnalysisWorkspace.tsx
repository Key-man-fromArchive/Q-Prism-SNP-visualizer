// @TASK P4-S0/P4-S1 - Multi-marker workspace shell (플레이트 설정 / 분석)
// @SPEC docs/multi-marker-ux-decision.md §0 (2-surface workspace, free navigation)
// @TEST e2e/p4-s0-single-marker-default.spec.ts, e2e/p4-s1-plate-setup.spec.ts

import { useState } from "react";
import { navigateTabs } from '@/lib/tab-keyboard';
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

/**
 * Always-present 2-surface workspace (Plate Setup + Analysis), replacing the
 * bare `<AnalysisTab/>` mount inside the top-level "Analysis" tab. Free
 * back-and-forth between surfaces -- never a wizard gate (§0/§1 Q2).
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
  const setActiveSurface = useNavigationStore(state => state.setSurface);
  const { ready, status, markers, retry } = useAnalysisWorkspace();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // The session's saved marker (assay) set decides which Analysis surface
  // renders: >=1 marker => the per-marker MultiMarkerAnalysisPanel (P4-S2),
  // 0 markers => the legacy single-marker (whole-plate) view + split banner
  // (P4-S0). Re-fetched on session change and every time this surface is
  // updated through the markers-changed event, so merely switching surfaces
  // does not repeat an identical API request and analysis render.

  // A freshly-loaded session starts back on the Analysis surface with the
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
        role="tablist"
        onKeyDown={navigateTabs}
        aria-label={t.wsTabAnalysis}
        className="flex gap-1 px-6 pt-3 border-b border-border bg-surface"
      >
        <button
          type="button"
          role="tab"
          id="workspace-tab-plate"
          tabIndex={activeSurface === 'plate' ? 0 : -1}
          aria-controls="workspace-panel-plate"
          data-testid="workspace-tab-plate"
          aria-selected={activeSurface === "plate"}
          onClick={() => setActiveSurface("plate")}
          className={`px-4 py-2 rounded-t-md text-sm font-medium cursor-pointer ${
            activeSurface === "plate"
              ? "bg-bg text-primary border border-b-0 border-border"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t.wsTabPlate}
        </button>
        <button
          type="button"
          role="tab"
          id="workspace-tab-analysis"
          tabIndex={activeSurface === 'analysis' ? 0 : -1}
          aria-controls="workspace-panel-analysis"
          data-testid="workspace-tab-analysis"
          aria-selected={activeSurface === "analysis"}
          onClick={() => setActiveSurface("analysis")}
          className={`px-4 py-2 rounded-t-md text-sm font-medium cursor-pointer ${
            activeSurface === "analysis"
              ? "bg-bg text-primary border border-b-0 border-border"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t.wsTabAnalysis}
        </button>
      </div>

      <div
        data-testid="workspace-panel-plate"
        id="workspace-panel-plate" role="tabpanel" aria-labelledby="workspace-tab-plate"
        className={activeSurface === "plate" ? "" : "hidden"}
      >
        {ready && <PlateSetupTab />}
      </div>

      <div
        data-testid="workspace-panel-analysis"
        id="workspace-panel-analysis" role="tabpanel" aria-labelledby="workspace-tab-analysis"
        className={activeSurface === "analysis" ? "" : "hidden"}
      >
        {ready && <AnalysisResultStatus markers={markers} />}
        {!ready ? <StatusState variant={status === 'error' ? 'error' : 'loading'} message={status === 'error' ? t.analysisLoadFailed : t.loading} action={status === 'error' ? { label: t.retry, onClick: retry } : undefined} /> : markers.length > 0 ? (
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
                      onClick={() => setActiveSurface("plate")}
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
        )}
      </div>
    </div>
  );
}
