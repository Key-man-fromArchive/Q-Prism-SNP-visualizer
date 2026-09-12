// @TASK P7-VALUES - "웰마다 형광값을 볼 수 있게" (FB-06 Q-1)
// @SPEC docs/planning/feedback-2026-09-11/FB-06-rawdata-tab.md#3-4
//
// AmplificationOverlay already answers "전체 웰의 형광" (curves, per plot).
// This answers the second, still-open half: a well x cycle VALUE table a
// user can actually read/scroll/copy/export, which no existing screen
// offers -- WellDetailPanel is pinned to one cycle, CSV export is one row
// per well at one analysis cycle, and the overlay's hover only shows one
// point at a time (see the task brief's three-locked-to-one-cycle table).
//
// Channel selection is deliberately INDEPENDENT of AmplificationOverlay's
// selector, not shared state: the overlay is a trend/shape view, this is a
// value-lookup view, and a user may reasonably want e.g. the FAM curve
// shape while checking allele2's numbers. Sharing would also require
// lifting AmplificationOverlay's fetch/response state up into ProtocolTab,
// entangling two independently-useful, independently-collapsible panels
// for a marginal reuse benefit. Every other per-well selection in this
// codebase (WellDetailPanel's channel display, ResultsTable's filters) is
// likewise component-local, not cross-component shared.
import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import { getAllAmplification } from "@/lib/api";
import { buildWellCycleValuesCsv, downloadTextFile } from "@/hooks/use-exports";
import { channelLabels } from "@/lib/channel-labels";
import { useI18n } from "@/hooks/use-i18n";
import type { AmplificationResponse } from "@/types/api";
import { OverlayProcessingStatus } from "./AmplificationOverlay";

export function WellCycleValuesTable() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [channel, setChannel] = useState<"fam" | "allele2">("fam");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AmplificationResponse | null>(null);

  const sessionId = useSessionStore((s) => s.sessionId);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);

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
        console.error("Well cycle values fetch error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, sessionId, useRox, backgroundMode]);

  const labels = channelLabels(
    response?.channel_labels ? response : { channel_labels: roleLabels ?? undefined },
    response?.allele2_dye || allele2Dye
  );
  const selectorLabels = channelLabels({ channel_labels: roleLabels ?? undefined }, allele2Dye);
  const channelLabel = channel === "fam" ? labels.fam : labels.allele2;

  const curves = response?.curves ?? [];
  const cycles = curves[0]?.cycles ?? [];

  const handleExport = () => {
    if (!sessionId || curves.length === 0) return;
    const csv = buildWellCycleValuesCsv({
      curves: curves.map((c) => ({ well: c.well, values: channel === "fam" ? c.norm_fam : c.norm_allele2 })),
      cycles,
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
    <div className="panel" style={{ marginTop: "16px" }}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold text-text mb-0">{t.wellCycleValuesTitle}</h3>
        <button
          type="button"
          id="well-cycle-values-toggle-btn"
          className="badge cursor-pointer text-xs"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? t.wellCycleValuesHide : t.wellCycleValuesShow}
        </button>
        <select
          id="well-cycle-values-channel-select"
          data-testid="well-cycle-values-channel-select"
          aria-label={t.wellCycleValuesChannelLabel}
          className="px-2 py-0.5 border border-border rounded text-xs bg-surface text-text"
          value={channel}
          onChange={(e) => setChannel(e.target.value as "fam" | "allele2")}
        >
          <option value="fam">{selectorLabels.fam}</option>
          <option value="allele2">{selectorLabels.allele2}</option>
        </select>
        <button
          type="button"
          className="badge cursor-pointer text-xs"
          onClick={handleExport}
          disabled={curves.length === 0}
        >
          {t.wellCycleValuesExportCsv}
        </button>
        {response && (
          <OverlayProcessingStatus
            testId="well-cycle-values-processing-status"
            requestedRox={useRox}
            normalizationApplied={response.normalization_applied}
            backgroundMode={response.background_mode}
          />
        )}
      </div>
      <div id="well-cycle-values-container" className={visible ? "" : "hidden"}>
        {loading && <p className="text-sm text-text-muted">{t.wellCycleValuesLoading}</p>}
        {!loading && curves.length === 0 && (
          <p className="text-sm text-text-muted">{t.wellCycleValuesEmpty}</p>
        )}
        {curves.length > 0 && (
          <div
            data-testid="well-cycle-values-scroll-region"
            role="region"
            aria-label={t.wellCycleValuesScrollHint}
            tabIndex={0}
          >
            <p className="text-xs text-text-muted mb-2">{t.wellCycleValuesScrollHint}</p>
            <table data-testid="well-cycle-values-table" className="detail-table text-sm">
              <thead>
                <tr>
                  <th className="text-left text-text-muted pr-3 py-0.5">{t.well}</th>
                  {cycles.map((cycle) => (
                    <th key={cycle} className="text-right text-text-muted px-2 py-0.5">
                      {cycle}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {curves.map((curve) => {
                  const values = channel === "fam" ? curve.norm_fam : curve.norm_allele2;
                  return (
                    <tr key={curve.well}>
                      <td className="font-medium pr-3 py-0.5">{curve.well}</td>
                      {values.map((value, i) => (
                        <td key={cycles[i]} className="text-right px-2 py-0.5">
                          {value.toFixed(3)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
