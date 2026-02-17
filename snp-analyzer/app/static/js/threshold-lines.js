/**
 * threshold-lines.js
 *
 * Interactive threshold visualization for scatter plot clustering.
 * Displays threshold lines and regions based on clustering parameters:
 * - NTC region (gray shaded area near origin)
 * - Allele1 ratio line (red dashed diagonal)
 * - Allele2 ratio line (blue dashed diagonal)
 * - Region labels (A1 Homo, Het, A2 Homo, NTC)
 */

let isVisible = false;
let currentSettings = {
    ntcThreshold: 0.1,
    allele1RatioMax: 0.4,
    allele2RatioMin: 0.6
};

/**
 * Initialize threshold lines module.
 * Currently no initialization needed - lines are added when shown.
 */
export function initThresholdLines() {
    // Nothing to do until shown
}

/**
 * Show threshold lines on the scatter plot.
 * @param {Object} settings - Clustering threshold settings
 * @param {number} settings.ntcThreshold - NTC threshold (default 0.1)
 * @param {number} settings.allele1RatioMax - Allele1 ratio max (default 0.4)
 * @param {number} settings.allele2RatioMin - Allele2 ratio min (default 0.6)
 */
export function showThresholdLines(settings) {
    isVisible = true;
    currentSettings = { ...settings };
    updateLines();
}

/**
 * Hide threshold lines from the scatter plot.
 */
export function hideThresholdLines() {
    isVisible = false;
    const plotDiv = document.getElementById('scatter-plot');
    if (plotDiv && plotDiv.layout) {
        Plotly.relayout('scatter-plot', { shapes: [], annotations: [] });
    }
}

/**
 * Toggle threshold lines visibility.
 * @param {Object} settings - Clustering threshold settings (used when showing)
 */
export function toggleThresholdLines(settings) {
    if (isVisible) {
        hideThresholdLines();
    } else {
        showThresholdLines(settings);
    }
}

/**
 * Check if threshold lines are currently visible.
 * @returns {boolean} True if lines are visible
 */
export function isThresholdVisible() {
    return isVisible;
}

/**
 * Update threshold lines on the scatter plot.
 * Called internally when settings change or plot is redrawn.
 */
function updateLines() {
    const plotDiv = document.getElementById('scatter-plot');
    if (!plotDiv || !plotDiv.layout) return;

    const { ntcThreshold, allele1RatioMax, allele2RatioMin } = currentSettings;

    // Get current axis range for line endpoints
    // Use layout range if fixed, otherwise estimate from data
    const xMax = plotDiv.layout.xaxis?.range?.[1] || 12;
    const yMax = plotDiv.layout.yaxis?.range?.[1] || 12;
    const xMin = plotDiv.layout.xaxis?.range?.[0] || 0;
    const yMin = plotDiv.layout.yaxis?.range?.[0] || 0;

    // Allele1 line: ratio = FAM / (FAM + Allele2) = allele1RatioMax
    // Solving: FAM / (FAM + Allele2) = r  →  Allele2 = FAM * (1-r) / r
    // y = x * (1 - allele1RatioMax) / allele1RatioMax
    const a1Slope = (1 - allele1RatioMax) / allele1RatioMax;

    // Allele2 line: ratio = allele2RatioMin
    // y = x * (1 - allele2RatioMin) / allele2RatioMin
    const a2Slope = (1 - allele2RatioMin) / allele2RatioMin;

    // Calculate line endpoints within visible range
    const a1EndX = Math.min(xMax, yMax / a1Slope);
    const a1EndY = Math.min(yMax, xMax * a1Slope);

    const a2EndX = Math.min(xMax, yMax / a2Slope);
    const a2EndY = Math.min(yMax, xMax * a2Slope);

    // NTC threshold box size (ensure it doesn't exceed plot range)
    const ntcBoxSize = Math.min(ntcThreshold, xMax, yMax);

    const shapes = [
        // NTC region (gray shaded rectangle near origin)
        {
            type: 'rect',
            x0: xMin,
            y0: yMin,
            x1: ntcBoxSize,
            y1: ntcBoxSize,
            fillcolor: 'rgba(156, 163, 175, 0.15)',
            line: {
                color: '#9ca3af',
                width: 1,
                dash: 'dot'
            },
            layer: 'below'
        },
        // Allele 1 ratio line (red dashed)
        // Above this line = higher Allele2, below = higher FAM (Allele1)
        {
            type: 'line',
            x0: xMin,
            y0: yMin,
            x1: a1EndX,
            y1: a1EndY,
            line: {
                color: '#dc2626',
                width: 2,
                dash: 'dash'
            },
            layer: 'below'
        },
        // Allele 2 ratio line (blue dashed)
        // Below this line = higher FAM, above = higher Allele2
        {
            type: 'line',
            x0: xMin,
            y0: yMin,
            x1: a2EndX,
            y1: a2EndY,
            line: {
                color: '#2563eb',
                width: 2,
                dash: 'dash'
            },
            layer: 'below'
        },
    ];

    // Region labels as annotations (using paper coordinates for consistent positioning)
    const annotations = [
        // Allele 1 Homo region (bottom left, below red line)
        {
            x: 0.15,
            y: 0.85,
            xref: 'paper',
            yref: 'paper',
            text: 'Allele 1',
            font: {
                color: '#dc2626',
                size: 12,
                family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            },
            showarrow: false,
            bgcolor: 'rgba(255,255,255,0.8)',
            borderpad: 4,
            bordercolor: '#dc2626',
            borderwidth: 1,
            opacity: 0.9
        },
        // Heterozygous region (middle, between lines)
        {
            x: 0.5,
            y: 0.5,
            xref: 'paper',
            yref: 'paper',
            text: 'Het',
            font: {
                color: '#16a34a',
                size: 12,
                family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            },
            showarrow: false,
            bgcolor: 'rgba(255,255,255,0.8)',
            borderpad: 4,
            bordercolor: '#16a34a',
            borderwidth: 1,
            opacity: 0.9
        },
        // Allele 2 Homo region (top right, above blue line)
        {
            x: 0.85,
            y: 0.15,
            xref: 'paper',
            yref: 'paper',
            text: 'Allele 2',
            font: {
                color: '#2563eb',
                size: 12,
                family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            },
            showarrow: false,
            bgcolor: 'rgba(255,255,255,0.8)',
            borderpad: 4,
            bordercolor: '#2563eb',
            borderwidth: 1,
            opacity: 0.9
        },
        // NTC region (near origin, inside gray box)
        {
            x: ntcBoxSize / 2,
            y: ntcBoxSize / 2,
            xref: 'x',
            yref: 'y',
            text: 'NTC',
            font: {
                color: '#6b7280',
                size: 10,
                family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            },
            showarrow: false,
            bgcolor: 'rgba(255,255,255,0.7)',
            borderpad: 2,
            opacity: 0.8
        },
    ];

    Plotly.relayout('scatter-plot', { shapes, annotations });
}

/**
 * Update threshold lines when plot is redrawn or settings change.
 * Should be called from scatter.js after updateScatter() completes.
 */
export function refreshThresholdLines() {
    if (isVisible) {
        updateLines();
    }
}
