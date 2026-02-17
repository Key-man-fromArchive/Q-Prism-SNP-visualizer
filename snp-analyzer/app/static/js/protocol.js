let sessionId = null;
let steps = [];

export function initProtocol(sid) {
    sessionId = sid;
    loadProtocol();

    document.getElementById("add-step-btn").addEventListener("click", () => {
        const nextStep = steps.length + 1;
        steps.push({ step: nextStep, label: "", temperature: 55, duration_sec: 60, cycles: 1 });
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
    const rows = tbody.querySelectorAll("tr");
    steps = [];
    rows.forEach((row, i) => {
        const inputs = row.querySelectorAll("input");
        steps.push({
            step: i + 1,
            label: inputs[0].value,
            temperature: parseFloat(inputs[1].value) || 55,
            duration_sec: parseInt(inputs[2].value) || 60,
            cycles: parseInt(inputs[3].value) || 1,
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
    steps.forEach((s, i) => {
        const tr = document.createElement("tr");
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
        // Update plot on input change
        tr.querySelectorAll("input").forEach((inp) => {
            inp.addEventListener("change", () => {
                readFromTable();
                renderPlot();
            });
        });
        tbody.appendChild(tr);
    });
}

function renderPlot() {
    const x = []; // time in seconds
    const y = []; // temperature
    const annotations = [];
    const readX = []; // reading point x positions (seconds)
    const readY = []; // reading point y positions
    let t = 0;

    for (const s of steps) {
        const isRead = isReadingStep(s.label);
        for (let c = 0; c < s.cycles; c++) {
            x.push(t);
            y.push(s.temperature);
            t += s.duration_sec;
            x.push(t);
            y.push(s.temperature);
            if (isRead) {
                readX.push((t - s.duration_sec / 2));
                readY.push(s.temperature);
            }
        }
        if (s.label && s.cycles > 0) {
            annotations.push({
                x: (x[x.length - 2] + x[x.length - 1]) / 2 - (s.duration_sec * s.cycles) / 2,
                y: s.temperature + 2,
                text: `${s.label}${s.cycles > 1 ? " x" + s.cycles : ""}`,
                showarrow: false,
                font: { size: 10 },
            });
        }
    }

    // Convert to minutes for readability
    const xMin = x.map((v) => v / 60);

    const traces = [{
        x: xMin,
        y,
        mode: "lines",
        line: { color: "#dc2626", width: 2 },
        fill: "tozeroy",
        fillcolor: "rgba(220,38,38,0.05)",
        name: "Temperature",
        hoverinfo: "y",
    }];

    // Add reading point markers
    if (readX.length > 0) {
        traces.push({
            x: readX.map(v => v / 60),
            y: readY,
            mode: "markers",
            marker: { symbol: "star", size: 12, color: "#f59e0b", line: { width: 1, color: "#d97706" } },
            name: "Reading",
            hovertemplate: "Reading @ %{y}\u00B0C<extra></extra>",
        });
    }

    const layout = {
        xaxis: { title: "Time (min)" },
        yaxis: { title: "Temperature (\u00B0C)", range: [0, 105] },
        margin: { t: 10, r: 10, b: 50, l: 50 },
        annotations: annotations.map((a) => ({ ...a, x: a.x / 60 })),
        showlegend: readX.length > 0,
        legend: { x: 1, xanchor: "right", y: 1, bgcolor: "rgba(255,255,255,0.8)" },
    };

    Plotly.react("protocol-plot", traces, layout, { responsive: true });
}
