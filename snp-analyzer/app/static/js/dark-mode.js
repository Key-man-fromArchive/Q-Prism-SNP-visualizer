/**
 * Dark Mode Toggle Module
 * Manages dark mode state with localStorage persistence and Plotly chart integration
 */

const STORAGE_KEY = 'snp-analyzer-dark-mode';
const DARK_CLASS = 'dark';

/**
 * Initialize dark mode on page load
 * Checks localStorage and system preference
 */
export function initDarkMode() {
    const toggleBtn = document.getElementById('dark-mode-toggle');

    if (!toggleBtn) {
        console.warn('Dark mode toggle button not found');
        return;
    }

    // Check saved preference or system preference
    const savedMode = localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const shouldBeDark = savedMode === 'true' || (savedMode === null && prefersDark);

    if (shouldBeDark) {
        document.body.classList.add(DARK_CLASS);
        updateToggleIcon(true);
    } else {
        updateToggleIcon(false);
    }

    // Set up toggle button click handler
    toggleBtn.addEventListener('click', toggleDarkMode);

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (localStorage.getItem(STORAGE_KEY) === null) {
            // Only auto-switch if user hasn't set a preference
            if (e.matches) {
                enableDarkMode();
            } else {
                disableDarkMode();
            }
        }
    });
}

/**
 * Toggle dark mode on/off
 */
export function toggleDarkMode() {
    const isDark = document.body.classList.contains(DARK_CLASS);

    if (isDark) {
        disableDarkMode();
    } else {
        enableDarkMode();
    }
}

/**
 * Enable dark mode
 */
function enableDarkMode() {
    document.body.classList.add(DARK_CLASS);
    localStorage.setItem(STORAGE_KEY, 'true');
    updateToggleIcon(true);
    updatePlotlyCharts(true);
}

/**
 * Disable dark mode
 */
function disableDarkMode() {
    document.body.classList.remove(DARK_CLASS);
    localStorage.setItem(STORAGE_KEY, 'false');
    updateToggleIcon(false);
    updatePlotlyCharts(false);
}

/**
 * Update toggle button icon
 */
function updateToggleIcon(isDark) {
    const toggleBtn = document.getElementById('dark-mode-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = isDark ? '☀️' : '🌙';
        toggleBtn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    }
}

/**
 * Update all Plotly charts to match current theme
 */
function updatePlotlyCharts(isDark) {
    const plotIds = ['scatter-plot', 'amplification-plot', 'protocol-plot'];

    const darkLayout = {
        paper_bgcolor: '#1a1d27',
        plot_bgcolor: '#1a1d27',
        font: { color: '#e4e4e7' },
        'xaxis.gridcolor': '#2d3040',
        'yaxis.gridcolor': '#2d3040',
        'xaxis.zerolinecolor': '#2d3040',
        'yaxis.zerolinecolor': '#2d3040',
        'xaxis.color': '#9ca3af',
        'yaxis.color': '#9ca3af',
    };

    const lightLayout = {
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff',
        font: { color: '#1a1a2e' },
        'xaxis.gridcolor': '#e5e7eb',
        'yaxis.gridcolor': '#e5e7eb',
        'xaxis.zerolinecolor': '#d1d5db',
        'yaxis.zerolinecolor': '#d1d5db',
        'xaxis.color': '#6b7280',
        'yaxis.color': '#6b7280',
    };

    const layout = isDark ? darkLayout : lightLayout;

    for (const id of plotIds) {
        const el = document.getElementById(id);
        if (el && el.data && typeof Plotly !== 'undefined') {
            Plotly.relayout(id, layout).catch(err => {
                console.warn(`Failed to update ${id}:`, err);
            });
        }
    }
}

/**
 * Public function to update charts (can be called after new plots are created)
 */
export function updateChartsTheme() {
    const isDark = document.body.classList.contains(DARK_CLASS);
    updatePlotlyCharts(isDark);
}
