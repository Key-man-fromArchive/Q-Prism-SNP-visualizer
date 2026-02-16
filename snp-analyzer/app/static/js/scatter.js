import { getAxisSettings } from "./settings.js";

let currentPoints = [];
let selectedWell = null;
let allele2Dye = "HEX";

function applyAxisRange(layout) {
    const s = getAxisSettings();
    if (s.fixAxis) {
        layout.xaxis.range = [0, s.xMax];
        layout.yaxis.range = [0, s.yMax];
    } else {
        layout.xaxis.autorange = true;
        layout.yaxis.autorange = true;
    }
    return layout;
}

export function initScatter() {
    const layout = applyAxisRange({
        xaxis: { title: "Normalized FAM", zeroline: true },
        yaxis: { title: "Normalized HEX/VIC", zeroline: true },
        hovermode: "closest",
        margin: { t: 10, r: 10, b: 50, l: 60 },
        dragmode: "select",
    });
    Plotly.newPlot("scatter-plot", [], layout, {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ["toImage", "sendDataToCloud"],
    });

    document.getElementById("scatter-plot").on("plotly_click", (data) => {
        if (data.points.length > 0) {
            const idx = data.points[0].pointIndex;
            const well = currentPoints[idx]?.well;
            if (well) {
                selectedWell = well;
                highlightScatterPoint(well);
                document.dispatchEvent(new CustomEvent("well-selected", { detail: { well, source: "scatter" } }));
            }
        }
    });
}

export async function updateScatter(sessionId, cycle) {
    const res = await fetch(`/api/data/${sessionId}/scatter?cycle=${cycle}`);
    const json = await res.json();
    currentPoints = json.points;
    allele2Dye = json.allele2_dye;

    const x = currentPoints.map((p) => p.norm_fam);
    const y = currentPoints.map((p) => p.norm_allele2);
    const text = currentPoints.map(
        (p) =>
            `<b>${p.well}</b>${p.sample_name ? " (" + p.sample_name + ")" : ""}<br>` +
            `FAM: ${p.norm_fam.toFixed(4)}<br>` +
            `${allele2Dye}: ${p.norm_allele2.toFixed(4)}<br>` +
            `Raw FAM: ${p.raw_fam.toFixed(1)}<br>` +
            `Raw ${allele2Dye}: ${p.raw_allele2.toFixed(1)}` +
            (p.raw_rox != null ? `<br>Raw ROX: ${p.raw_rox.toFixed(1)}` : "")
    );

    const colors = currentPoints.map((p) => {
        const total = p.norm_fam + p.norm_allele2;
        if (total === 0) return "#9ca3af";
        const ratio = p.norm_fam / total;
        if (ratio > 0.6) return "#2563eb";      // FAM dominant (Allele 2)
        if (ratio < 0.4) return "#dc2626";       // HEX/VIC dominant (Allele 1)
        return "#8b5cf6";                         // Heterozygous
    });

    const trace = {
        x,
        y,
        mode: "markers",
        type: "scattergl",
        marker: {
            size: 8,
            color: colors,
            opacity: 0.8,
            line: { width: 1, color: "#fff" },
        },
        text,
        hoverinfo: "text",
        hovertemplate: "%{text}<extra></extra>",
    };

    const layout = applyAxisRange({
        xaxis: { title: "Normalized FAM" },
        yaxis: { title: `Normalized ${allele2Dye}` },
    });

    Plotly.react("scatter-plot", [trace], layout);

    if (selectedWell) {
        highlightScatterPoint(selectedWell);
    }
}

export function highlightScatterPoint(well) {
    selectedWell = well;
    const idx = currentPoints.findIndex((p) => p.well === well);
    if (idx === -1) return;

    const sizes = currentPoints.map((_, i) => (i === idx ? 14 : 8));
    const lineWidths = currentPoints.map((_, i) => (i === idx ? 3 : 1));
    const lineColors = currentPoints.map((_, i) => (i === idx ? "#000" : "#fff"));

    Plotly.restyle("scatter-plot", {
        "marker.size": [sizes],
        "marker.line.width": [lineWidths],
        "marker.line.color": [lineColors],
    });
}

export function getPointData(well) {
    return currentPoints.find((p) => p.well === well) || null;
}

export function getAllele2Dye() {
    return allele2Dye;
}
