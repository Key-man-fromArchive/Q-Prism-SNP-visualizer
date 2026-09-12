import { useRef, useEffect, useState } from "react";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout } from "plotly.js";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import { getAllAmplification } from "@/lib/api";
import { channelLabels } from "@/lib/channel-labels";
import { plotlyColors } from "@/lib/plotly-theme";
import { wellInfo } from "@/lib/genotype";
import { useI18n } from "@/hooks/use-i18n";
import { useIsDarkMode } from "@/hooks/use-dark-mode";
import type { AmplificationResponse, BackgroundMode } from "@/types/api";

type ColorBy = "genotype" | "wellType" | "solid";

// "단색" is a call-color-free VIEW, not a raw-signal view: the Y values
// plotted are still norm_fam/norm_allele2 in every colorBy mode (see the
// `yValues` line below) -- normalization/background correction already
// happened server-side by the time this component sees a curve. These two
// are fixed swatches (not a theme token) purely because a single flat trace
// color needs no palette, just something visible in both modes.
const SOLID_COLOR = { light: "#2563eb", dark: "#3b82f6" };

type AmplificationOverlayProps = {
  ploidyOverride?: number;
  /** Scopes the fixed ids below (overlay-plot / overlay-container /
   *  toggle-overlay-btn / overlay-channel-select / overlay-color-by-select)
   *  so two overlays mounted at once -- the Analysis tab's (always mounted,
   *  merely `hidden` via CSS per App.tsx) and the Raw data tab's plate-wide
   *  one -- don't produce duplicate DOM ids. Left empty by default so the
   *  Analysis-tab / per-marker instances keep the exact ids
   *  e2e/p4-s2-analysis-tab.spec.ts already locates. */
  idPrefix?: string;
};

export function AmplificationOverlay({ ploidyOverride, idPrefix = "" }: AmplificationOverlayProps = {}) {
  const { t } = useI18n();
  const dark = useIsDarkMode();
  const plotRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [channel, setChannel] = useState<"fam" | "allele2">("fam");
  const [colorBy, setColorBy] = useState<ColorBy>("genotype");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AmplificationResponse | null>(null);

  const sessionId = useSessionStore((s) => s.sessionId);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const storedPloidy = useSettingsStore((s) => s.ploidy);
  const ploidy = ploidyOverride ?? storedPloidy;
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);

  const handleToggle = () => setVisible((v) => !v);

  // Fetch when the overlay opens and whenever a request-relevant setting
  // changes. `channel` and `colorBy` are display-only picks over the SAME
  // response (every curve carries norm_fam, norm_allele2 and effective_type
  // already) and are deliberately left out of this effect -- flipping either
  // re-renders the cached response below instead of re-fetching.
  useEffect(() => {
    if (!visible || !sessionId) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await getAllAmplification(sessionId, useRox, backgroundMode);
        if (cancelled) return;
        setResponse(res);
      } catch (err) {
        console.error("Overlay fetch error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, sessionId, useRox, backgroundMode]);

  // Render whenever the fetched response or a display-only pick changes.
  useEffect(() => {
    if (!visible || !plotRef.current || !response) return;

    const curves = response.curves;
    const traces: Data[] = [];
    const legendAdded = new Set<string>();
    const labels = channelLabels(
      response.channel_labels ? response : { channel_labels: roleLabels ?? undefined },
      response.allele2_dye || allele2Dye
    );
    const solidColor = dark ? SOLID_COLOR.dark : SOLID_COLOR.light;

    for (const curve of curves) {
      const yValues = channel === "fam" ? curve.norm_fam : curve.norm_allele2;

      let color: string;
      let legendLabel: string;
      let showLegend: boolean;

      if (colorBy === "solid") {
        // Colors alone, not grouping: every trace is the same flat swatch,
        // so a shared legend entry would claim a grouping that isn't there.
        color = solidColor;
        legendLabel = "";
        showLegend = false;
      } else {
        const key =
          colorBy === "genotype"
            ? curve.effective_type || "Unknown"
            : wellTypeAssignments[curve.well] || "Unknown";
        color = wellInfo(key, ploidy, dark).color;
        legendLabel = key;
        showLegend = !legendAdded.has(key);
        if (showLegend) legendAdded.add(key);
      }

      traces.push({
        x: curve.cycles,
        y: yValues,
        name: legendLabel,
        legendgroup: legendLabel || undefined,
        showlegend: showLegend,
        line: { color, width: 1 },
        opacity: 0.6,
        hovertemplate: `${curve.well}<br>Cycle %{x}<br>RFU %{y:.3f}<extra>${legendLabel}</extra>`,
      });
    }

    const channelLabel = channel === "fam" ? labels.fam : labels.allele2;

    const c = plotlyColors();
    const layout: Partial<Layout> = {
      title: { text: `Amplification Overlay — ${channelLabel}`, font: { size: 14, color: c.fontColor } },
      xaxis: { title: { text: "Cycle" }, gridcolor: c.gridColor },
      yaxis: { title: { text: `Norm. ${channelLabel} RFU` }, gridcolor: c.gridColor },
      paper_bgcolor: c.paper_bgcolor,
      plot_bgcolor: c.plot_bgcolor,
      font: { color: c.fontColor },
      margin: { t: 40, r: 10, b: 40, l: 60 },
      legend: { x: 0.01, y: 0.99, bgcolor: c.legendBg, font: { size: 11 } },
      hovermode: "closest",
    };

    Plotly.react(plotRef.current, traces, layout, {
      responsive: true,
      displayModeBar: false,
    });
  }, [visible, response, channel, colorBy, ploidy, dark, wellTypeAssignments, roleLabels, allele2Dye]);

  // Cleanup on unmount
  useEffect(() => {
    const plot = plotRef.current;
    return () => {
      if (plot) Plotly.purge(plot);
    };
  }, []);

  const selectorLabels = channelLabels(
    { channel_labels: roleLabels ?? undefined },
    allele2Dye
  );

  return (
    <div className="panel" style={{ marginTop: "16px" }}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold text-text mb-0">
          {t.amplificationOverlay}
        </h3>
        <button
          type="button"
          id={`${idPrefix}toggle-overlay-btn`}
          className="badge cursor-pointer text-xs"
          onClick={handleToggle}
        >
          {visible ? t.overlayHide : t.overlayShow}
        </button>
        <select
          id={`${idPrefix}overlay-channel-select`}
          className="px-2 py-0.5 border border-border rounded text-xs bg-surface text-text"
          value={channel}
          onChange={(e) => setChannel(e.target.value as "fam" | "allele2")}
        >
          <option value="fam">{selectorLabels.fam}</option>
          <option value="allele2">{selectorLabels.allele2}</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          {t.overlayColorByLabel}
          <select
            id={`${idPrefix}overlay-color-by-select`}
            data-testid="overlay-color-by-select"
            className="px-2 py-0.5 border border-border rounded text-xs bg-surface text-text"
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as ColorBy)}
          >
            <option value="genotype">{t.overlayColorByGenotype}</option>
            <option value="wellType">{t.overlayColorByWellType}</option>
            <option value="solid">{t.overlayColorBySolid}</option>
          </select>
        </label>
        {response && (
          <OverlayProcessingStatus
            requestedRox={useRox}
            normalizationApplied={response.normalization_applied}
            backgroundMode={response.background_mode}
          />
        )}
      </div>
      <div
        id={`${idPrefix}overlay-container`}
        className={visible ? "" : "hidden"}
      >
        {loading && (
          <p className="text-sm text-text-muted">{t.overlayLoading}</p>
        )}
        <div
          id={`${idPrefix}overlay-plot`}
          ref={plotRef}
          style={{ width: "100%", height: "400px" }}
        />
      </div>
    </div>
  );
}

