let sessionId = null;
let steps = [];

// Phase colors for visualization backgrounds
const PHASE_COLORS = {
    "Pre-read":                 { bg: "rgba(59,130,246,0.12)",  border: "#3b82f6", label: "#2563eb", bgSolid: "#eff6ff" },
    "Initial Denaturation":     { bg: "rgba(239,68,68,0.10)",   border: "#ef4444", label: "#dc2626", bgSolid: "#fef2f2" },
    "Post-read":                { bg: "rgba(16,185,129,0.12)",  border: "#10b981", label: "#059669", bgSolid: "#ecfdf5" },
};
const AMP_COLORS = [
    { bg: "rgba(245,158,11,0.10)",  border: "#f59e0b", label: "#d97706", bgSolid: "#fffbeb" },
    { bg: "rgba(249,115,22,0.10)",  border: "#f97316", label: "#ea580c", bgSolid: "#fff7ed" },
    { bg: "rgba(234,88,12,0.10)",   border: "#ea580c", label: "#c2410c", bgSolid: "#fff7ed" },
    { bg: "rgba(220,38,38,0.10)",   border: "#dc2626", label: "#b91c1c", bgSolid: "#fef2f2" },
];

function getPhaseColor(phase) {
    if (PHASE_COLORS[phase]) return PHASE_COLORS[phase];
    const m = phase.match(/Amplification\s+(\d+)/);
    if (m) {
        const idx = (parseInt(m[1]) - 1) % AMP_COLORS.length;
        return AMP_COLORS[idx];
    }
    return { bg: "rgba(148,163,184,0.10)", border: "#94a3b8", label: "#64748b", bgSolid: "#f8fafc" };
}

export function initProtocol(sid) {
    sessionId = sid;
    loadProtocol();

    document.getElementById("add-step-btn").addEventListener("click", () => {
        const nextStep = steps.length + 1;
        steps.push({ step: nextStep, label: "", temperature: 55, duration_sec: 60, cycles: 1, phase: "", goto_label: "" });
        renderTable();
        renderPlot();
    });

    document.getElementById("save-protocol-btn").addEventListener("click", saveProtocol);
}

async function loadProtocol() {
    const res = await fetch(`/api/data/${sessionId}/protocol`);
    const json = await res.json();
    steps = json.steps;
    renderTable();
    renderPlot();
}

async function saveProtocol() {
    readFromTable();
    await fetch(`/api/data/${sessionId}/protocol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(steps),
    });
    renderPlot();
}

function readFromTable() {
    const tbody = document.querySelector("#protocol-table tbody");
    const dataRows = tbody.querySelectorAll("tr.step-row");
    steps = [];
    dataRows.forEach((row, i) => {
        const inputs = row.querySelectorAll("input");
        steps.push({
            step: i + 1,
            label: inputs[0].value,
            temperature: parseFloat(inputs[1].value) || 55,
            duration_sec: parseInt(inputs[2].value) || 60,
            cycles: parseInt(inputs[3].value) || 1,
            phase: row.dataset.phase || "",
            goto_label: row.dataset.gotoLabel || "",
        });
    });
}

function isReadingStep(label) {
    const l = (label || "").toLowerCase();
    return l.includes("data collection") || l.includes("pre-read") || l.includes("post-read");
}

function renderTable() {
    const tbody = document.querySelector("#protocol-table tbody");
    tbody.innerHTML = "";
    let currentPhase = null;

    steps.forEach((s, i) => {
        const phase = s.phase || "";

        if (phase && phase !== currentPhase) {
            currentPhase = phase;
            const color = getPhaseColor(phase);
            const phaseSteps = steps.filter(st => st.phase === phase);
            const maxCycles = Math.max(...phaseSteps.map(st => st.cycles || 1));
            const cycleText = maxCycles > 1 ? ` \u2014 ${maxCycles} cycles` : "";

            const headerTr = document.createElement("tr");
            headerTr.className = "phase-header-row";
            headerTr.innerHTML = `
                <td colspan="6">
                    <span class="phase-dot" style="background:${color.border}"></span>
                    <span class="phase-name" style="color:${color.label}">${phase}${cycleText}</span>
                </td>
            `;
            tbody.appendChild(headerTr);
        }

        const tr = document.createElement("tr");
        tr.className = "step-row";
        tr.dataset.phase = phase;
        tr.dataset.gotoLabel = s.goto_label || "";
        if (phase) {
            const color = getPhaseColor(phase);
            tr.style.borderLeft = `3px solid ${color.border}`;
        }
        const readIcon = isReadingStep(s.label) ? '<span class="read-icon" title="Reading point">&#128247;</span>' : '';
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td><div class="label-cell"><input type="text" value="${s.label}">${readIcon}</div></td>
            <td><input type="number" value="${s.temperature}" step="0.5" min="0" max="100"></td>
            <td><input type="number" value="${s.duration_sec}" min="1"></td>
            <td><input type="number" value="${s.cycles}" min="1"></td>
            <td><button class="del-btn" title="Delete">&times;</button></td>
        `;
        tr.querySelector(".del-btn").addEventListener("click", () => {
            steps.splice(i, 1);
            renderTable();
            renderPlot();
        });
        tr.querySelectorAll("input").forEach((inp) => {
            inp.addEventListener("change", () => {
                readFromTable();
                renderPlot();
            });
        });
        tbody.appendChild(tr);

        if (s.goto_label) {
            const gotoTr = document.createElement("tr");
            gotoTr.className = "goto-row";
            if (phase) {
                const color = getPhaseColor(phase);
                gotoTr.style.borderLeft = `3px solid ${color.border}`;
            }
            gotoTr.innerHTML = `<td colspan="6" class="goto-cell">${s.goto_label}</td>`;
            tbody.appendChild(gotoTr);
        }
    });
}

