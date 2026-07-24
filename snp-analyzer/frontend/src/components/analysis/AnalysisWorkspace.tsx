// @TASK P4-S0/P4-S1 - Multi-marker workspace shell (플레이트 설정 / 분석)
// @SPEC docs/multi-marker-ux-decision.md §0 (2-surface workspace, free navigation)
// @TEST e2e/p4-s0-single-marker-default.spec.ts, e2e/p4-s1-plate-setup.spec.ts

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { Callout } from "@/components/shared/ui";
import { useSessionStore } from "@/stores/session-store";
import { getMarkers } from "@/lib/api";
import type { MarkerRegion } from "@/types/api";
import { AnalysisTab } from "./AnalysisTab";
import { PlateSetupTab } from "./PlateSetupTab";
import { MultiMarkerAnalysisPanel } from "./MultiMarkerAnalysisPanel";

type WorkspaceSurface = "plate" | "analysis";

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
  const [activeSurface, setActiveSurface] = useState<WorkspaceSurface>("analysis");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // The session's saved marker (assay) set decides which Analysis surface
  // renders: >=1 marker => the per-marker MultiMarkerAnalysisPanel (P4-S2),
  // 0 markers => the legacy single-marker (whole-plate) view + split banner
  // (P4-S0). Re-fetched on session change and every time this surface is
  // (re-)entered, so wells/markers assigned on the Plate Setup surface are
  // picked up without requiring a full page reload.
  const [markers, setMarkers] = useState<MarkerRegion[]>([]);

  // A freshly-loaded session starts back on the Analysis surface with the
  // banner re-offered (zero friction for the single-marker case, §0/Q1), and
  // its marker list reset (the new session hasn't been fetched yet). Computed
  // during render (React's documented "adjusting state when a prop changes"
  // pattern) rather than in an effect.
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setActiveSurface("analysis");
    setBannerDismissed(false);
    setMarkers([]);
  }

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getMarkers(sessionId);
        if (!cancelled) setMarkers(res.markers);
      } catch {
        if (!cancelled) setMarkers([]);
      }
    };
    void load();
    // A layout can also be applied to this session from the top-level
    // Library tab's "레이아웃" sub-tab -- a component outside this workspace
    // entirely, so switching back to the Analysis tab alone (without also
    // toggling the plate/analysis surface, which the effect above already
    // covers) wouldn't otherwise pick it up.
    window.addEventListener("markers-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("markers-changed", load);
    };
  }, [sessionId, activeSurface]);

  return (
    <div>
      <div
        role="tablist"
        aria-label={t.wsTabAnalysis}
        className="flex gap-1 px-6 pt-3 border-b border-border bg-surface"
      >
        <button
          type="button"
          role="tab"
          id="workspace-tab-plate"
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
        className={activeSurface === "plate" ? "" : "hidden"}
      >
        <PlateSetupTab />
      </div>

      <div
        data-testid="workspace-panel-analysis"
        className={activeSurface === "analysis" ? "" : "hidden"}
      >
        {markers.length > 0 ? (
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