/** Honest processing badge: `applied`/`backgroundMode` MUST come from the
 *  response echo (app/routers/data.py's amplification/all), never asserted
 *  from settings-store's request value -- a run with no passive reference
 *  stays raw regardless of what use_rox asked for.
 *
 *  Both fields are typed optional on `AmplificationResponse` (matching
 *  `ScatterResponse`/`PlateResponse`, for a hypothetical older backend that
 *  predates e5edefc's echo). `undefined` here means "the server didn't say" --
 *  that is NOT the same fact as "not applied", and must not silently fall
 *  back to the request value either: falling back to `useRox` is exactly the
 *  request-asserts-the-result bug this task exists to remove. So an absent
 *  echo renders a third, explicit "not reported" state instead of guessing
 *  true or false from what was asked for. */
function OverlayProcessingStatus({
  requestedRox,
  normalizationApplied,
  backgroundMode,
}: {
  requestedRox: boolean;
  normalizationApplied: boolean | undefined;
  backgroundMode: BackgroundMode | undefined;
}) {
  const { t } = useI18n();
  const reported = normalizationApplied !== undefined;
  return (
    <span
      data-testid="overlay-processing-status"
      data-requested={requestedRox}
      data-applied={reported ? String(normalizationApplied) : "unreported"}
      className="text-xs text-text-muted"
    >
      {reported
        ? t.overlayProcessingStatus(requestedRox, normalizationApplied)
        : t.overlayProcessingStatusUnreported(requestedRox)}{" "}
      {/* chartBackground() already falls back to its own "unknown" copy for
          any mode it doesn't recognize, including undefined -- reused as-is
          rather than inventing a second "not reported" string for it. */}
      {t.chartBackground(backgroundMode ?? "")}
    </span>
  );
}
