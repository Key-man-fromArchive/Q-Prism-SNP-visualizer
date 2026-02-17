import { effectiveType, getWellTypeInfo, UNASSIGNED } from "./welltypes.js";
import { isAutoClusterVisible, isManualTypesVisible } from "./clustering.js";

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COLS = Array.from({ length: 12 }, (_, i) => i + 1);

export function updateResultsTable(points) {
    const container = document.getElementById("results-plate");
    if (!container) return;

    const showAuto = isAutoClusterVisible();
    const showManual = isManualTypesVisible();

    // Build lookup: well -> point
    const lookup = {};
    for (const p of points) {
        lookup[p.well] = p;
    }

    let html = "";

    // Corner cell (empty)
    html += `<div class="plate-label"></div>`;

    // Column headers
    for (const col of COLS) {
        html += `<div class="plate-label">${col}</div>`;
    }

    // Rows
    for (const row of ROWS) {
        // Row label
        html += `<div class="plate-label">${row}</div>`;

        for (const col of COLS) {
            const well = `${row}${col}`;
            const point = lookup[well];

            if (!point) {
                html += `<div class="result-cell empty-cell" data-well="${well}">
                    <span class="well-id">${well}</span>
                </div>`;
                continue;
            }

            const type = effectiveType(point.auto_cluster, point.manual_type, showAuto, showManual);
            const info = type ? getWellTypeInfo(type) : UNASSIGNED;
            const label = type || "Unassigned";

            // Abbreviate labels for compact display
            const shortLabel = abbreviate(label);

            // Determine text color: use white for dark backgrounds, dark for light
            const textColor = isLightColor(info.color) ? "#1a1a2e" : "#ffffff";
            const bgColor = type ? info.color : "transparent";
            const borderColor = type ? info.color : "";

            const style = type
                ? `background:${bgColor};color:${textColor};border-color:${bgColor}`
                : "";

            html += `<div class="result-cell" data-well="${well}" style="${style}">
                <span class="well-id">${well}</span>
                <span class="genotype-label">${shortLabel}</span>
            </div>`;
        }
    }

    container.innerHTML = html;

    // Click handler for well selection
    container.querySelectorAll(".result-cell[data-well]").forEach(el => {
        el.addEventListener("click", () => {
            const well = el.dataset.well;
            document.dispatchEvent(new CustomEvent("well-selected", {
                detail: { well, source: "results" },
            }));
        });
    });
}

function abbreviate(label) {
    const map = {
        "Allele 1 Homo": "A1",
        "Allele 2 Homo": "A2",
        "Heterozygous": "Het",
        "NTC": "NTC",
        "Positive Control": "PC",
        "Unknown": "Unk",
        "Undetermined": "Und",
        "Unassigned": "",
    };
    return map[label] ?? label;
}

function isLightColor(hex) {
    if (!hex || hex.length < 7) return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Perceived luminance
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150;
}
