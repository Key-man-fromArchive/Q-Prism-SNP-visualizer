import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { getAmplification } from "@/lib/api";
import { channelLabels, normalizationLabel } from "@/lib/channel-labels";
import { callLabel } from "@/lib/chart-semantics";
import { useRequestStatus } from "@/hooks/use-request-status";
import type { AmplificationCurve } from "@/types/api";

type WellDetailPanelProps = { ploidyOverride?: number };

// @TASK P12-TOGGLE - Well detail panel: numeric info + P7 time-series table
// only. The curve chart itself moved to AmplificationCurvePanel (results
// screen's large plot area, toggled against ScatterPlot) -- this component
// keeps its OWN getAmplification fetch for the P7 full-cycle table rather
// than reading AmplificationCurvePanel's response, so it stays usable (and
// unit-testable) on its own; see AmplificationCurvePanel.tsx's doc comment
// for the trade-off this makes (one duplicate GET per well selection when
// both are mounted).
export function WellDetailPanel({ ploidyOverride }: WellDetailPanelProps = {}) {
  const { t } = useI18n();
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
  // P7-VALUES (FB-06 Q-1): full cycle series shown as numbers in the
  // "Detailed readings" disclosure below. P12-PLOT-TOGGLE moved the CHART
  // itself out to AmplificationCurvePanel -- this fetch stays here (rather
  // than reading that component's response) so this table keeps working
  // wherever WellDetailPanel is mounted, including without
  // AmplificationCurvePanel alongside it. See that file's doc comment.
  //
  // P20-STALE-DATA: `curve` carries the fetchKey it was fetched FOR
  // alongside the data, so a stale response (or a stale leftover curve from
  // before a failed re-fetch) can be told apart from one that matches the
  // CURRENT well/condition -- `curve.data.well === selectedWell` alone
  // caught a well change but not a normalization/background change on the
  // same well.
  const [curve, setCurve] = useState<{ data: AmplificationCurve; key: string } | null>(null);

  // Find point data for selected well
  const pointData = selectedWell
    ? scatterPoints.find((p) => p.well === selectedWell) ?? null
    : null;

  const numCycles = sessionInfo?.num_cycles ?? 1;
  const fetchKey = JSON.stringify([sessionId, selectedWell, useRox, backgroundMode]);
  const { status, setStatus, error, setError } = useRequestStatus(fetchKey);

  // Fetch the amplification curve (for the numeric time-series table only)
  // when the selected well changes.
  useEffect(() => {
    if (!selectedWell || !sessionId || numCycles <= 1) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await getAmplification(sessionId, [selectedWell], useRox, backgroundMode);
        if (cancelled) return;
        const fetchedCurve = res.curves[0];
        if (!fetchedCurve) { setStatus('empty'); return; }
        setCurve({ data: fetchedCurve, key: fetchKey });
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        // P20-STALE-DATA: this used to be console-only, leaving whatever
        // `curve` already held on screen with no indication it might now
        // belong to a DIFFERENT normalization/background than what is
        // selected.
        console.error("Failed to fetch amplification:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedWell, sessionId, useRox, backgroundMode, numCycles, fetchKey, setStatus, setError]);

  if (!selectedWell) {
    return (
      <div className="panel detail-panel">
        <h3 className="text-sm font-semibold mb-1 text-text">{t.wellDetails}</h3>
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
        <h3 className="text-sm font-semibold mb-1 text-text">{t.wellDetails}</h3>
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
      <h3 className="text-sm font-semibold mb-1 text-text">{t.wellDetails}</h3>

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
          <summary className="cursor-pointer text-xs text-primary py-0.5">{t.analysisNumericDetails}</summary>
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

          {/* P7-VALUES (FB-06 Q-1): the numeric table shows the SAME curve's
              numbers as the AmplificationCurvePanel chart (P12-PLOT-TOGGLE
              moved that chart out of this panel entirely) -- this table
              stays inside the numeric-details disclosure with the rest of
              the detail rows, since it IS a numeric detail (the chart,
              elsewhere, is the primary visualization). */}
          {/* P20-STALE-DATA: `curve.key === fetchKey` (well + useRox +
              backgroundMode + sessionId) replaces the old `curve.well ===
              selectedWell`-only check, which caught a well change but not a
              normalization/background change on the SAME well -- a failed
              re-fetch after either used to leave the table showing the
              PREVIOUS condition's numbers with nothing marking them stale.
              A fetch failure now shows a visible error instead (role=alert,
              not console-only), and `curve` itself is never displayed
              against a `fetchKey` it was not fetched for. */}
          {numCycles > 1 && (
            status === "error" ? (
              <div style={{ marginTop: "12px" }} role="alert">
                <p className="text-xs text-danger">
                  {t.statusLoadFailed}
                  {error ? `: ${error}` : ""}
                </p>
              </div>
            ) : status === "empty" ? (
              <div style={{ marginTop: "12px" }}>
                <p className="text-xs text-text-muted">{t.noDataForWell(selectedWell)}</p>
              </div>
            ) : curve && curve.key === fetchKey && (
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
                      {curve.data.cycles.map((cyc, i) => (
                        <tr
                          key={cyc}
                          className={cyc === currentCycle ? "current-cycle-row" : undefined}
                          data-current-cycle={cyc === currentCycle ? "true" : undefined}
                        >
                          <td className="pr-3 py-0.5">{cyc}</td>
                          <td className="text-right px-2 py-0.5">{curve.data.norm_fam[i].toFixed(decimals)}</td>
                          <td className="text-right px-2 py-0.5">{curve.data.norm_allele2[i].toFixed(decimals)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </details>
      </div>
    </div>
  );
}
