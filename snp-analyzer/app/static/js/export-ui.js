/**
 * Export UI Module
 * Handles CSV download, PNG export, and print functionality
 */

let sessionId = null;

/**
 * Initialize export UI and wire up button handlers
 * @param {string} sid - Session ID
 */
export function initExportUI(sid) {
    sessionId = sid;

    // Wire up export button click handlers
    const csvBtn = document.getElementById("export-csv-btn");
    const pngBtn = document.getElementById("export-png-btn");
    const printBtn = document.getElementById("export-print-btn");

    if (csvBtn) {
        csvBtn.addEventListener("click", downloadCSV);
    }

    if (pngBtn) {
        pngBtn.addEventListener("click", exportPNG);
    }

    if (printBtn) {
        printBtn.addEventListener("click", printReport);
    }
}

/**
 * Download results as CSV file
 */
export async function downloadCSV() {
    if (!sessionId) {
        console.error("No session ID available for CSV export");
        return;
    }

    try {
        // Fetch CSV data from backend
        const res = await fetch(`/api/data/${sessionId}/export/csv`);

        if (!res.ok) {
            throw new Error(`Failed to export CSV: ${res.statusText}`);
        }

        // Create blob URL and trigger download
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `snp-results-${sessionId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("CSV export failed:", err);
        alert(`CSV export failed: ${err.message}`);
    }
}

/**
 * Export scatter plot as PNG image
 */
export async function exportPNG() {
    const scatterDiv = document.getElementById("scatter-plot");

    if (!scatterDiv || !scatterDiv.data || scatterDiv.data.length === 0) {
        alert("No scatter plot data available to export");
        return;
    }

    try {
        // Use Plotly.toImage to export as PNG
        const imgData = await Plotly.toImage(scatterDiv, {
            format: "png",
            width: 1200,
            height: 900,
            scale: 2
        });

        // Create download link
        const a = document.createElement("a");
        a.href = imgData;
        a.download = `scatter-plot-${sessionId || "export"}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        console.error("PNG export failed:", err);
        alert(`PNG export failed: ${err.message}`);
    }
}

/**
 * Trigger browser print dialog
 */
export function printReport() {
    window.print();
}
