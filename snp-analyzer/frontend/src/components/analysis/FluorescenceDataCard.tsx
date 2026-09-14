// @TASK P10-PROTOCOL - merged amplification curve + per-well value card
// (Raw data tab)
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
// @TEST src/components/analysis/FluorescenceDataCard.test.tsx
//
// Replaces this tab's two previous, separately-mounted cards --
// AmplificationOverlay (idPrefix="rawdata-") and WellCycleValuesTable --
// with one card that switches between a curve view and a values view over
// the SAME fetched response, SAME channel selector, SAME CSV export and
// SAME processing-status badge. Both prior cards fetched
// getAllAmplification(sessionId, useRox, backgroundMode) independently
// (i.e. twice, for identical arguments) whenever both were open; this
// component fetches it once.
//
// AmplificationOverlay.tsx itself is UNCHANGED and still mounted, at its
// default (un-prefixed) ids, on the Analysis tab -- e2e/p4-s2-analysis-tab
// .spec.ts locates it there. This card intentionally does not reuse that
// component: the Analysis tab's overlay is a single-purpose curve view
// with its own established ids/behavior, and bolting a values tab onto it
// would risk that contract. Instead this card re-implements the (much
// smaller) subset of plotting logic it needs directly.
//
// Channel selection used to be deliberately independent between the two
// prior cards (see the removed WellCycleValuesTable.tsx's header comment):
// the stated reason was "look at the FAM curve while checking allele2's
// numbers side by side". A tabbed curve/value switch cannot show both at
// once anyway, so that reason no longer applies -- sharing one selector is
// the honest choice once the two views can't be visible simultaneously.
import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout } from "plotly.js";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import { getAllAmplification } from "@/lib/api";
import { buildWellCycleValuesCsv, downloadTextFile } from "@/hooks/use-exports";
import { cycleSetsDiffer, cycleValueMap, unionCycles } from "@/lib/well-cycle-alignment";
import { channelLabels } from "@/lib/channel-labels";
import { plotlyColors } from "@/lib/plotly-theme";
import { wellInfo } from "@/lib/genotype";
import { useI18n } from "@/hooks/use-i18n";
import { useIsDarkMode } from "@/hooks/use-dark-mode";
import type { AmplificationResponse } from "@/types/api";
import { OverlayProcessingStatus } from "./AmplificationOverlay";

type ViewMode = "curve" | "values";
type ColorBy = "genotype" | "wellType" | "solid";

// Same fixed swatch as AmplificationOverlay's "solid" color-by mode (kept
// separate from the theme's --color-* tokens on purpose -- see that
// component's comment: this is a flat, call-color-free trace color, not a
// themed brand color).
const SOLID_COLOR = { light: "#2563eb", dark: "#3b82f6" };

