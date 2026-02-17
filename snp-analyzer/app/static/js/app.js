import { initScatter, updateScatter, highlightScatterPoint, getPointData, getAllele2Dye, getAllPoints } from "./scatter.js";
import { updateResultsTable } from "./results-table.js";
import { initPlate, updatePlate, highlightPlateWell } from "./plateview.js";
import { initCycleSlider, getCurrentCycle, togglePlay, setCycle } from "./cycleslider.js";
import { initProtocol } from "./protocol.js";
import { initSettings, getUseRox } from "./settings.js";
import { loadClustering, loadManualWellTypes, setManualWellTypes } from "./clustering.js";
import { initDarkMode, toggleDarkMode } from "./dark-mode.js";
import { initKeyboard } from "./keyboard.js";
import { initExportUI, downloadCSV } from "./export-ui.js";
import { initThresholdLines, toggleThresholdLines, refreshThresholdLines, isThresholdVisible } from "./threshold-lines.js";
import { initSampleEditor, enablePlateEditing } from "./sample-editor.js";
import { initQC, updateQC } from "./qc-indicators.js";
import { initCompare, refreshSessionList } from "./compare.js";
import { initCtDisplay, loadCtData, renderCtInDetail } from "./ct-display.js";
import { initOverlay, toggleOverlay, renderOverlay, isOverlayVisible } from "./amplification-overlay.js";
import { initStatistics, loadStatistics } from "./statistics.js";
import { loadPresets, applyPreset, saveCurrentAsPreset, deletePreset } from "./presets.js";
import { initUndoRedo, pushSnapshot, undo, redo, handleUndoRedoKey } from "./undo-redo.js";
import { initQuality, loadQuality, renderQualityInDetail } from "./quality.js";
import { initBatch, loadProjects } from "./batch.js";

let sessionId = null;
let sessionInfo = null;

// Init dark mode on page load
initDarkMode();

// Upload handling
const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("file-input");
const folderInput = document.getElementById("folder-input");
const browseBtn = document.getElementById("browse-btn");
const browseFolderBtn = document.getElementById("browse-folder-btn");

browseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
});

browseFolderBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    folderInput.click();
});

dropArea.addEventListener("click", () => fileInput.click());

dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.classList.add("dragover");
});

dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragover"));

dropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dropArea.classList.remove("dragover");
    const items = e.dataTransfer.items;
    if (!items || !items.length) return;

    // Check if any item is a directory (folder drop)
    const entries = [];
    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
    }

    if (entries.length > 0 && entries.some(e => e.isDirectory)) {
        readDroppedEntries(entries).then(files => handleMultipleFiles(files));
    } else if (e.dataTransfer.files.length > 1) {
        handleMultipleFiles(Array.from(e.dataTransfer.files));
    } else if (e.dataTransfer.files.length === 1) {
        const file = e.dataTransfer.files[0];
        if (file.name.toLowerCase().endsWith(".xml")) {
            handleMultipleFiles([file]);
        } else {
            uploadFile(file);
        }
    }
});

fileInput.addEventListener("change", () => {
    if (!fileInput.files.length) return;
    const files = Array.from(fileInput.files);
    const xmlFiles = files.filter(f => f.name.toLowerCase().endsWith(".xml"));

    if (xmlFiles.length > 0 && files.length > 1) {
        handleMultipleFiles(files);
    } else if (xmlFiles.length === 1 && files.length === 1) {
        handleMultipleFiles(files);
    } else if (files.length === 1) {
        uploadFile(files[0]);
    } else {
        handleMultipleFiles(files);
    }
    fileInput.value = "";
});

folderInput.addEventListener("change", () => {
    if (folderInput.files.length) {
        handleMultipleFiles(Array.from(folderInput.files));
    }
    folderInput.value = "";
});

// Recursively read files from dropped folder entries
async function readDroppedEntries(entries) {
    const files = [];

    async function readEntry(entry) {
        if (entry.isFile) {
            return new Promise((resolve) => {
                entry.file(f => { files.push(f); resolve(); });
            });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const childEntries = await new Promise((resolve) => {
                const all = [];
                (function readBatch() {
                    reader.readEntries((batch) => {
                        if (batch.length === 0) { resolve(all); return; }
                        all.push(...batch);
                        readBatch();
                    });
                })();
            });
            for (const child of childEntries) {
                await readEntry(child);
            }
        }
    }

    for (const entry of entries) {
        await readEntry(entry);
    }
    return files;
}

