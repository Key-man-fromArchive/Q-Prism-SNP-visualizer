/**
 * Signal Quality Scoring display.
 */

let qualitySessionId = null;
let qualityData = null;

export function initQuality(sid) {
    qualitySessionId = sid;
}

export async function loadQuality(useRox = true) {
    if (!qualitySessionId) return;

    try {
        const res = await fetch(`/api/data/${qualitySessionId}/quality?use_rox=${useRox}`);
        if (!res.ok) return;
        const json = await res.json();
        qualityData = json;
        renderQuality();
    } catch {
        // ignore
    }
}

export function getWellQuality(well) {
    if (!qualityData?.results) return null;
    return qualityData.results[well] || null;
}

function renderQuality() {
    const container = document.getElementById("quality-content");
    if (!container || !qualityData) return;

    const summary = qualityData.summary;
    const results = qualityData.results;

    let html = `<div class="quality-summary">
        <div class="quality-stat">
            <span class="quality-label">Mean Score</span>
            <span class="quality-value ${getScoreClass(summary.mean_score)}">${summary.mean_score}</span>
        </div>
        <div class="quality-stat">
            <span class="quality-label">Low Quality Wells</span>
            <span class="quality-value ${summary.low_quality_count > 0 ? 'quality-low' : 'quality-high'}">${summary.low_quality_count} / ${summary.total_wells}</span>
        </div>
    </div>`;

    // Score distribution
    const buckets = { "90-100": 0, "70-89": 0, "50-69": 0, "0-49": 0 };
    for (const well of Object.values(results)) {
        const s = well.score;
        if (s >= 90) buckets["90-100"]++;
        else if (s >= 70) buckets["70-89"]++;
        else if (s >= 50) buckets["50-69"]++;
        else buckets["0-49"]++;
    }

    html += `<div class="quality-distribution">
        <h4>Score Distribution</h4>
        <table class="stats-table">
            <thead><tr><th>Range</th><th>Count</th><th>Bar</th></tr></thead>
            <tbody>`;

    const total = Object.values(results).length || 1;
    for (const [range, count] of Object.entries(buckets)) {
        const pct = (count / total * 100).toFixed(0);
        html += `<tr>
            <td>${range}</td>
            <td>${count}</td>
            <td><div class="quality-bar"><div class="quality-bar-fill ${getBarClass(range)}" style="width:${pct}%"></div></div></td>
        </tr>`;
    }

    html += `</tbody></table></div>`;

    // Low quality wells list
    const lowQuality = Object.values(results).filter(r => r.score < 50).sort((a, b) => a.score - b.score);
    if (lowQuality.length > 0) {
        html += `<div class="quality-alerts">
            <h4>Low Quality Wells</h4>
            <table class="stats-table">
                <thead><tr><th>Well</th><th>Score</th><th>Flags</th></tr></thead>
                <tbody>`;
        for (const w of lowQuality) {
            html += `<tr>
                <td><b>${w.well}</b></td>
                <td class="quality-low">${w.score}</td>
                <td>${(w.flags || []).join(", ") || "-"}</td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
    }

    container.innerHTML = html;
}

function getScoreClass(score) {
    if (score >= 80) return "quality-high";
    if (score >= 50) return "quality-medium";
    return "quality-low";
}

function getBarClass(range) {
    if (range === "90-100") return "quality-high";
    if (range === "70-89") return "quality-medium";
    if (range === "50-69") return "quality-warning";
    return "quality-low";
}

export function renderQualityInDetail(well) {
    const q = getWellQuality(well);
    if (!q) return "";

    const cls = getScoreClass(q.score);
    return `
        <tr><td>Quality Score</td><td><span class="${cls}" style="font-weight:600;">${q.score}/100</span></td></tr>
        ${q.flags.length > 0 ? `<tr><td>Quality Flags</td><td>${q.flags.join(", ")}</td></tr>` : ""}
    `;
}
