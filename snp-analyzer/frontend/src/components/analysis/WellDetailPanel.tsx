import { useRef, useEffect, useCallback, useState } from "react";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout, Shape } from "plotly.js";
import { useSessionStore } from "@/stores/session-store";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { getAmplification } from "@/lib/api";
import { channelLabels, normalizationLabel } from "@/lib/channel-labels";
import { plotlyColors } from "@/lib/plotly-theme";
import { callLabel } from "@/lib/chart-semantics";
import type { AmplificationCurve } from "@/types/api";

type WellDetailPanelProps = { ploidyOverride?: number };

export function WellDetailPanel({ ploidyOverride }: WellDetailPanelProps = {}) {
  const { t } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  const plotInitRef = useRef(false);
  const attachPlot = useCallback((node: HTMLDivElement | null) => {
    plotRef.current = node;
    if (!node) return;
    return () => {
      if (plotInitRef.current) Plotly.purge(node);
      plotInitRef.current = false;
      plotRef.current = null;
    };
  }, []);

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const useRox = useSettingsStore((s) => s.useRox);
  const normalizationApplied = useDataStore((s) => s.normalizationApplied);
  const normalizationReported = useDataStore((s) => s.normalizationReported);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const storedPloidy = useSettingsStore((s) => s.ploidy);
  const ploidy = ploidyOverride ?? storedPloidy;
  const selectedWell = useSelectionStore((s) => s.selectedWell);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const scatterPoints = useDataStore((s) => s.scatterPoints);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  // P7-VALUES (FB-06 Q-1): the SAME curve WellDetailPanel already fetches to
  // plot (below) is now also kept in state so its full cycle series can be
  // shown as numbers, not only as a chart. No second request is made.
  const [curve, setCurve] = useState<AmplificationCurve | null>(null);

  // Find point data for selected well
  const pointData = selectedWell
    ? scatterPoints.find((p) => p.well === selectedWell) ?? null
    : null;

  const numCycles = sessionInfo?.num_cycles ?? 1;

  // Fetch and plot amplification curve when selectedWell changes
  useEffect(() => {
    if (!selectedWell || !sessionId || numCycles <= 1 || !plotRef.current) {
      if (plotRef.current && plotInitRef.current) {
        Plotly.purge(plotRef.current);
        plotInitRef.current = false;
      }
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await getAmplification(sessionId, [selectedWell], useRox, backgroundMode);
        if (cancelled || !plotRef.current) return;

        const fetchedCurve: AmplificationCurve | undefined = res.curves[0];
        if (!fetchedCurve) { setCurve(null); return; }
        setCurve(fetchedCurve);
        const labels = channelLabels(
          res.channel_labels ? res : { channel_labels: roleLabels ?? undefined },
          res.allele2_dye || allele2Dye
        );

        const traces: Data[] = [
          {
            x: fetchedCurve.cycles,
            y: fetchedCurve.norm_fam,
            name: labels.fam,
            line: { color: "#2563eb", width: 2 },
          },
          {
            x: fetchedCurve.cycles,
            y: fetchedCurve.norm_allele2,
            name: labels.allele2,
            line: { color: "#dc2626", width: 2 },
          },
        ];

        const shapes: Partial<Shape>[] = currentCycle
          ? [
              {
                type: "line",
                x0: currentCycle,
                x1: currentCycle,
                y0: 0,
                y1: 1,
                yref: "paper",
                line: { color: "#9ca3af", width: 1, dash: "dot" },
              },
            ]
          : [];

        const c = plotlyColors();
        const layout: Partial<Layout> = {
          xaxis: { title: { text: t.axisCycle }, gridcolor: c.gridColor },
          yaxis: { title: { text: t.curveReportedSignal }, gridcolor: c.gridColor },
          paper_bgcolor: c.paper_bgcolor,
          plot_bgcolor: c.plot_bgcolor,
          font: { color: c.fontColor },
          margin: { t: 5, r: 5, b: 40, l: 50 },
          legend: { x: 0, y: 1, bgcolor: c.legendBg },
          shapes,
        };

        Plotly.react(plotRef.current, traces, layout, {
          responsive: true,
          displayModeBar: false,
        });
        plotInitRef.current = true;
      } catch (err) {
        console.error("Failed to fetch amplification:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedWell, sessionId, useRox, backgroundMode, currentCycle, allele2Dye, roleLabels, numCycles, t.axisCycle, t.curveReportedSignal]);

  if (!selectedWell) {
    return (
      <div className="panel detail-panel">
        <h3 className="text-sm font-semibold mb-2 text-text">{t.wellDetails}</h3>
        <div id="detail-content">
          <p className="placeholder text-sm text-text-muted">
            {t.clickWellToSee}
          </p>
        </div>
      </div>
    );
  }

  if (!pointData) {
    return (
      <div className="panel detail-panel">
        <h3 className="text-sm font-semibold mb-2 text-text">{t.wellDetails}</h3>
        <div id="detail-content">
          <p className="text-sm text-text-muted">
            {t.noDataForWell(selectedWell)}
          </p>
        </div>
      </div>
    );
  }

  const {
    well,
    sample_name: sampleName,
    auto_cluster: autoCluster,
    manual_type: manualType,
    confidence,
    norm_fam: normFam,
    norm_allele2: normAllele2,
    raw_fam: rawFam,
    raw_allele2: rawAllele2,
    raw_rox: rawRox,
  } = pointData;

  const total = normFam + normAllele2;
  const ratio = total > 0 ? (normFam / total * 100).toFixed(1) : "N/A";

  // Prefer the actual (ploidy-aware) genotype call; the manual/auto assignment
  // already encodes dosage for any ploidy. Only fall back to a raw ratio split
  // when there is no call, and only for diploid (the 0.6/0.4 cut is biallelic).
  const effectiveCall = manualType ?? autoCluster ?? null;
  let genotype = t.genotypeUndetermined;
  if (effectiveCall) {
    if (effectiveCall === "Allele 1 Homo") genotype = t.genotypeAllele1;
    else if (effectiveCall === "Allele 2 Homo") genotype = t.genotypeAllele2(allele2Dye ?? "Allele2");
    else if (effectiveCall === "Heterozygous") genotype = t.genotypeHeterozygous;
    else genotype = callLabel(effectiveCall, t);
  } else if (ploidy === 2 && total > 0) {
    const r = normFam / total;
    if (r > 0.6) genotype = t.genotypeAllele1;
    else if (r < 0.4) genotype = t.genotypeAllele2(allele2Dye ?? "Allele2");
    else genotype = t.genotypeHeterozygous;
  }

  const decimals = normalizationApplied ? 4 : 1;
  const labels = channelLabels({ channel_labels: roleLabels ?? undefined }, allele2Dye);
  const normLabel = normalizationApplied ? ` / ${normalizationLabel(labels)}` : "";

  return (
    <div className="panel detail-panel">
      <h3 className="text-sm font-semibold mb-2 text-text">{t.wellDetails}</h3>

      <div id="detail-content">
        <table className="detail-table w-full text-sm">
          <tbody>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">{t.well}</td>
              <td className="font-medium">{well}</td>
            </tr>
              <tr>
                <td className="text-text-muted pr-3 py-0.5">{t.sample}</td>
                <td>{sampleName || '—'}</td>
              </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">{t.genotype}</td>
              <td className="font-medium">{genotype}</td>
            </tr>
              <tr>
                <td className="text-text-muted pr-3 py-0.5">{t.confidence}</td>
                <td>{confidence == null ? '—' : `${Math.round(confidence * 100)}%`}</td>
              </tr>
          </tbody>
        </table>
        <details className="well-detail-expanded">
          <summary className="cursor-pointer text-xs text-primary py-2">{t.analysisNumericDetails}</summary>
          <p className="text-xs text-text-muted" data-testid="scatter-reading-basis">{t.scatterReferenceBasis(useRox, normalizationReported, normalizationApplied)}</p>
          <table className="detail-table w-full text-sm"><tbody>
            {autoCluster && <tr><td className="text-text-muted pr-3 py-0.5">{t.autoCluster}</td><td>{callLabel(autoCluster, t)}</td></tr>}
            {manualType && <tr><td className="text-text-muted pr-3 py-0.5">{t.manualType}</td><td>{callLabel(manualType, t)}</td></tr>}
            <tr>
              <td className="text-text-muted pr-3 py-0.5">{labels.fam}{normLabel}</td>
              <td>{normFam.toFixed(decimals)}</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">
                {labels.allele2}{normLabel}
              </td>
              <td>{normAllele2.toFixed(decimals)}</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">{t.famRatio}</td>
              <td>{ratio}%</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">{labels.fam} ({t.raw})</td>
              <td>{rawFam.toFixed(1)}</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">{labels.allele2} ({t.raw})</td>
              <td>{rawAllele2.toFixed(1)}</td>
            </tr>
            {rawRox != null && (
              <tr>
                <td className="text-text-muted pr-3 py-0.5">{normalizationLabel(labels)} ({t.raw})</td>
                <td>{rawRox.toFixed(1)}</td>
              </tr>
            )}
          </tbody>
        </table>

          {/* P7-VALUES (FB-06 Q-1): the numeric table above shows the SAME
              curve's numbers -- this stays inside the numeric-details
              disclosure with the rest of the detail rows; the plot itself
              (below, outside </details>) is the panel's primary
              visualization and must not require expanding this disclosure
              to be seen (P8-E2E-DEBT). */}
          {/* curve.well === selectedWell guards against showing a stale
              series from a previous well: `curve` is only ever replaced (not
              reset) by the fetch effect above, since it must not call
              setState synchronously in the effect body's early-return
              branches (react-hooks/set-state-in-effect). */}
          {numCycles > 1 && curve && curve.well === selectedWell && (
            <div style={{ marginTop: "12px" }}>
              <p className="text-xs font-semibold text-text-muted mb-1">{t.wellTimeSeriesTitle}</p>
              <div
                data-testid="well-timeseries-scroll-region"
                role="region"
                aria-label={t.wellTimeSeriesTitle}
                tabIndex={0}
              >
                <table data-testid="well-timeseries-table" className="detail-table w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-text-muted pr-3 py-0.5">{t.axisCycle}</th>
                      <th className="text-right text-text-muted px-2 py-0.5">{labels.fam}</th>
                      <th className="text-right text-text-muted px-2 py-0.5">{labels.allele2}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {curve.cycles.map((cyc, i) => (
                      <tr
                        key={cyc}
                        className={cyc === currentCycle ? "current-cycle-row" : undefined}
                        data-current-cycle={cyc === currentCycle ? "true" : undefined}
                      >
                        <td className="pr-3 py-0.5">{cyc}</td>
                        <td className="text-right px-2 py-0.5">{curve.norm_fam[i].toFixed(decimals)}</td>
                        <td className="text-right px-2 py-0.5">{curve.norm_allele2[i].toFixed(decimals)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </details>

        {/* P8-E2E-DEBT: moved out of the disclosure above -- the curve is
            the reason a well was clicked, not a numeric detail, and must be
            visible without expanding "Detailed readings". */}
        {numCycles > 1 && (
          <>
          <p className="text-xs text-text-muted">{t.referenceBasisUnknown}</p>
          <div
            id="amplification-plot"
            ref={attachPlot}
            style={{ width: "100%", height: "200px", marginTop: "12px" }}
          />
          </>
        )}
      </div>
    </div>
  );
}