// Handle multiple files: filter to .xml, zip them, upload
async function handleMultipleFiles(files) {
    const progress = document.getElementById("upload-progress");
    const statusEl = document.getElementById("upload-status");
    const fillEl = document.querySelector(".progress-fill");

    progress.classList.remove("hidden");
    statusEl.textContent = "Checking files...";
    fillEl.style.width = "10%";

    const xmlFiles = files.filter(f => f.name.toLowerCase().endsWith(".xml"));

    // If no XML files but exactly 1 other file, use single upload
    if (xmlFiles.length === 0) {
        const nonXml = files.filter(f => !f.name.toLowerCase().endsWith(".xml"));
        if (nonXml.length === 1) {
            uploadFile(nonXml[0]);
            return;
        }
        statusEl.textContent = "Error: No .xml files found";
        fillEl.style.width = "0%";
        return;
    }

    statusEl.textContent = `Packaging ${xmlFiles.length} XML file${xmlFiles.length > 1 ? "s" : ""}...`;
    fillEl.style.width = "20%";

    try {
        const zip = new JSZip();
        for (const file of xmlFiles) {
            const data = await file.arrayBuffer();
            zip.file(file.name, data);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        const zipFile = new File([blob], "cfx_xml_export.zip", { type: "application/zip" });

        fillEl.style.width = "40%";
        statusEl.textContent = "Uploading...";

        await uploadFile(zipFile, true);
    } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        fillEl.style.width = "0%";
    }
}

async function uploadFile(file, skipProgressInit = false) {
    const progress = document.getElementById("upload-progress");
    const statusEl = document.getElementById("upload-status");
    const fillEl = document.querySelector(".progress-fill");

    if (!skipProgressInit) {
        progress.classList.remove("hidden");
        statusEl.textContent = "Uploading...";
        fillEl.style.width = "30%";
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        fillEl.style.width = "70%";

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Upload failed");
        }

        sessionInfo = await res.json();
        sessionId = sessionInfo.session_id;
        fillEl.style.width = "100%";
        statusEl.textContent = `Parsed: ${sessionInfo.instrument} | ${sessionInfo.num_wells} wells | ${sessionInfo.num_cycles} cycles`;

        setTimeout(() => initAnalysis(), 500);
    } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        fillEl.style.width = "0%";
    }
}

