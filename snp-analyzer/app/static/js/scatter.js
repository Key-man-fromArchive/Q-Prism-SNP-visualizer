import { getAxisSettings } from "./settings.js";
import { WELL_TYPES, UNASSIGNED, getWellTypeInfo, effectiveType } from "./welltypes.js";
import { isAutoClusterVisible, isManualTypesVisible } from "./clustering.js";

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
        legend: { orientation: "h", y: -0.15 },
    });
    Plotly.newPlot("scatter-plot", [], layout, {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ["toImage", "sendDataToCloud"],
    });

    document.getElementById("scatter-plot").on("plotly_click", (data) => {
        if (data.points.length > 0) {
            const well = data.points[0].customdata;
            if (well) {
                selectedWell = well;
                highlightScatterPoint(well);
                document.dispatchEvent(new CustomEvent("well-selected", { detail: { well, source: "scatter" } }));
            }
        }
    });
}

export async function updateScatter(sessionId, cycle, useRox = true) {
    const res = await fetch(`/api/data/${sessionId}/scatter?cycle=${cycle}&use_rox=${useRox}`);
    const json = await res.json();
    currentPoints = json.points;
    allele2Dye = json.allele2_dye;

    const showAuto = isAutoClusterVisible();
    const showManual = isManualTypesVisible();

    // Group points by effective well type
    const groups = {};
    for (const p of currentPoints) {
        const type = effectiveType(p.auto_cluster, p.manual_type, showAuto, showManual) || "__unassigned__";
        if (!groups[type]) groups[type] = [];
        groups[type].push(p);
    }

    const traces = [];

    // Build a trace for each well type group
    const typeOrder = [...Object.keys(WELL_TYPES), "__unassigned__"];
    for (const type of typeOrder) {
        const pts = groups[type];
        if (!pts || pts.length === 0) continue;

        const info = type === "__unassigned__" ? UNASSIGNED : getWellTypeInfo(type);

        traces.push({
            x: pts.map(p => p.norm_fam),
            y: pts.map(p => p.norm_allele2),
            mode: "markers",
            type: "scattergl",
            name: info.label,
            customdata: pts.map(p => p.well),
            marker: {
                size: 8,
                color: info.color,
                symbol: info.symbol,
                opacity: 0.8,
                line: { width: 1, color: "#fff" },
            },
            text: pts.map(p =>
                `<b>${p.well}</b>${p.sample_name ? " (" + p.sample_name + ")" : ""}<br>` +
                `FAM: ${p.norm_fam.toFixed(4)}<br>` +
                `${allele2Dye}: ${p.norm_allele2.toFixed(4)}<br>` +
                `Raw FAM: ${p.raw_fam.toFixed(1)}<br>` +
                `Raw ${allele2Dye}: ${p.raw_allele2.toFixed(1)}` +
                (p.raw_rox != null ? `<br>Raw ROX: ${p.raw_rox.toFixed(1)}` : "") +
                (p.auto_cluster ? `<br>Auto: ${p.auto_cluster}` : "") +
                (p.manual_type ? `<br>Manual: ${p.manual_type}` : "")
            ),
            hoverinfo: "text",
            hovertemplate: "%{text}<extra></extra>",
        });
    }

    const layout = applyAxisRange({
        xaxis: { title: "Normalized FAM" },
        yaxis: { title: `Normalized ${allele2Dye}` },
        legend: { orientation: "h", y: -0.15 },
    });

    Plotly.react("scatter-plot", traces, layout);

    if (selectedWell) {
        highlightScatterPoint(selectedWell);
    }
}

export function highlightScatterPoint(well) {
    selectedWell = well;
    const plotDiv = document.getElementById("scatter-plot");
    const data = plotDiv.data;
    if (!data || data.length === 0) return;

    const updates = {};
    for (let t = 0; t < data.length; t++) {
        const trace = data[t];
        const customdata = trace.customdata || [];
        const sizes = customdata.map(w => w === well ? 14 : 8);
        const lineWidths = customdata.map(w => w === well ? 3 : 1);
        const lineColors = customdata.map(w => w === well ? "#000" : "#fff");

        Plotly.restyle("scatter-plot", {
            "marker.size": [sizes],
            "marker.line.width": [lineWidths],
            "marker.line.color": [lineColors],
        }, [t]);
    }
}

export function getPointData(well) {
    return currentPoints.find((p) => p.well === well) || null;
}

export function getAllele2Dye() {
    return allele2Dye;
}
