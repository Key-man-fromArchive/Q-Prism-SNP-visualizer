/**
 * Amplification Curve Overlay -- all wells on one chart, color-coded by genotype.
 */

const GENOTYPE_COLORS = {
    "Allele 1 Homo": "#2563eb",
    "Allele 2 Homo": "#dc2626",
    "Heterozygous": "#16a34a",
    "NTC": "#9ca3af",
    "Undetermined": "#f59e0b",
    "Unknown": "#6b7280",
    "Positive Control": "#8b5cf6",
};

let overlaySessionId = null;
let overlayVisible = false;

export function initOverlay(sid) {
    overlaySessionId = sid;
}

export function isOverlayVisible() {
    return overlayVisible;
}

export async function toggleOverlay(useRox = true, channel = "fam") {
    const container = document.getElementById("overlay-container");
    if (!container) return;

    overlayVisible = !overlayVisible;

    if (!overlayVisible) {
        container.classList.add("hidden");
        return;
    }

    container.classList.remove("hidden");
    await renderOverlay(useRox, channel);
}

export async function renderOverlay(useRox = true, channel = "fam") {
    if (!overlaySessionId || !overlayVisible) return;

    const container = document.getElementById("overlay-container");
    const plotDiv = document.getElementById("overlay-plot");
    if (!plotDiv) return;

    try {
        const res = await fetch(`/api/data/${overlaySessionId}/amplification/all?use_rox=${useRox}`);
        if (!res.ok) return;
        const json = await res.json();

        const allele2Dye = json.allele2_dye || "VIC";
        const curves = json.curves;

        // Group curves by genotype
        const traces = [];
        const legendAdded = new Set();

        for (const curve of curves) {
            const gt = curve.effective_type || "Unknown";
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
                line: { color: color, width: 1 },
                opacity: 0.6,
                hovertemplate: `${curve.well}<br>Cycle %{x}<br>RFU %{y:.3f}<extra>${gt}</extra>`,
            });
        }

        const channelLabel = channel === "fam" ? "FAM" : allele2Dye;

        const layout = {
            title: { text: `Amplification Overlay -- ${channelLabel}`, font: { size: 14 } },
            xaxis: { title: "Cycle" },
            yaxis: { title: `Norm. ${channelLabel} RFU` },
            margin: { t: 40, r: 10, b: 40, l: 60 },
            legend: { x: 0.01, y: 0.99, bgcolor: "rgba(255,255,255,0.8)", font: { size: 11 } },
            hovermode: "closest",
        };

        Plotly.react("overlay-plot", traces, layout, { responsive: true, displayModeBar: false });
    } catch (err) {
        console.error("Overlay render error:", err);
    }
}
