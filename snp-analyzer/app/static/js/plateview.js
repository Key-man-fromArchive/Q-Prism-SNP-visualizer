let plateWells = {};
let selectedWell = null;

const ROWS = "ABCDEFGH";
const COLS = 12;

export function initPlate() {
    const grid = document.getElementById("plate-grid");
    grid.innerHTML = "";

    // Top-left empty corner
    grid.appendChild(makeLabel(""));

    // Column headers
    for (let c = 1; c <= COLS; c++) {
        grid.appendChild(makeLabel(String(c)));
    }

    // Row labels + wells
    for (let r = 0; r < ROWS.length; r++) {
        grid.appendChild(makeLabel(ROWS[r]));
        for (let c = 1; c <= COLS; c++) {
            const wellId = `${ROWS[r]}${c}`;
            const el = document.createElement("div");
            el.className = "plate-well empty";
            el.dataset.well = wellId;
            el.title = wellId;
            el.addEventListener("click", () => {
                selectedWell = wellId;
                highlightPlateWell(wellId);
                document.dispatchEvent(new CustomEvent("well-selected", { detail: { well: wellId, source: "plate" } }));
            });
            grid.appendChild(el);
        }
    }
}

function makeLabel(text) {
    const el = document.createElement("div");
    el.className = "plate-label";
    el.textContent = text;
    return el;
}

export async function updatePlate(sessionId, cycle) {
    const res = await fetch(`/api/data/${sessionId}/plate?cycle=${cycle}`);
    const json = await res.json();

    // Reset all wells
    plateWells = {};
    document.querySelectorAll(".plate-well").forEach((el) => {
        el.className = "plate-well empty";
        el.style.background = "";
    });

    for (const w of json.wells) {
        plateWells[w.well] = w;
        const el = document.querySelector(`.plate-well[data-well="${w.well}"]`);
        if (!el) continue;

        el.classList.remove("empty");
        // Color by FAM/(FAM+HEX) ratio
        const ratio = w.ratio ?? 0.5;
        const r = Math.round(220 * (1 - ratio) + 37 * ratio);
        const g = Math.round(38 * (1 - ratio) + 99 * ratio);
        const b = Math.round(38 * (1 - ratio) + 235 * ratio);
        el.style.background = `rgb(${r}, ${g}, ${b})`;
    }

    if (selectedWell) {
        highlightPlateWell(selectedWell);
    }
}

export function highlightPlateWell(well) {
    selectedWell = well;
    document.querySelectorAll(".plate-well.selected").forEach((el) => {
        el.classList.remove("selected");
    });
    const el = document.querySelector(`.plate-well[data-well="${well}"]`);
    if (el) el.classList.add("selected");
}

export function getPlateWellData(well) {
    return plateWells[well] || null;
}