function initAnalysis() {
    // Hide upload, show analysis
    document.getElementById("upload-zone").classList.add("hidden");
    document.getElementById("analysis-panel").classList.remove("hidden");

    // Show session badges + export buttons
    const infoEl = document.getElementById("session-info");
    infoEl.classList.remove("hidden");
    document.getElementById("instrument-badge").textContent = sessionInfo.instrument;
    document.getElementById("wells-badge").textContent = `${sessionInfo.num_wells} wells`;
    document.getElementById("cycles-badge").textContent = `${sessionInfo.num_cycles} cycles`;
    const exportBtns = document.getElementById("export-buttons");
    if (exportBtns) exportBtns.classList.remove("hidden");

    // Init core components
    initScatter(sessionId);
    initPlate(sessionId);
    initCycleSlider(sessionInfo.num_cycles, sessionInfo.data_windows, onCycleChange);
    initProtocol(sessionId);
    initSettings(() => onCycleChange(getCurrentCycle()), sessionId, sessionInfo);

    // Init new modules
    initExportUI(sessionId);
    initThresholdLines();
    initSampleEditor(sessionId);
    initQC(sessionId);
    initCtDisplay(sessionId);
    loadCtData(getUseRox());
    initCompare();
    initBatch();
    initStatistics(sessionId);

    const refreshStatsBtn = document.getElementById("refresh-stats-btn");
    if (refreshStatsBtn) {
        refreshStatsBtn.addEventListener("click", () => loadStatistics());
    }

    // Presets
    loadPresets();

    const applyPresetBtn = document.getElementById("apply-preset-btn");
    if (applyPresetBtn) {
        applyPresetBtn.addEventListener("click", () => {
            const select = document.getElementById("preset-select");
            if (select?.value) applyPreset(select.value);
        });
    }

    const savePresetBtn = document.getElementById("save-preset-btn");
    if (savePresetBtn) {
        savePresetBtn.addEventListener("click", async () => {
            const nameInput = document.getElementById("preset-name-input");
            const name = nameInput?.value?.trim();
            if (!name) { alert("Enter a preset name"); return; }
            const ok = await saveCurrentAsPreset(name);
            if (ok) nameInput.value = "";
        });
    }

    const deletePresetBtn = document.getElementById("delete-preset-btn");
    if (deletePresetBtn) {
        deletePresetBtn.addEventListener("click", async () => {
            const select = document.getElementById("preset-select");
            if (select?.value) {
                await deletePreset(select.value);
            }
        });
    }

    // Undo/Redo
    initUndoRedo(sessionId);
    document.getElementById("undo-redo-buttons")?.classList.remove("hidden");
    document.getElementById("undo-btn")?.addEventListener("click", () => undo());
    document.getElementById("redo-btn")?.addEventListener("click", () => redo());
    document.addEventListener("keydown", handleUndoRedoKey);

    // Quality scoring
    initQuality(sessionId);
    document.getElementById("refresh-quality-btn")?.addEventListener("click", () => loadQuality(getUseRox()));

    // Amplification Overlay
    initOverlay(sessionId);

    const overlayBtn = document.getElementById("toggle-overlay-btn");
    const overlayChannelSel = document.getElementById("overlay-channel-select");
    if (overlayBtn) {
        overlayBtn.addEventListener("click", async () => {
            const useRox = getUseRox();
            const channel = overlayChannelSel?.value || "fam";
            await toggleOverlay(useRox, channel);
            overlayBtn.textContent = isOverlayVisible() ? "Hide Overlay" : "Show Overlay";
        });
    }
    if (overlayChannelSel) {
        overlayChannelSel.addEventListener("change", async () => {
            if (isOverlayVisible()) {
                await renderOverlay(getUseRox(), overlayChannelSel.value);
            }
        });
    }

    // Enable double-click sample editing on plate wells
    setTimeout(() => enablePlateEditing(), 100);

    // Keyboard shortcuts
    initKeyboard({
        togglePlay: () => togglePlay(),
        prevCycle: () => setCycle(-1),
        nextCycle: () => setCycle(1),
        exportCSV: () => downloadCSV(),
        toggleDarkMode: () => toggleDarkMode(),
        assignWellType: (type) => {
            // Get currently selected well from scatter or plate
            const selected = document.querySelector(".plate-well.selected");
            if (selected) {
                const well = selected.dataset.well;
                setManualWellTypes(sessionId, [well], type);
            }
        },
    });

    // Threshold lines toggle button
    const threshBtn = document.getElementById("toggle-threshold-lines-btn");
    if (threshBtn) {
        threshBtn.addEventListener("click", () => {
            const settings = {
                ntcThreshold: parseFloat(document.getElementById("ntc-threshold")?.value) || 0.1,
                allele1RatioMax: parseFloat(document.getElementById("allele1-ratio-max")?.value) || 0.4,
                allele2RatioMin: parseFloat(document.getElementById("allele2-ratio-min")?.value) || 0.6,
            };
            toggleThresholdLines(settings);
            threshBtn.textContent = isThresholdVisible() ? "Hide Threshold Lines" : "Show Threshold Lines";
        });
    }

    // PDF export button
    const pdfBtn = document.getElementById("export-pdf-btn");
    if (pdfBtn) {
        pdfBtn.addEventListener("click", async () => {
            pdfBtn.disabled = true;
            pdfBtn.textContent = "...";
            try {
                const useRox = getUseRox();
                const res = await fetch(`/api/data/${sessionId}/export/pdf?use_rox=${useRox}`);
                if (!res.ok) throw new Error("PDF generation failed");
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `snp_report_${sessionId}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                alert("PDF export failed: " + err.message);
            } finally {
                pdfBtn.disabled = false;
                pdfBtn.textContent = "PDF";
            }
        });
    }

    // Load existing clustering/welltype state
    loadClustering(sessionId);
    loadManualWellTypes(sessionId);

    // Tab switching
    document.querySelectorAll(".tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach((tc) => tc.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
            // Refresh session list when Compare tab is activated
            if (tab.dataset.tab === "compare") {
                refreshSessionList();
            }
            if (tab.dataset.tab === "quality") {
                loadQuality(getUseRox());
            }
            if (tab.dataset.tab === "statistics") {
                loadStatistics();
            }
            if (tab.dataset.tab === "batch") {
                loadProjects();
            }
        });
    });

    // New Upload button — show upload zone again without losing current session
    const newUploadBtn = document.getElementById("new-upload-btn");
    if (newUploadBtn) {
        newUploadBtn.addEventListener("click", () => {
            document.getElementById("upload-zone").classList.remove("hidden");
            document.getElementById("analysis-panel").classList.add("hidden");
            // Reset file input and progress
            document.getElementById("file-input").value = "";
            const progress = document.getElementById("upload-progress");
            if (progress) progress.classList.add("hidden");
        });
    }
}

async function onCycleChange(cycle) {
    if (!sessionId) return;
    const useRox = getUseRox();
    await Promise.all([
        updateScatter(sessionId, cycle, useRox),
        updatePlate(sessionId, cycle, useRox),
    ]);
    updateResultsTable(getAllPoints());
    refreshThresholdLines();
    updateQC(cycle, useRox);
    loadCtData(useRox);
}

// Listen for clustering/welltype changes -> refresh scatter + plate
document.addEventListener("clustering-changed", () => {
    if (sessionId) {
        const cycle = getCurrentCycle();
        onCycleChange(cycle);
    }
});

document.addEventListener("welltypes-changed", async () => {
    if (sessionId) {
        const cycle = getCurrentCycle();
        onCycleChange(cycle);
        // Push undo snapshot
        try {
            const res = await fetch(`/api/data/${sessionId}/welltypes`);
            if (res.ok) {
                const data = await res.json();
                pushSnapshot(data.assignments || {});
            }
        } catch { /* ignore */ }
    }
});

// Bidirectional well selection
document.addEventListener("well-selected", async (e) => {
    const { well, source } = e.detail;

    if (source !== "scatter") highlightScatterPoint(well);
    if (source !== "plate") highlightPlateWell(well);

    // Update detail panel
    updateDetailPanel(well);

    // Load amplification curve
    await loadAmplificationCurve(well);
});

function updateDetailPanel(well) {
    const content = document.getElementById("detail-content");
    const point = getPointData(well);
    const dye = getAllele2Dye();

    if (!point) {
        content.innerHTML = `<p class="placeholder">No data for ${well}</p>`;
        return;
    }

    const total = point.norm_fam + point.norm_allele2;
    const ratio = total > 0 ? (point.norm_fam / total * 100).toFixed(1) : "N/A";

    let genotype = "Undetermined";
    if (total > 0) {
        const r = point.norm_fam / total;
        if (r > 0.6) genotype = "Allele 2 (FAM)";
        else if (r < 0.4) genotype = `Allele 1 (${dye})`;
        else genotype = "Heterozygous";
    }

    content.innerHTML = `
        <table class="detail-table">
            <tr><td>Well</td><td><b>${well}</b></td></tr>
            ${point.sample_name ? `<tr><td>Sample</td><td>${point.sample_name}</td></tr>` : ""}
            <tr><td>Genotype</td><td>${genotype}</td></tr>
            ${point.auto_cluster ? `<tr><td>Auto Cluster</td><td>${point.auto_cluster}</td></tr>` : ""}
            ${point.manual_type ? `<tr><td>Manual Type</td><td>${point.manual_type}</td></tr>` : ""}
            <tr><td>FAM (norm)</td><td>${point.norm_fam.toFixed(4)}</td></tr>
            <tr><td>${dye} (norm)</td><td>${point.norm_allele2.toFixed(4)}</td></tr>
            <tr><td>FAM ratio</td><td>${ratio}%</td></tr>
            <tr><td>FAM (raw)</td><td>${point.raw_fam.toFixed(1)}</td></tr>
            <tr><td>${dye} (raw)</td><td>${point.raw_allele2.toFixed(1)}</td></tr>
            ${point.raw_rox != null ? `<tr><td>ROX (raw)</td><td>${point.raw_rox.toFixed(1)}</td></tr>` : ""}
            ${renderCtInDetail(well, dye)}
            ${renderQualityInDetail(well)}
        </table>
    `;
}

async function loadAmplificationCurve(well) {
    const plotDiv = document.getElementById("amplification-plot");

    if (sessionInfo.num_cycles <= 1) {
        plotDiv.classList.add("hidden");
        return;
    }

    plotDiv.classList.remove("hidden");
    const dye = getAllele2Dye();

    const useRox = getUseRox();
    const res = await fetch(`/api/data/${sessionId}/amplification?wells=${well}&use_rox=${useRox}`);
    const json = await res.json();

    if (!json.curves.length) {
        plotDiv.classList.add("hidden");
        return;
    }

    const curve = json.curves[0];
    const traces = [
        {
            x: curve.cycles,
            y: curve.norm_fam,
            name: "FAM",
            line: { color: "#2563eb", width: 2 },
        },
        {
            x: curve.cycles,
            y: curve.norm_allele2,
            name: dye,
            line: { color: "#dc2626", width: 2 },
        },
    ];

    // Add vertical line at current cycle
    const currentCycle = getCurrentCycle();
    const shapes = [{
        type: "line",
        x0: currentCycle, x1: currentCycle,
        y0: 0, y1: 1,
        yref: "paper",
        line: { color: "#9ca3af", width: 1, dash: "dot" },
    }];

    const layout = {
        xaxis: { title: "Cycle" },
        yaxis: { title: "Norm. RFU" },
        margin: { t: 5, r: 5, b: 40, l: 50 },
        legend: { x: 0, y: 1, bgcolor: "rgba(255,255,255,0.7)" },
        shapes,
    };

    Plotly.react("amplification-plot", traces, layout, { responsive: true, displayModeBar: false });
}
