import { useRef, useEffect, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import { getAllAmplification } from "@/lib/api";

const GENOTYPE_COLORS: Record<string, string> = {
  "Allele 1 Homo": "#2563eb",
  "Allele 2 Homo": "#dc2626",
  Heterozygous: "#16a34a",
  NTC: "#9ca3af",
  Undetermined: "#f59e0b",
  Unknown: "#6b7280",
  "Positive Control": "#8b5cf6",
};

export function AmplificationOverlay() {
  const plotRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [channel, setChannel] = useState<"fam" | "allele2">("fam");
  const [loading, setLoading] = useState(false);

  const sessionId = useSessionStore((s) => s.sessionId);
  const useRox = useSettingsStore((s) => s.useRox);
  const allele2Dye = useDataStore((s) => s.allele2Dye);

  const handleToggle = async () => {
    if (visible) {
      setVisible(false);
      return;
    }
    setVisible(true);
  };

  // Fetch and render overlay when visible/channel/useRox changes
  useEffect(() => {
    if (!visible || !sessionId || !plotRef.current) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await getAllAmplification(sessionId, useRox);
        if (cancelled || !plotRef.current) return;

        const curves = res.curves;
        const traces: any[] = [];
        const legendAdded = new Set<string>();

        for (const curve of curves) {
          // Use effective_type if available (it may be on the response)
          const gt = (curve as any).effective_type || "Unknown";
          const color = GENOTYPE_COLORS[gt] || "#6b7280";
          const showLegend = !legendAdded.has(gt);
          if (showLegend) legendAdded.add(gt);

          const yValues = channel === "fam" ? curve.norm_fam : curve.norm_allele2;

          traces.push({
            x: curve.cycles,
            y: yValues,
            name: gt,
            legendgroup: gt,
            showlegend: showLegend,
            line: { color, width: 1 },
            opacity: 0.6,
            hovertemplate: `${curve.well}<br>Cycle %{x}<br>RFU %{y:.3f}<extra>${gt}</extra>`,
          });
        }

        const channelLabel = channel === "fam" ? "FAM" : (allele2Dye || "Allele2");

        const layout: any = {
          title: { text: `Amplification Overlay — ${channelLabel}`, font: { size: 14 } },
          xaxis: { title: "Cycle" },
          yaxis: { title: `Norm. ${channelLabel} RFU` },
          margin: { t: 40, r: 10, b: 40, l: 60 },
          legend: { x: 0.01, y: 0.99, bgcolor: "rgba(255,255,255,0.8)", font: { size: 11 } },
          hovermode: "closest",
        };

        Plotly.react(plotRef.current, traces, layout, {
          responsive: true,
          displayModeBar: false,
        });
      } catch (err) {
        console.error("Overlay render error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, channel, sessionId, useRox, allele2Dye]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, []);

  return (
    <div className="panel" style={{ marginTop: "16px" }}>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-text mb-0">
          Amplification Overlay
        </h3>
        <button
          id="toggle-overlay-btn"
          className="badge cursor-pointer text-xs"
          onClick={handleToggle}
        >
          {visible ? "Hide Overlay" : "Show Overlay"}
        </button>
        <select
          id="overlay-channel-select"
          className="px-2 py-0.5 border border-border rounded text-xs bg-surface text-text"
          value={channel}
          onChange={(e) => setChannel(e.target.value as "fam" | "allele2")}
        >
          <option value="fam">FAM</option>
          <option value="allele2">{allele2Dye || "Allele2"}</option>
        </select>
      </div>
      <div
        id="overlay-container"
        className={visible ? "" : "hidden"}
      >
        {loading && (
          <p className="text-sm text-text-muted">Loading overlay...</p>
        )}
        <div
          id="overlay-plot"
          ref={plotRef}
          style={{ width: "100%", height: "400px" }}
        />
      </div>
    </div>
  );
}
