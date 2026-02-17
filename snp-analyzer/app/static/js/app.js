import { initScatter, updateScatter, highlightScatterPoint, getPointData, getAllele2Dye } from "./scatter.js";
import { initPlate, updatePlate, highlightPlateWell } from "./plateview.js";
import { initCycleSlider, getCurrentCycle } from "./cycleslider.js";
import { initProtocol } from "./protocol.js";
import { initSettings, getUseRox } from "./settings.js";
import { loadClustering, loadManualWellTypes } from "./clustering.js";

let sessionId = null;
let sessionInfo = null;

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

    // Show session badges
    const infoEl = document.getElementById("session-info");
    infoEl.classList.remove("hidden");
    document.getElementById("instrument-badge").textContent = sessionInfo.instrument;
    document.getElementById("wells-badge").textContent = `${sessionInfo.num_wells} wells`;
    document.getElementById("cycles-badge").textContent = `${sessionInfo.num_cycles} cycles`;

    // Init components
    initScatter();
    initPlate(sessionId);
    initCycleSlider(sessionInfo.num_cycles, sessionInfo.data_windows, onCycleChange);
    initProtocol(sessionId);
    initSettings(() => onCycleChange(getCurrentCycle()), sessionId, sessionInfo);

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
        });
    });
}

async function onCycleChange(cycle) {
    if (!sessionId) return;
    const useRox = getUseRox();
    await Promise.all([
        updateScatter(sessionId, cycle, useRox),
        updatePlate(sessionId, cycle, useRox),
    ]);
}

// Listen for clustering/welltype changes -> refresh scatter + plate
document.addEventListener("clustering-changed", () => {
    if (sessionId) {
        const cycle = getCurrentCycle();
        onCycleChange(cycle);
    }
});

document.addEventListener("welltypes-changed", () => {
    if (sessionId) {
        const cycle = getCurrentCycle();
        onCycleChange(cycle);
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
