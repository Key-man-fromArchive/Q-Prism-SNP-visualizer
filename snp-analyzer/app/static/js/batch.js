/**
 * Batch / Project workflow module.
 *
 * Lets users group multiple uploaded runs into a project for batch analysis
 * with a per-plate summary dashboard.
 */

let currentProjectId = null;

/**
 * Build the batch tab UI and inject into #tab-batch.
 * Called once during initAnalysis().
 */
export function initBatch() {
  const tabDiv = document.getElementById("tab-batch");
  if (!tabDiv) return;

  tabDiv.innerHTML = `
    <div class="batch-container">
      <div class="batch-header">
        <h3 style="margin-bottom:0;">Projects</h3>
        <div class="batch-create-form">
          <input type="text" id="batch-project-name" placeholder="New project name...">
          <button id="batch-create-btn" class="settings-action-btn" style="margin-top:0;padding:6px 14px;font-size:13px;">Create</button>
        </div>
      </div>

      <div id="batch-project-list"></div>
      <div id="batch-project-detail" class="project-detail" style="display:none;"></div>
    </div>
  `;

  // Create button handler
  const createBtn = document.getElementById("batch-create-btn");
  const nameInput = document.getElementById("batch-project-name");
  if (createBtn && nameInput) {
    createBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error("Failed to create project");
        nameInput.value = "";
        await loadProjects();
      } catch (err) {
        console.error("Error creating project:", err);
      }
    });

    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") createBtn.click();
    });
  }
}

/**
 * Fetch and render the project list table.
 * Called when the Batch tab is activated.
 */
export async function loadProjects() {
  const listDiv = document.getElementById("batch-project-list");
  if (!listDiv) return;

  try {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error("Failed to load projects");
    const data = await res.json();
    const projects = data.projects || [];

    if (projects.length === 0) {
      listDiv.innerHTML = '<p class="placeholder">No projects yet. Create one above.</p>';
      return;
    }

    let html = `
      <table class="project-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Sessions</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const p of projects) {
      const created = new Date(p.created_at).toLocaleDateString();
      html += `
        <tr>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td>${p.session_count}</td>
          <td>${created}</td>
          <td>
            <button class="badge" style="cursor:pointer;" onclick="window.__batchViewProject('${p.id}')">View</button>
            <button class="badge" style="cursor:pointer;color:var(--danger);" onclick="window.__batchDeleteProject('${p.id}')">Delete</button>
          </td>
        </tr>
      `;
    }

    html += "</tbody></table>";
    listDiv.innerHTML = html;
  } catch (err) {
    console.error("Error loading projects:", err);
    listDiv.innerHTML = '<p class="placeholder">Failed to load projects.</p>';
  }
}

// Expose click handlers globally (for inline onclick in table rows)
window.__batchViewProject = viewProject;
window.__batchDeleteProject = deleteProject;

/**
 * Delete a project after confirmation.
 */
async function deleteProject(projectId) {
  if (!confirm("Delete this project?")) return;
  try {
    const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete project");
    if (currentProjectId === projectId) {
      currentProjectId = null;
      const detailDiv = document.getElementById("batch-project-detail");
      if (detailDiv) detailDiv.style.display = "none";
    }
    await loadProjects();
  } catch (err) {
    console.error("Error deleting project:", err);
  }
}

/**
 * Show project detail view with session management and summary.
 */
async function viewProject(projectId) {
  currentProjectId = projectId;
  const detailDiv = document.getElementById("batch-project-detail");
  if (!detailDiv) return;
  detailDiv.style.display = "block";
  detailDiv.innerHTML = '<p class="placeholder">Loading project...</p>';

  try {
    // Fetch project detail and summary in parallel
    const [projectRes, summaryRes, sessionsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/projects/${projectId}/summary`),
      fetch("/api/sessions"),
    ]);

    if (!projectRes.ok) throw new Error("Failed to load project");
    const project = await projectRes.json();

    let summary = null;
    if (summaryRes.ok) {
      summary = await summaryRes.json();
    }

    let allSessions = [];
    if (sessionsRes.ok) {
      allSessions = await sessionsRes.json();
    }

    renderProjectDetail(project, summary, allSessions);
  } catch (err) {
    console.error("Error loading project detail:", err);
    detailDiv.innerHTML = '<p class="placeholder">Failed to load project details.</p>';
  }
}