export function FluorescenceDataCard() {
  const { t } = useI18n();
  const dark = useIsDarkMode();
  const plotRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<ViewMode>("curve");
  const [channel, setChannel] = useState<"fam" | "allele2">("fam");
  const [colorBy, setColorBy] = useState<ColorBy>("genotype");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AmplificationResponse | null>(null);

  const sessionId = useSessionStore((s) => s.sessionId);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const ploidy = useSettingsStore((s) => s.ploidy);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);

  // Fetch once, when expanded, and whenever a request-relevant setting
  // changes -- `channel`/`colorBy`/`view` are display-only picks over the
  // same response and are deliberately left out of this effect.
  useEffect(() => {
    if (!expanded || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await getAllAmplification(sessionId, useRox, backgroundMode);
        if (cancelled) return;
        setResponse(res);
      } catch (err) {
        console.error("Fluorescence data fetch error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, sessionId, useRox, backgroundMode]);

  // Render the curve plot whenever the fetched response or a display-only
  // pick changes, only while the curve tab is the one on screen.
  useEffect(() => {
    if (!expanded || view !== "curve" || !plotRef.current || !response) return;

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
      title: { text: `${t.amplificationDataTitle} — ${channelLabel}`, font: { size: 14, color: c.fontColor } },
      xaxis: { title: { text: "Cycle" }, gridcolor: c.gridColor },
      yaxis: { title: { text: `Norm. ${channelLabel} RFU` }, gridcolor: c.gridColor },
      paper_bgcolor: c.paper_bgcolor,
      plot_bgcolor: c.plot_bgcolor,
      font: { color: c.fontColor },
      margin: { t: 40, r: 10, b: 40, l: 60 },
      legend: { x: 0.01, y: 0.99, bgcolor: c.legendBg, font: { size: 11 } },
      hovermode: "closest",
    };

    Plotly.react(plotRef.current, traces, layout, { responsive: true, displayModeBar: false });
  }, [expanded, view, response, channel, colorBy, ploidy, dark, wellTypeAssignments, roleLabels, allele2Dye, t]);

  useEffect(() => {
    const plot = plotRef.current;
    return () => { if (plot) Plotly.purge(plot); };
  }, []);

  const selectorLabels = channelLabels({ channel_labels: roleLabels ?? undefined }, allele2Dye);
  const labels = channelLabels(
    response?.channel_labels ? response : { channel_labels: roleLabels ?? undefined },
    response?.allele2_dye || allele2Dye
  );
  const channelLabel = channel === "fam" ? labels.fam : labels.allele2;
  const curves = response?.curves ?? [];
  // Each curve carries its own cycles array -- wells are not guaranteed to
  // share one (see well-cycle-alignment.ts). The column set is the UNION
  // of every well's cycles, not just curves[0]'s, so no well's readings
  // are ever misaligned into another well's column.
  const cycles = unionCycles(curves);
  const cyclesDiffer = cycleSetsDiffer(curves);

  const handleExport = () => {
    if (!sessionId || curves.length === 0) return;
    const csv = buildWellCycleValuesCsv({
      curves: curves.map((c) => ({ well: c.well, cycles: c.cycles, values: channel === "fam" ? c.norm_fam : c.norm_allele2 })),
      channelLabel,
      sessionId,
      normalizationApplied: response?.normalization_applied,
      backgroundMode: response?.background_mode,
      requestedRox: useRox,
    });
    const suffix = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
    downloadTextFile(`well-cycle-values-${suffix}-${channel}.csv`, csv);
  };

  return (
    <div className="panel" data-testid="fluorescence-data-card" style={{ marginTop: "16px" }}>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-text mb-0">{t.amplificationDataTitle}</h3>
        <button
          type="button"
          id="fluorescence-toggle-btn"
          className="badge cursor-pointer text-xs min-h-11"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t.fluorescenceHide : t.fluorescenceShow}
        </button>
      </div>
      {expanded && (
        <>
          <div className="flex items-center gap-3 mb-3 flex-wrap mt-2">
            <div role="tablist" aria-label={t.fluorescenceViewTabsLabel} className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                role="tab"
                aria-selected={view === "curve"}
                data-testid="fluorescence-view-curve-tab"
                className={`px-3 py-1.5 text-xs min-h-11 ${view === "curve" ? "bg-primary text-on-primary" : "bg-surface text-text"}`}
                onClick={() => setView("curve")}
              >
                {t.fluorescenceViewCurve}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "values"}
                data-testid="fluorescence-view-values-tab"
                className={`px-3 py-1.5 text-xs min-h-11 ${view === "values" ? "bg-primary text-on-primary" : "bg-surface text-text"}`}
                onClick={() => setView("values")}
              >
                {t.fluorescenceViewValues}
              </button>
            </div>
            <select
              id="fluorescence-channel-select"
              data-testid="fluorescence-channel-select"
              className="px-2 py-0.5 border border-border rounded text-xs bg-surface text-text"
              value={channel}
              onChange={(e) => setChannel(e.target.value as "fam" | "allele2")}
            >
              <option value="fam">{selectorLabels.fam}</option>
              <option value="allele2">{selectorLabels.allele2}</option>
            </select>
            {view === "curve" && (
              <label className="flex items-center gap-1 text-xs text-text-muted">
                {t.overlayColorByLabel}
                <select
                  id="fluorescence-color-by-select"
                  data-testid="fluorescence-color-by-select"
                  className="px-2 py-0.5 border border-border rounded text-xs bg-surface text-text"
                  value={colorBy}
                  onChange={(e) => setColorBy(e.target.value as ColorBy)}
                >
                  <option value="genotype">{t.overlayColorByGenotype}</option>
                  <option value="wellType">{t.overlayColorByWellType}</option>
                  <option value="solid">{t.overlayColorBySolid}</option>
                </select>
              </label>
            )}
            <button
              type="button"
              className="badge cursor-pointer text-xs min-h-11"
              onClick={handleExport}
              disabled={curves.length === 0}
            >
              {t.wellCycleValuesExportCsv}
            </button>
            {response && (
              <OverlayProcessingStatus
                testId="fluorescence-processing-status"
                requestedRox={useRox}
                normalizationApplied={response.normalization_applied}
                normalizationMixed={response.normalization_mixed}
                backgroundMode={response.background_mode}
              />
            )}
          </div>

          {loading && <p className="text-sm text-text-muted">{t.overlayLoading}</p>}

          {/* Both views stay mounted (curve display hidden via CSS, not
              unmounted) so switching tabs doesn't re-trigger Plotly's
              layout/animation cost or lose the values table's scroll
              position -- same "hidden, not unmounted" pattern App.tsx
              already uses for tab panels. */}
          <div id="fluorescence-plot" ref={plotRef} className={view === "curve" ? "" : "hidden"} style={{ width: "100%", height: "400px" }} />

          {view === "values" && (
            !loading && curves.length === 0 ? (
              <p className="text-sm text-text-muted">{t.wellCycleValuesEmpty}</p>
            ) : curves.length > 0 && (
              <div
                data-testid="fluorescence-values-scroll-region"
                role="region"
                aria-label={t.wellCycleValuesScrollHint}
                tabIndex={0}
              >
                <p className="text-xs text-text-muted mb-2">{t.wellCycleValuesScrollHint}</p>
                {cyclesDiffer && (
                  <p className="text-xs text-warning mb-2">{t.wellCycleValuesCycleMismatchNotice}</p>
                )}
                <table data-testid="fluorescence-values-table" className="detail-table text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-text-muted pr-3 py-0.5">{t.well}</th>
                      {cycles.map((cycle) => (
                        <th key={cycle} className="text-right text-text-muted px-2 py-0.5">{cycle}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {curves.map((curve) => {
                      const values = cycleValueMap({
                        well: curve.well,
                        cycles: curve.cycles,
                        values: channel === "fam" ? curve.norm_fam : curve.norm_allele2,
                      });
                      return (
                        <tr key={curve.well}>
                          <td className="font-medium pr-3 py-0.5">{curve.well}</td>
                          {cycles.map((cycle) => {
                            const value = values.get(cycle);
                            return (
                              <td key={cycle} className="text-right px-2 py-0.5">
                                {value === undefined
                                  ? <span title={t.wellCycleValuesNoReading} aria-label={t.wellCycleValuesNoReading}>&#8212;</span>
                                  : value.toFixed(3)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
