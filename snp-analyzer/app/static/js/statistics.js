/**
 * Statistics display -- allele frequency, HWE, genotype distribution.
 */

let statsSessionId = null;

export function initStatistics(sid) {
    statsSessionId = sid;
}

export async function loadStatistics() {
    if (!statsSessionId) return;

    const container = document.getElementById("statistics-content");
    if (!container) return;

    try {
        const res = await fetch(`/api/data/${statsSessionId}/statistics`);
        if (!res.ok) return;
        const data = await res.json();

        renderStatistics(container, data);
    } catch (err) {
        container.innerHTML = `<p class="placeholder">Failed to load statistics</p>`;
    }
}

function renderStatistics(container, data) {
    const freq = data.allele_frequency;
    const hwe = data.hwe;
    const dist = data.genotype_distribution;

    let html = `<div class="stats-sections">`;

    // Genotype Distribution
    html += `<div class="stats-section">
        <h4>Genotype Distribution</h4>
        <table class="stats-table">
            <thead><tr><th>Genotype</th><th>Count</th><th>%</th></tr></thead>
            <tbody>`;

    const total = data.total_wells || 1;
    const order = ["Allele 1 Homo", "Allele 2 Homo", "Heterozygous", "NTC", "Undetermined", "Unknown", "Positive Control"];
    for (const gt of order) {
        const count = dist[gt] || 0;
        if (count > 0) {
            html += `<tr><td>${gt}</td><td>${count}</td><td>${(count / total * 100).toFixed(1)}%</td></tr>`;
        }
    }
    html += `</tbody></table></div>`;

    // Allele Frequency
    if (freq.total_genotyped > 0) {
        html += `<div class="stats-section">
            <h4>Allele Frequencies</h4>
            <table class="stats-table">
                <tbody>
                    <tr><td>Allele A (p)</td><td><b>${freq.p.toFixed(4)}</b></td></tr>
                    <tr><td>Allele B (q)</td><td><b>${freq.q.toFixed(4)}</b></td></tr>
                    <tr><td>Total genotyped</td><td>${freq.total_genotyped} (AA=${freq.n_aa}, AB=${freq.n_ab}, BB=${freq.n_bb})</td></tr>
                </tbody>
            </table>
        </div>`;

        // HWE Test
        if (hwe.chi2 !== null) {
            const hweClass = hwe.in_hwe ? "hwe-pass" : "hwe-fail";
            const hweLabel = hwe.in_hwe ? "In HWE (p > 0.05)" : "Deviates from HWE (p \u2264 0.05)";

            html += `<div class="stats-section">
                <h4>Hardy-Weinberg Equilibrium</h4>
                <table class="stats-table">
                    <thead><tr><th></th><th>Observed</th><th>Expected</th></tr></thead>
                    <tbody>
                        <tr><td>AA (Allele 1 Homo)</td><td>${freq.n_aa}</td><td>${hwe.expected_aa}</td></tr>
                        <tr><td>AB (Heterozygous)</td><td>${freq.n_ab}</td><td>${hwe.expected_ab}</td></tr>
                        <tr><td>BB (Allele 2 Homo)</td><td>${freq.n_bb}</td><td>${hwe.expected_bb}</td></tr>
                    </tbody>
                </table>
                <div class="hwe-result ${hweClass}">
                    <span>\u03C7\u00B2 = ${hwe.chi2.toFixed(4)}</span>
                    <span>p-value = ${hwe.p_value.toFixed(4)}</span>
                    <span class="hwe-verdict">${hweLabel}</span>
                </div>
            </div>`;
        }
    } else {
        html += `<div class="stats-section"><p class="placeholder">Run clustering first to calculate allele frequencies.</p></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
}
