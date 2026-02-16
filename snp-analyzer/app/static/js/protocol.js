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

function renderTable() {
    const tbody = document.querySelector("#protocol-table tbody");
    tbody.innerHTML = "";
    steps.forEach((s, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td><input type="text" value="${s.label}"></td>
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
    let t = 0;

    for (const s of steps) {
        for (let c = 0; c < s.cycles; c++) {
            x.push(t);
            y.push(s.temperature);
            t += s.duration_sec;
            x.push(t);
            y.push(s.temperature);
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

    const trace = {
        x: xMin,
        y,
        mode: "lines",
        line: { color: "#dc2626", width: 2 },
        fill: "tozeroy",
        fillcolor: "rgba(220,38,38,0.05)",
    };

    const layout = {
        xaxis: { title: "Time (min)" },
        yaxis: { title: "Temperature (\u00B0C)", range: [0, 105] },
        margin: { t: 10, r: 10, b: 50, l: 50 },
        annotations: annotations.map((a) => ({ ...a, x: a.x / 60 })),
    };

    Plotly.react("protocol-plot", [trace], layout, { responsive: true });
}
