/**
 * QC Indicators Display Module
 *
 * Fetches QC metrics from backend and displays badges:
 * - Call Rate: percentage of wells with successful genotype calls
 * - NTC Check: no-template control validation
 * - Cluster Separation: quality of cluster separation (higher = better)
 */

let sessionId = null;

/**
 * Initialize QC module with session ID
 * @param {string} sid - Session identifier
 */
export function initQC(sid) {
    sessionId = sid;
}

/**
 * Update QC badges based on current cycle and normalization settings
 * @param {number} cycle - Current cycle number
 * @param {boolean} useRox - Whether ROX normalization is enabled
 */
export async function updateQC(cycle, useRox) {
    if (!sessionId) return;

    try {
        const res = await fetch(`/api/data/${sessionId}/qc?cycle=${cycle}&use_rox=${useRox}`);
        if (!res.ok) {
            console.warn('QC data not available');
            return;
        }

        const qc = await res.json();
        renderQCBadges(qc);
    } catch (err) {
        console.error('Failed to fetch QC data:', err);
    }
}

/**
 * Render QC metric badges in the UI
 * @param {Object} qc - QC data object containing metrics
 */
function renderQCBadges(qc) {
    let container = document.getElementById('qc-badges');

    // Create container if it doesn't exist
    if (!container) {
        const sessionInfo = document.getElementById('session-info');
        if (!sessionInfo) return;

        container = document.createElement('div');
        container.id = 'qc-badges';
        container.style.display = 'flex';
        container.style.gap = '8px';
        sessionInfo.appendChild(container);
    }

    container.innerHTML = '';

    // Call Rate Badge
    const callRate = qc.call_rate ?? 0;
    const callRatePercent = (callRate * 100).toFixed(0);

    let callRateColor;
    if (callRate >= 0.9) {
        callRateColor = 'var(--accent)'; // Green - excellent
    } else if (callRate >= 0.7) {
        callRateColor = '#f59e0b'; // Amber - acceptable
    } else {
        callRateColor = 'var(--danger)'; // Red - poor
    }

    const callRateTitle = `${qc.n_called ?? 0}/${qc.n_total ?? 0} wells genotyped`;
    container.appendChild(makeBadge(`Call ${callRatePercent}%`, callRateColor, callRateTitle));

    // NTC Check Badge
    if (qc.ntc_check) {
        const ntcOk = qc.ntc_check.ok;
        const ntcColor = ntcOk ? 'var(--accent)' : 'var(--danger)';
        const ntcLabel = ntcOk ? 'NTC OK' : 'NTC WARN';

        let ntcTitle;
        if (ntcOk) {
            ntcTitle = 'All NTC wells below threshold';
        } else {
            const failedWells = qc.ntc_check.wells?.map(w => w.well).join(', ') || 'unknown';
            ntcTitle = `NTC signal detected: ${failedWells}`;
        }

        container.appendChild(makeBadge(ntcLabel, ntcColor, ntcTitle));
    }

    // Cluster Separation Badge (only if clustering exists)
    if (qc.cluster_separation != null) {
        const sep = qc.cluster_separation;

        let sepColor;
        if (sep >= 2.0) {
            sepColor = 'var(--accent)'; // Green - excellent separation
        } else if (sep >= 1.0) {
            sepColor = '#f59e0b'; // Amber - acceptable separation
        } else {
            sepColor = 'var(--danger)'; // Red - poor separation
        }

        const sepLabel = `Sep ${sep.toFixed(1)}`;
        const sepTitle = `Cluster separation score (higher = better separated)`;

        container.appendChild(makeBadge(sepLabel, sepColor, sepTitle));
    }
}

/**
 * Create a styled badge element
 * @param {string} text - Badge text content
 * @param {string} borderColor - CSS color for border and text
 * @param {string} title - Tooltip text
 * @returns {HTMLSpanElement} Badge element
 */
function makeBadge(text, borderColor, title) {
    const badge = document.createElement('span');
    badge.className = 'badge qc-badge';
    badge.textContent = text;
    badge.title = title || '';
    badge.style.borderColor = borderColor;
    badge.style.color = borderColor;
    badge.style.fontWeight = '600';

    return badge;
}
