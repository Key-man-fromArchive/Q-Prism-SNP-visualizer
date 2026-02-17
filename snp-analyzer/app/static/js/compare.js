import { getUseRox } from "./settings.js";

let sessions = [];
let currentComparison = null;

/**
 * Initialize the compare tab content structure
 * Called once after first upload
 */
export function initCompare() {
  const tabDiv = document.getElementById("tab-compare");
  if (!tabDiv) return;

  tabDiv.innerHTML = `
    <div class="compare-container">
      <div class="compare-controls">
        <div class="control-row">
          <div class="control-group">
            <label for="select-run-a">Run A:</label>
            <select id="select-run-a" class="run-select">
              <option value="">-- Select Run A --</option>
            </select>
          </div>
          <div class="control-group">
            <label for="select-run-b">Run B:</label>
            <select id="select-run-b" class="run-select">
              <option value="">-- Select Run B --</option>
            </select>
          </div>
          <button id="btn-compare" class="btn-primary" disabled>Compare</button>
        </div>
        <div id="compare-message" class="info-message"></div>
      </div>

      <div id="compare-results" class="compare-results" style="display: none;">
        <div id="compare-plot" class="plot-container"></div>

        <div class="compare-details">
          <div class="stats-panel">
            <h3>Statistics</h3>
            <table id="compare-stats-table" class="stats-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Run A</th>
                  <th>Run B</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
            <div id="correlation-stats" class="correlation-stats"></div>
          </div>

          <div class="legend-panel">
            <h3>Legend</h3>
            <div class="legend-items">
              <div class="legend-item">
                <span class="legend-marker circle" style="background: #2563eb;"></span>
                <span id="legend-run-a">Run A</span>
              </div>
              <div class="legend-item">
                <span class="legend-marker diamond" style="background: #f59e0b;"></span>
                <span id="legend-run-b">Run B</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

  `;

  // Attach event listeners
  const selectRunA = document.getElementById("select-run-a");
  const selectRunB = document.getElementById("select-run-b");
  const btnCompare = document.getElementById("btn-compare");

  selectRunA?.addEventListener("change", updateCompareButton);
  selectRunB?.addEventListener("change", updateCompareButton);
  btnCompare?.addEventListener("click", updateCompare);
}

/**
 * Fetch sessions and populate dropdowns
 */
