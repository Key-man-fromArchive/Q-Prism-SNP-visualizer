import { getWellTypeInfo, effectiveType } from "./welltypes.js";
import { isAutoClusterVisible, isManualTypesVisible } from "./clustering.js";
import { showWellTypePopup, removePopup } from "./welltype-popup.js";

let plateWells = {};
let selectedWell = null;
let multiSelected = [];
let sessionId = null;

const ROWS = "ABCDEFGH";
const COLS = 12;

// Drag selection state
let isDragging = false;
let dragStart = null;
let dragRect = null;

export function initPlate(sid) {
    sessionId = sid;
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
            el.addEventListener("click", (e) => {
                if (e.detail === 1 && !isDragging) {
                    selectedWell = wellId;
                    highlightPlateWell(wellId);
                    document.dispatchEvent(new CustomEvent("well-selected", { detail: { well: wellId, source: "plate" } }));
                }
            });
            grid.appendChild(el);
        }
    }

    // Drag selection on plate panel
    const panel = document.querySelector(".plate-panel");
    if (panel) {
        panel.addEventListener("mousedown", onDragStart);
        document.addEventListener("mousemove", onDragMove);
        document.addEventListener("mouseup", onDragEnd);
    }
}

function makeLabel(text) {
    const el = document.createElement("div");
    el.className = "plate-label";
    el.textContent = text;
    return el;
}

function onDragStart(e) {
    // Only start drag on plate-panel background or wells
    if (e.button !== 0) return;
    const panel = document.querySelector(".plate-panel");
    const rect = panel.getBoundingClientRect();

    isDragging = false;
    dragStart = { x: e.clientX, y: e.clientY };

    // Create drag rect element
    if (!dragRect) {
        dragRect = document.createElement("div");
        dragRect.className = "drag-selection-rect";
        document.body.appendChild(dragRect);
    }
    dragRect.style.display = "none";
}

function onDragMove(e) {
    if (!dragStart) return;

    const dx = Math.abs(e.clientX - dragStart.x);
    const dy = Math.abs(e.clientY - dragStart.y);

    if (dx > 5 || dy > 5) {
        isDragging = true;
    }

    if (!isDragging) return;

    const left = Math.min(dragStart.x, e.clientX);
    const top = Math.min(dragStart.y, e.clientY);
    const width = Math.abs(e.clientX - dragStart.x);
    const height = Math.abs(e.clientY - dragStart.y);

    dragRect.style.display = "block";
    dragRect.style.left = left + "px";
    dragRect.style.top = top + "px";
    dragRect.style.width = width + "px";
    dragRect.style.height = height + "px";

    // Highlight wells within rectangle
    highlightWellsInRect(left, top, width, height);
}

function onDragEnd(e) {
    if (!dragStart) return;

    if (isDragging && dragRect) {
        const left = Math.min(dragStart.x, e.clientX);
        const top = Math.min(dragStart.y, e.clientY);
        const width = Math.abs(e.clientX - dragStart.x);
        const height = Math.abs(e.clientY - dragStart.y);

        const selected = getWellsInRect(left, top, width, height);
        multiSelected = selected;

        if (selected.length > 0) {
            showWellTypePopup(e.clientX, e.clientY, selected, sessionId, clearMultiSelection);
        }
    }

    dragRect.style.display = "none";
    dragStart = null;
    setTimeout(() => { isDragging = false; }, 10);
}

function highlightWellsInRect(left, top, width, height) {
    document.querySelectorAll(".plate-well.multi-selected").forEach(el => {
        el.classList.remove("multi-selected");
    });

    const wells = getWellsInRect(left, top, width, height);
    for (const w of wells) {
        const el = document.querySelector(`.plate-well[data-well="${w}"]`);
        if (el) el.classList.add("multi-selected");
    }
}

function getWellsInRect(left, top, width, height) {
    const rectRight = left + width;
    const rectBottom = top + height;
    const wells = [];

    document.querySelectorAll(".plate-well[data-well]").forEach(el => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        if (cx >= left && cx <= rectRight && cy >= top && cy <= rectBottom) {
            wells.push(el.dataset.well);
        }
    });

    return wells;
}

function clearMultiSelection() {
    multiSelected = [];
    document.querySelectorAll(".plate-well.multi-selected").forEach(el => {
        el.classList.remove("multi-selected");
    });
}

export async function updatePlate(sid, cycle, useRox = true) {
    sessionId = sid;
    const res = await fetch(`/api/data/${sid}/plate?cycle=${cycle}&use_rox=${useRox}`);
    const json = await res.json();

    // Reset all wells
    plateWells = {};
    document.querySelectorAll(".plate-well").forEach((el) => {
        el.className = "plate-well empty";
        el.style.background = "";
        el.style.boxShadow = "";
        // Remove cluster dots
        const dot = el.querySelector(".cluster-dot");
        if (dot) dot.remove();
    });

    const showAuto = isAutoClusterVisible();
    const showManual = isManualTypesVisible();

    for (const w of json.wells) {
        plateWells[w.well] = w;
        const el = document.querySelector(`.plate-well[data-well="${w.well}"]`);
        if (!el) continue;

        el.classList.remove("empty");

        // Use well-type color when assigned, otherwise FAM ratio gradient
        const type = effectiveType(w.auto_cluster, w.manual_type, showAuto, showManual);
        if (type) {
            const info = getWellTypeInfo(type);
            el.style.background = info.color;
        } else {
            // Fallback: ratio gradient (blue → red)
            const ratio = w.ratio ?? 0.5;
            const r = Math.round(220 * (1 - ratio) + 37 * ratio);
            const g = Math.round(38 * (1 - ratio) + 99 * ratio);
            const b = Math.round(38 * (1 - ratio) + 235 * ratio);
            el.style.background = `rgb(${r}, ${g}, ${b})`;
        }
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
