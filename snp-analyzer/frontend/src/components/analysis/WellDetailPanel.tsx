import { useRef, useEffect } from "react";
import Plotly from "plotly.js-dist-min";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { getAmplification } from "@/lib/api";
import { plotlyColors } from "@/lib/plotly-theme";
import type { AmplificationCurve } from "@/types/api";

export function WellDetailPanel() {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotInitRef = useRef(false);

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const useRox = useSettingsStore((s) => s.useRox);
  const { selectedWell, currentCycle } = useSelectionStore();
  const scatterPoints = useDataStore((s) => s.scatterPoints);
  const allele2Dye = useDataStore((s) => s.allele2Dye);

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
        const res = await getAmplification(sessionId, [selectedWell], useRox);
        if (cancelled || !plotRef.current) return;

        const curve: AmplificationCurve | undefined = res.curves[0];
        if (!curve) return;

        const traces: any[] = [
          {
            x: curve.cycles,
            y: curve.norm_fam,
            name: "FAM",
            line: { color: "#2563eb", width: 2 },
          },
          {
            x: curve.cycles,
            y: curve.norm_allele2,
            name: allele2Dye || "Allele2",
            line: { color: "#dc2626", width: 2 },
          },
        ];

        const shapes: any[] = currentCycle
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
        const layout: any = {
          xaxis: { title: "Cycle", gridcolor: c.gridColor },
          yaxis: { title: "Norm. RFU", gridcolor: c.gridColor },
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
  }, [selectedWell, sessionId, useRox, currentCycle, allele2Dye, numCycles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (plotRef.current && plotInitRef.current) {
        Plotly.purge(plotRef.current);
      }
    };
  }, []);

  if (!selectedWell) {
    return (
      <div className="panel detail-panel">
        <h3 className="text-sm font-semibold mb-2 text-text">Well Details</h3>
        <div id="detail-content">
          <p className="placeholder text-sm text-text-muted">
            Click a well to see details
          </p>
        </div>
      </div>
    );
  }

  if (!pointData) {
    return (
      <div className="panel detail-panel">
        <h3 className="text-sm font-semibold mb-2 text-text">Well Details</h3>
        <div id="detail-content">
          <p className="text-sm text-text-muted">
            No data for well {selectedWell}
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
    norm_fam: normFam,
    norm_allele2: normAllele2,
    raw_fam: rawFam,
    raw_allele2: rawAllele2,
    raw_rox: rawRox,
  } = pointData;

  const total = normFam + normAllele2;
  const ratio = total > 0 ? (normFam / total * 100).toFixed(1) : "N/A";

  let genotype = "Undetermined";
  if (total > 0) {
    const r = normFam / total;
    if (r > 0.6) genotype = "Allele 1 (FAM)";
    else if (r < 0.4) genotype = `Allele 2 (${allele2Dye})`;
    else genotype = "Heterozygous";
  }

  const decimals = useRox ? 4 : 1;
  const normLabel = useRox ? "/ROX" : "";
  const dye = allele2Dye || "Allele2";

  return (
    <div className="panel detail-panel">
      <h3 className="text-sm font-semibold mb-2 text-text">Well Details</h3>

      <div id="detail-content">
        <table className="detail-table w-full text-sm">
          <tbody>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">Well</td>
              <td className="font-medium">{well}</td>
            </tr>
            {sampleName && (
              <tr>
                <td className="text-text-muted pr-3 py-0.5">Sample</td>
                <td>{sampleName}</td>
              </tr>
            )}
            <tr>
              <td className="text-text-muted pr-3 py-0.5">Genotype</td>
              <td className="font-medium">{genotype}</td>
            </tr>
            {autoCluster && (
              <tr>
                <td className="text-text-muted pr-3 py-0.5">Auto Cluster</td>
                <td>{autoCluster}</td>
              </tr>
            )}
            {manualType && (
              <tr>
                <td className="text-text-muted pr-3 py-0.5">Manual Type</td>
                <td>{manualType}</td>
              </tr>
            )}
            <tr>
              <td className="text-text-muted pr-3 py-0.5">FAM{normLabel}</td>
              <td>{normFam.toFixed(decimals)}</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">
                {dye}{normLabel}
              </td>
              <td>{normAllele2.toFixed(decimals)}</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">FAM ratio</td>
              <td>{ratio}%</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">FAM (raw)</td>
              <td>{rawFam.toFixed(1)}</td>
            </tr>
            <tr>
              <td className="text-text-muted pr-3 py-0.5">{dye} (raw)</td>
              <td>{rawAllele2.toFixed(1)}</td>
            </tr>
            {rawRox != null && (
              <tr>
                <td className="text-text-muted pr-3 py-0.5">ROX (raw)</td>
                <td>{rawRox.toFixed(1)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {numCycles > 1 && (
          <div
            id="amplification-plot"
            ref={plotRef}
            style={{ width: "100%", height: "200px", marginTop: "12px" }}
          />
        )}
      </div>
    </div>
  );
}