/**
 * Render the full project detail view.
 */
function renderProjectDetail(project, summary, allSessions) {
  const detailDiv = document.getElementById("batch-project-detail");
  if (!detailDiv) return;

  const projectSids = new Set(project.session_ids || []);
  const availableSessions = allSessions.filter(s => !projectSids.has(s.session_id));

  // Concordance badge
  let concordanceHtml = "";
  if (summary && summary.concordance && summary.concordance.percentage !== null) {
    const pct = summary.concordance.percentage;
    let cls = "low";
    if (pct >= 90) cls = "high";
    else if (pct >= 70) cls = "medium";
    concordanceHtml = `
      <div style="margin-bottom:12px;">
        <strong>Cross-plate Concordance:</strong>
        <span class="concordance-badge ${cls}">${pct}%</span>
        <span style="font-size:12px;color:var(--text-muted);margin-left:8px;">
          (${summary.concordance.concordant_wells}/${summary.concordance.total_compared} wells match)
        </span>
      </div>
    `;
  } else if (summary) {
    concordanceHtml = `
      <div style="margin-bottom:12px;">
        <strong>Cross-plate Concordance:</strong>
        <span style="font-size:12px;color:var(--text-muted);margin-left:8px;">
          Not enough overlapping wells to calculate
        </span>
      </div>
    `;
  }

  // Session add form
  let addFormHtml = "";
  if (availableSessions.length > 0) {
    let options = availableSessions.map(s =>
      `<option value="${s.session_id}">${s.instrument} (${s.num_wells}w, ${s.num_cycles}c) [${s.session_id.substring(0, 6)}]</option>`
    ).join("");
    addFormHtml = `
      <div class="session-add-form">
        <select id="batch-add-session-select">
          <option value="">-- Add session --</option>
          ${options}
        </select>
        <button id="batch-add-session-btn" class="badge" style="cursor:pointer;color:var(--accent);">+ Add</button>
      </div>
    `;
  }

  // Summary table
  let summaryTableHtml = '<p class="placeholder">No sessions in this project.</p>';
  if (summary && summary.plates && summary.plates.length > 0) {
    summaryTableHtml = `
      <table class="project-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Instrument</th>
            <th>Wells</th>
            <th>AA</th>
            <th>AB</th>
            <th>BB</th>
            <th>NTC</th>
            <th>Unknown</th>
            <th>Quality</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const plate of summary.plates) {
      const g = plate.genotypes || {};
      const qualityClass = plate.mean_quality >= 70 ? "quality-high" :
                           plate.mean_quality >= 50 ? "quality-medium" :
                           plate.mean_quality >= 30 ? "quality-warning" : "quality-low";
      const missingTag = plate.missing ? ' <span style="color:var(--danger);font-size:11px;">(missing)</span>' : "";

      summaryTableHtml += `
        <tr>
          <td>${plate.session_id.substring(0, 8)}${missingTag}</td>
          <td>${plate.instrument}</td>
          <td>${plate.num_wells}</td>
          <td>${g.AA || 0}</td>
          <td>${g.AB || 0}</td>
          <td>${g.BB || 0}</td>
          <td>${plate.ntc_count || 0}</td>
          <td>${plate.unknown_count || 0}</td>
          <td><span class="${qualityClass}" style="font-weight:600;">${plate.mean_quality}</span></td>
          <td>
            <button class="badge" style="cursor:pointer;color:var(--danger);font-size:11px;"
              onclick="window.__batchRemoveSession('${project.id}', '${plate.session_id}')">Remove</button>
          </td>
        </tr>
      `;
    }

    summaryTableHtml += "</tbody></table>";
  }

  // Totals row
  let totalsHtml = "";
  if (summary && summary.plates && summary.plates.length > 0) {
    const totals = { AA: 0, AB: 0, BB: 0, NTC: 0, Unknown: 0, wells: 0, qualitySum: 0, qualityCount: 0 };
    for (const plate of summary.plates) {
      if (plate.missing) continue;
      const g = plate.genotypes || {};
      totals.AA += g.AA || 0;
      totals.AB += g.AB || 0;
      totals.BB += g.BB || 0;
      totals.NTC += plate.ntc_count || 0;
      totals.Unknown += plate.unknown_count || 0;
      totals.wells += plate.num_wells || 0;
      totals.qualitySum += plate.mean_quality * plate.num_wells;
      totals.qualityCount += plate.num_wells;
    }
    const avgQuality = totals.qualityCount > 0 ? (totals.qualitySum / totals.qualityCount).toFixed(1) : "0.0";
    totalsHtml = `
      <div style="margin-top:8px;font-size:13px;color:var(--text-muted);">
        <strong>Totals:</strong>
        ${totals.wells} wells |
        AA: ${totals.AA} |
        AB: ${totals.AB} |
        BB: ${totals.BB} |
        NTC: ${totals.NTC} |
        Unknown: ${totals.Unknown} |
        Avg Quality: ${avgQuality}
      </div>
    `;
  }

  detailDiv.innerHTML = `
    <div class="panel">
      <div class="project-sessions-header">
        <h3 style="margin-bottom:0;">${escapeHtml(project.name)}</h3>
        <button class="badge" style="cursor:pointer;font-size:11px;" id="batch-back-btn">Back to list</button>
        <button class="badge" style="cursor:pointer;font-size:11px;" id="batch-export-csv-btn">Export CSV</button>
      </div>

      ${addFormHtml}

      ${concordanceHtml}

      <h4 style="font-size:13px;font-weight:600;margin:12px 0 8px;color:var(--text-muted);">Per-Plate Summary</h4>
      ${summaryTableHtml}
      ${totalsHtml}
    </div>
  `;

  // Attach event listeners
  document.getElementById("batch-back-btn")?.addEventListener("click", () => {
    currentProjectId = null;
    detailDiv.style.display = "none";
  });

  document.getElementById("batch-add-session-btn")?.addEventListener("click", async () => {
    const select = document.getElementById("batch-add-session-select");
    const sid = select?.value;
    if (!sid) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/sessions/${sid}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to add session");
      await viewProject(project.id);
    } catch (err) {
      console.error("Error adding session:", err);
    }
  });

  document.getElementById("batch-export-csv-btn")?.addEventListener("click", () => {
    if (summary) exportBatchCSV(project, summary);
  });
}

// Expose remove handler globally
window.__batchRemoveSession = async function(projectId, sid) {
  try {
    const res = await fetch(`/api/projects/${projectId}/sessions/${sid}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to remove session");
    await viewProject(projectId);
  } catch (err) {
    console.error("Error removing session:", err);
  }
};

/**
 * Export the batch summary as a CSV file.
 */
function exportBatchCSV(project, summary) {
  const rows = [
    ["Project", project.name],
    ["Created", project.created_at],
    [],
    ["Session ID", "Instrument", "Wells", "AA", "AB", "BB", "NTC", "Unknown", "Mean Quality"],
  ];

  for (const plate of (summary.plates || [])) {
    const g = plate.genotypes || {};
    rows.push([
      plate.session_id,
      plate.instrument,
      plate.num_wells,
      g.AA || 0,
      g.AB || 0,
      g.BB || 0,
      plate.ntc_count || 0,
      plate.unknown_count || 0,
      plate.mean_quality,
    ]);
  }

  rows.push([]);
  const conc = summary.concordance || {};
  rows.push(["Cross-plate Concordance"]);
  rows.push(["Concordant Wells", conc.concordant_wells || 0]);
  rows.push(["Total Compared", conc.total_compared || 0]);
  rows.push(["Concordance %", conc.percentage !== null ? conc.percentage : "N/A"]);

  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `batch_${project.name.replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
