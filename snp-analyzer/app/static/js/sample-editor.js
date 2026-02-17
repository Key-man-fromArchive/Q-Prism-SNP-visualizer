// Sample Name Editor Module
// Provides in-place editing of well sample names with CSV import/export

let sessionId = null;
let sampleNames = {};  // well -> name (local cache)

export function initSampleEditor(sid) {
    sessionId = sid;
    loadSampleNames();
}

async function loadSampleNames() {
    if (!sessionId) return;

    try {
        const res = await fetch(`/api/data/${sessionId}/samples`);
        if (!res.ok) {
            console.warn('No sample names endpoint available');
            return;
        }
        const json = await res.json();
        sampleNames = json.samples || {};
    } catch (err) {
        console.warn('Failed to load sample names:', err);
        sampleNames = {};
    }
}

export function getSampleName(well) {
    return sampleNames[well] || null;
}

// Enable double-click editing on plate wells
export function enablePlateEditing() {
    document.querySelectorAll('.plate-well[data-well]').forEach(el => {
        el.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const well = el.dataset.well;
            showInlineEditor(el, well);
        });
    });
}

function showInlineEditor(wellEl, well) {
    // Remove any existing editor
    const existing = document.getElementById('sample-name-input');
    if (existing) existing.remove();

    const rect = wellEl.getBoundingClientRect();
    const input = document.createElement('input');
    input.id = 'sample-name-input';
    input.type = 'text';
    input.value = sampleNames[well] || '';
    input.placeholder = well;
    input.style.cssText = `
        position: fixed;
        left: ${rect.right + 4}px;
        top: ${rect.top - 4}px;
        width: 120px;
        padding: 4px 8px;
        border: 2px solid var(--primary);
        border-radius: 4px;
        font-size: 12px;
        z-index: 1002;
        background: var(--surface);
        color: var(--text);
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `;

    document.body.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
        const name = input.value.trim();
        if (name) {
            sampleNames[well] = name;
        } else {
            delete sampleNames[well];
        }
        input.remove();

        // Save to backend
        try {
            await fetch(`/api/data/${sessionId}/samples`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ samples: { [well]: name } }),
            });

            // Dispatch event so detail panel can update
            document.dispatchEvent(new CustomEvent('samples-changed', {
                detail: { well, name }
            }));
        } catch (err) {
            console.error('Failed to save sample name:', err);
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') input.remove();
    });

    input.addEventListener('blur', save);
}

// Parse CSV text into {well: name} mapping
export function parseSampleCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const result = {};

    for (const line of lines) {
        if (!line.trim()) continue;

        // Handle CSV with quotes and commas
        const match = line.match(/^([A-H]\d{1,2})\s*,\s*"?([^"]*)"?\s*$/i);
        if (match) {
            const well = match[1].toUpperCase();
            const name = match[2].trim();
            if (well && name && /^[A-H]\d{1,2}$/.test(well)) {
                result[well] = name;
            }
        } else {
            // Simple split fallback
            const parts = line.split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1'));
            if (parts.length >= 2) {
                const well = parts[0].toUpperCase();
                const name = parts.slice(1).join(',').trim();
                if (well && name && /^[A-H]\d{1,2}$/.test(well)) {
                    result[well] = name;
                }
            }
        }
    }

    return result;
}

// Generate CSV string from current sample names
export function exportSampleCSV() {
    const lines = ['Well,Sample Name'];

    // Sort wells by row (A-H) then column (1-12)
    const wells = Object.keys(sampleNames).sort((a, b) => {
        const ra = a[0], rb = b[0];
        const ca = parseInt(a.slice(1)), cb = parseInt(b.slice(1));
        return ra === rb ? ca - cb : ra.localeCompare(rb);
    });

    for (const well of wells) {
        lines.push(`${well},"${sampleNames[well]}"`);
    }

    return lines.join('\n');
}

// Bulk import from CSV text
export async function importSamplesFromCSV(csvText) {
    if (!sessionId) {
        throw new Error('No active session');
    }

    const parsed = parseSampleCSV(csvText);
    Object.assign(sampleNames, parsed);

    try {
        await fetch(`/api/data/${sessionId}/samples`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ samples: parsed }),
        });

        // Notify that samples have changed (all wells affected)
        document.dispatchEvent(new CustomEvent('samples-changed'));

        return Object.keys(parsed).length;
    } catch (err) {
        console.error('Failed to import samples:', err);
        throw err;
    }
}

// Clear all sample names
export async function clearAllSamples() {
    if (!sessionId) return;

    sampleNames = {};

    try {
        await fetch(`/api/data/${sessionId}/samples`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ samples: {} }),
        });

        document.dispatchEvent(new CustomEvent('samples-changed'));
    } catch (err) {
        console.error('Failed to clear samples:', err);
    }
}

// Get all sample names
export function getAllSamples() {
    return { ...sampleNames };
}