function renderPlot() {
    const x = [];
    const y = [];
    let t = 0;

    // Track phase ranges for backgrounds
    const phaseRanges = [];
    let currentPhase = null;
    let phaseStart = 0;

    // Track reading steps: one marker per step (not per cycle)
    // {x: midpoint_sec, y: temperature}
    const readMarkers = [];

    // Track GOTO info for each phase: {phase, cycles, startSec, endSec}
    const gotoInfos = [];

    for (const s of steps) {
        const phase = s.phase || "";
        const isRead = isReadingStep(s.label);

        // Phase transitions
        if (phase !== currentPhase) {
            if (currentPhase) {
                phaseRanges.push({ phase: currentPhase, start: phaseStart, end: t });
            }
            currentPhase = phase;
            phaseStart = t;
        }

        const stepStartT = t;
        for (let c = 0; c < s.cycles; c++) {
            x.push(t);
            y.push(s.temperature);
            t += s.duration_sec;
            x.push(t);
            y.push(s.temperature);
        }

        // One reading marker per step (at the midpoint of entire step duration)
        if (isRead) {
            const midT = (stepStartT + t) / 2;
            readMarkers.push({ x: midT, y: s.temperature });
        }

        // Collect GOTO info from the last step in each cycling group
        if (s.goto_label && s.cycles > 1) {
            gotoInfos.push({
                phase,
                cycles: s.cycles,
                label: s.goto_label,
            });
        }
    }
    if (currentPhase) {
        phaseRanges.push({ phase: currentPhase, start: phaseStart, end: t });
    }

    const xMin = x.map(v => v / 60);
    const totalSec = t;

    // --- Render HTML phase bar ---
    renderPhaseBar(phaseRanges, totalSec);

    // --- Build Plotly traces ---
    const traces = [{
        x: xMin,
        y,
        mode: "lines",
        line: { color: "#dc2626", width: 2.5 },
        fill: "tozeroy",
        fillcolor: "rgba(220,38,38,0.04)",
        name: "Temperature",
        hovertemplate: "%{y:.0f}\u00B0C<extra></extra>",
    }];

    // Single reading marker per read step
    if (readMarkers.length > 0) {
        traces.push({
            x: readMarkers.map(m => m.x / 60),
            y: readMarkers.map(m => m.y),
            mode: "markers",
            marker: { symbol: "star", size: 14, color: "#f59e0b", line: { width: 1.5, color: "#d97706" } },
            name: "Reading",
            hovertemplate: "Reading @ %{y:.0f}\u00B0C<extra></extra>",
        });
    }

    // Phase background shapes
    const shapes = [];
    const annotations = [];

    for (const pr of phaseRanges) {
        if (!pr.phase) continue;
        const color = getPhaseColor(pr.phase);
        const x0 = pr.start / 60;
        const x1 = pr.end / 60;

        // Background rect
        shapes.push({
            type: "rect",
            xref: "x", yref: "paper",
            x0, x1, y0: 0, y1: 1,
            fillcolor: color.bg,
            line: { width: 0 },
            layer: "below",
        });

        // Phase divider
        if (pr.start > 0) {
            shapes.push({
                type: "line",
                xref: "x", yref: "paper",
                x0, x1: x0, y0: 0, y1: 1,
                line: { color: color.border, width: 1, dash: "dot" },
                layer: "below",
            });
        }

        // GOTO annotation: cycling arrow at bottom of each cycling phase
        const gotoForPhase = gotoInfos.find(g => g.phase === pr.phase);
        if (gotoForPhase) {
            const midX = (x0 + x1) / 2;
            annotations.push({
                x: midX,
                y: 0.03,
                xref: "x",
                yref: "paper",
                text: `\u21bb \u00d7${gotoForPhase.cycles}`,
                showarrow: false,
                font: { size: 14, color: color.label, family: "sans-serif" },
                bgcolor: "rgba(255,255,255,0.85)",
                bordercolor: color.border,
                borderwidth: 1,
                borderpad: 3,
                xanchor: "center",
                yanchor: "bottom",
            });
        }
    }

    const layout = {
        xaxis: {
            title: { text: "Time (min)", font: { size: 14 }, standoff: 10 },
            tickfont: { size: 13 },
        },
        yaxis: {
            title: { text: "Temperature (\u00B0C)", font: { size: 14 }, standoff: 8 },
            tickfont: { size: 13 },
            range: [0, 105],
        },
        margin: { t: 8, r: 16, b: 56, l: 60 },
        shapes,
        annotations,
        showlegend: readMarkers.length > 0,
        legend: { x: 1, xanchor: "right", y: 1, bgcolor: "rgba(255,255,255,0.9)", font: { size: 13 } },
    };

    Plotly.react("protocol-plot", traces, layout, { responsive: true });
}