export async function refreshSessionList() {
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.statusText}`);
    }

    sessions = await response.json();
    populateDropdowns();
    updateMessage();
  } catch (error) {
    console.error("Error refreshing session list:", error);
    showMessage("Failed to load sessions. Please refresh the page.", "error");
  }
}

/**
 * Populate Run A and Run B dropdowns with session data
 */
function populateDropdowns() {
  const selectRunA = document.getElementById("select-run-a");
  const selectRunB = document.getElementById("select-run-b");

  if (!selectRunA || !selectRunB) return;

  const currentA = selectRunA.value;
  const currentB = selectRunB.value;

  // Clear existing options except the placeholder
  selectRunA.innerHTML = '<option value="">-- Select Run A --</option>';
  selectRunB.innerHTML = '<option value="">-- Select Run B --</option>';

  sessions.forEach((session) => {
    const optionText = `${session.instrument} (${session.num_wells}w, ${session.num_cycles}c)`;
    const optionA = new Option(optionText, session.session_id);
    const optionB = new Option(optionText, session.session_id);

    selectRunA.appendChild(optionA);
    selectRunB.appendChild(optionB);
  });

  // Restore previous selections if still valid
  if (sessions.some(s => s.session_id === currentA)) {
    selectRunA.value = currentA;
  }
  if (sessions.some(s => s.session_id === currentB)) {
    selectRunB.value = currentB;
  }

  updateCompareButton();
}

/**
 * Update the info message based on available sessions
 */
function updateMessage() {
  const messageDiv = document.getElementById("compare-message");
  if (!messageDiv) return;

  if (sessions.length < 2) {
    showMessage("Upload at least 2 files to compare runs", "warning");
  } else {
    messageDiv.innerHTML = "";
    messageDiv.className = "info-message";
  }
}

/**
 * Display a message to the user
 */
function showMessage(text, type = "info") {
  const messageDiv = document.getElementById("compare-message");
  if (!messageDiv) return;

  messageDiv.textContent = text;
  messageDiv.className = `info-message ${type}`;
}

/**
 * Enable/disable compare button based on dropdown selections
 */
function updateCompareButton() {
  const selectRunA = document.getElementById("select-run-a");
  const selectRunB = document.getElementById("select-run-b");
  const btnCompare = document.getElementById("btn-compare");

  if (!selectRunA || !selectRunB || !btnCompare) return;

  const runA = selectRunA.value;
  const runB = selectRunB.value;

  // Enable only if both selected and different
  btnCompare.disabled = !runA || !runB || runA === runB;
}

/**
 * Fetch comparison data and render overlay scatter plot with statistics
 */
export async function updateCompare() {
  const selectRunA = document.getElementById("select-run-a");
  const selectRunB = document.getElementById("select-run-b");
  const resultsDiv = document.getElementById("compare-results");

  if (!selectRunA || !selectRunB || !resultsDiv) return;

  const sidA = selectRunA.value;
  const sidB = selectRunB.value;

  if (!sidA || !sidB || sidA === sidB) return;

  const useRox = getUseRox();

  try {
    // Fetch scatter data
    const scatterResponse = await fetch(
      `/api/compare/scatter?sid1=${sidA}&sid2=${sidB}&cycle1=0&cycle2=0&use_rox=${useRox}`
    );
    if (!scatterResponse.ok) {
      throw new Error(`Failed to fetch scatter data: ${scatterResponse.statusText}`);
    }
    const scatterData = await scatterResponse.json();

    // Fetch stats data
    const statsResponse = await fetch(
      `/api/compare/stats?sid1=${sidA}&sid2=${sidB}&cycle1=0&cycle2=0&use_rox=${useRox}`
    );
    if (!statsResponse.ok) {
      throw new Error(`Failed to fetch stats data: ${statsResponse.statusText}`);
    }
    const statsData = await statsResponse.json();

    currentComparison = { scatter: scatterData, stats: statsData };

    // Render overlay plot
    renderOverlayPlot(scatterData);

    // Render statistics table
    renderStatsTable(scatterData, statsData);

    // Update legend
    updateLegend(scatterData);

    // Show results
    resultsDiv.style.display = "flex";
  } catch (error) {
    console.error("Error updating comparison:", error);
    showMessage(`Comparison failed: ${error.message}`, "error");
    resultsDiv.style.display = "none";
  }
}

/**
 * Render overlay scatter plot using Plotly
 */
function renderOverlayPlot(data) {
  const plotDiv = document.getElementById("compare-plot");
  if (!plotDiv) return;

  const { run1, run2 } = data;

  // Prepare Run A data (circles, blue)
  const runATrace = {
    x: run1.points.map(p => p.norm_fam),
    y: run1.points.map(p => p.norm_allele2),
    text: run1.points.map(p => p.well),
    mode: "markers",
    type: "scattergl",
    name: `Run A: ${run1.instrument}`,
    marker: {
      symbol: "circle",
      size: 10,
      color: "#2563eb",
      opacity: 0.6,
      line: {
        color: "#1d4ed8",
        width: 1
      }
    },
    hovertemplate: "<b>%{text}</b><br>FAM: %{x:.2f}<br>%{fullData.name.split(':')[0]}: %{y:.2f}<extra></extra>"
  };

  // Prepare Run B data (diamonds, orange)
  const runBTrace = {
    x: run2.points.map(p => p.norm_fam),
    y: run2.points.map(p => p.norm_allele2),
    text: run2.points.map(p => p.well),
    mode: "markers",
    type: "scattergl",
    name: `Run B: ${run2.instrument}`,
    marker: {
      symbol: "diamond",
      size: 10,
      color: "#f59e0b",
      opacity: 0.6,
      line: {
        color: "#d97706",
        width: 1
      }
    },
    hovertemplate: "<b>%{text}</b><br>FAM: %{x:.2f}<br>%{fullData.name.split(':')[0]}: %{y:.2f}<extra></extra>"
  };

  const layout = {
    title: {
      text: "Run Comparison: Overlay Scatter Plot",
      font: { size: 16, weight: 600 }
    },
    xaxis: {
      title: `Normalized FAM (${run1.allele2_dye === "VIC" ? "Allele1/WT" : "WT"})`,
      zeroline: true,
      gridcolor: "#e9ecef"
    },
    yaxis: {
      title: `Normalized ${run1.allele2_dye} (${run1.allele2_dye === "VIC" ? "Allele2/MT" : "MT"})`,
      zeroline: true,
      gridcolor: "#e9ecef"
    },
    hovermode: "closest",
    showlegend: true,
    legend: {
      x: 0.02,
      y: 0.98,
      bgcolor: "rgba(255, 255, 255, 0.9)",
      bordercolor: "#dee2e6",
      borderwidth: 1
    },
    margin: { l: 60, r: 40, t: 60, b: 60 },
    plot_bgcolor: "#f8f9fa",
    paper_bgcolor: "white"
  };

  const config = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
    displaylogo: false
  };

  Plotly.react(plotDiv, [runATrace, runBTrace], layout, config);
}

/**
 * Render statistics comparison table
 */
function renderStatsTable(scatterData, statsData) {
  const tableBody = document.querySelector("#compare-stats-table tbody");
  const correlationDiv = document.getElementById("correlation-stats");

  if (!tableBody || !correlationDiv) return;

  const { run1, run2 } = scatterData;
  const { run1: stats1, run2: stats2, correlation } = statsData;

  // Build statistics rows
  const rows = [
    {
      metric: "Instrument",
      runA: run1.instrument,
      runB: run2.instrument,
      format: "text"
    },
    {
      metric: "Wells",
      runA: stats1.n_wells,
      runB: stats2.n_wells,
      format: "number"
    },
    {
      metric: "Mean FAM",
      runA: stats1.mean_fam,
      runB: stats2.mean_fam,
      format: "decimal"
    },
    {
      metric: `Mean ${run1.allele2_dye}`,
      runA: stats1.mean_allele2,
      runB: stats2.mean_allele2,
      format: "decimal"
    },
    {
      metric: "Std FAM",
      runA: stats1.std_fam,
      runB: stats2.std_fam,
      format: "decimal"
    },
    {
      metric: `Std ${run1.allele2_dye}`,
      runA: stats1.std_allele2,
      runB: stats2.std_allele2,
      format: "decimal"
    }
  ];

  tableBody.innerHTML = rows.map(row => {
    let valueA = row.runA;
    let valueB = row.runB;

    if (row.format === "decimal") {
      valueA = typeof valueA === "number" ? valueA.toFixed(2) : valueA;
      valueB = typeof valueB === "number" ? valueB.toFixed(2) : valueB;
    }

    return `
      <tr>
        <td><strong>${row.metric}</strong></td>
        <td>${valueA}</td>
        <td>${valueB}</td>
      </tr>
    `;
  }).join("");

  // Render correlation statistics
  const famR = correlation.fam_r;
  const allele2R = correlation.allele2_r;

  correlationDiv.innerHTML = `
    <div class="correlation-item">
      <span class="correlation-label">FAM Correlation (R):</span>
      <span class="correlation-value ${getCorrelationClass(famR)}">${formatCorrelation(famR)}</span>
    </div>
    <div class="correlation-item">
      <span class="correlation-label">${run1.allele2_dye} Correlation (R):</span>
      <span class="correlation-value ${getCorrelationClass(allele2R)}">${formatCorrelation(allele2R)}</span>
    </div>
  `;
}

/**
 * Update legend with run information
 */
function updateLegend(data) {
  const legendRunA = document.getElementById("legend-run-a");
  const legendRunB = document.getElementById("legend-run-b");

  if (!legendRunA || !legendRunB) return;

  const { run1, run2 } = data;

  legendRunA.textContent = `Run A: ${run1.instrument} (${run1.points.length} wells)`;
  legendRunB.textContent = `Run B: ${run2.instrument} (${run2.points.length} wells)`;
}

/**
 * Format correlation value for display
 */
function formatCorrelation(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return "N/A";
  }
  return value.toFixed(3);
}

/**
 * Get CSS class for correlation value based on threshold
 */
function getCorrelationClass(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return "low";
  }
  if (value >= 0.9) return "high";
  if (value >= 0.7) return "medium";
  return "low";
}