/**
 * Render the HTML phase bar above the Plotly chart.
 * Uses percentage-based widths matching the time proportions.
 */
function renderPhaseBar(phaseRanges, totalSec) {
    const bar = document.getElementById("protocol-phase-bar");
    if (!bar) return;
    bar.innerHTML = "";

    if (!phaseRanges.length || totalSec <= 0) return;

    const NARROW_PCT = 10; // below this %, use abbreviated label

    for (const pr of phaseRanges) {
        if (!pr.phase) continue;
        const color = getPhaseColor(pr.phase);
        const widthPct = (pr.end - pr.start) / totalSec * 100;
        const isNarrow = widthPct < NARROW_PCT;

        // Full label
        const shortLabel = pr.phase
            .replace("Initial Denaturation", "Init. Denat.")
            .replace("Amplification", "Amp.")
            .replace(" (Touchdown)", " (TD)")
            .replace(" (Read)", " (Read)");

        // Short abbreviation for narrow segments
        const tinyLabel = pr.phase
            .replace("Pre-read", "Pre")
            .replace("Post-read", "Post")
            .replace("Initial Denaturation", "Init.D")
            .replace(/Amplification\s+(\d+)\s*\((\w+)\)/, "Amp.$1($2)")
            .replace(/Amplification\s+(\d+)/, "Amp.$1");

        const seg = document.createElement("div");
        seg.className = "phase-bar-segment" + (isNarrow ? " narrow" : "");
        seg.style.width = `${widthPct.toFixed(2)}%`;
        seg.style.backgroundColor = color.bgSolid;
        seg.style.borderBottom = `3px solid ${color.border}`;
        seg.style.color = color.label;
        seg.title = pr.phase;
        if (isNarrow) seg.dataset.short = tinyLabel;

        const span = document.createElement("span");
        span.className = "phase-bar-label";
        span.textContent = shortLabel;
        seg.appendChild(span);

        bar.appendChild(seg);
    }
}
