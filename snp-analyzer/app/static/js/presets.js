/**
 * Assay Preset System — load/save/apply presets for clustering and display settings.
 */

let presetsData = [];

export async function loadPresets() {
    try {
        const res = await fetch("/api/presets");
        if (!res.ok) return;
        const json = await res.json();
        presetsData = json.presets || [];
        renderPresetDropdown();
    } catch {
        // ignore
    }
}

export function getPresets() {
    return presetsData;
}

function renderPresetDropdown() {
    const select = document.getElementById("preset-select");
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Preset --</option>';
    for (const p of presetsData) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name + (p.builtin ? " (built-in)" : "");
        select.appendChild(opt);
    }
}

export function applyPreset(presetId) {
    const preset = presetsData.find(p => p.id === presetId);
    if (!preset) return;

    const s = preset.settings;

    // Apply clustering settings
    const algoRadio = document.querySelector(`input[name="cluster-algo"][value="${s.algorithm || 'threshold'}"]`);
    if (algoRadio) {
        algoRadio.checked = true;
        algoRadio.dispatchEvent(new Event("change", { bubbles: true }));
    }

    setInputValue("ntc-threshold", s.ntc_threshold);
    setInputValue("allele1-ratio-max", s.allele1_ratio_max);
    setInputValue("allele2-ratio-min", s.allele2_ratio_min);
    setInputValue("n-clusters", s.n_clusters);

    // Apply axis settings
    const fixCheckbox = document.getElementById("fix-axis-checkbox");
    if (fixCheckbox && s.fix_axis !== undefined) {
        fixCheckbox.checked = s.fix_axis;
        fixCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setInputValue("x-axis-min", s.x_min);
    setInputValue("x-axis-max", s.x_max);
    setInputValue("y-axis-min", s.y_min);
    setInputValue("y-axis-max", s.y_max);

    // Apply ROX
    const roxCheckbox = document.getElementById("rox-normalize-checkbox");
    if (roxCheckbox && s.use_rox !== undefined) {
        roxCheckbox.checked = s.use_rox;
        roxCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

export function getCurrentSettings() {
    return {
        algorithm: document.querySelector('input[name="cluster-algo"]:checked')?.value || "threshold",
        ntc_threshold: parseFloat(document.getElementById("ntc-threshold")?.value) || 0.1,
        allele1_ratio_max: parseFloat(document.getElementById("allele1-ratio-max")?.value) || 0.4,
        allele2_ratio_min: parseFloat(document.getElementById("allele2-ratio-min")?.value) || 0.6,
        n_clusters: parseInt(document.getElementById("n-clusters")?.value) || 4,
        use_rox: document.getElementById("rox-normalize-checkbox")?.checked ?? true,
        fix_axis: document.getElementById("fix-axis-checkbox")?.checked ?? false,
        x_min: parseFloat(document.getElementById("x-axis-min")?.value) || 0,
        x_max: parseFloat(document.getElementById("x-axis-max")?.value) || 12,
        y_min: parseFloat(document.getElementById("y-axis-min")?.value) || 0,
        y_max: parseFloat(document.getElementById("y-axis-max")?.value) || 12,
    };
}

export async function saveCurrentAsPreset(name) {
    const settings = getCurrentSettings();
    try {
        const res = await fetch("/api/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, settings }),
        });
        if (!res.ok) throw new Error("Failed to save preset");
        await loadPresets();
        return true;
    } catch {
        return false;
    }
}

export async function deletePreset(presetId) {
    try {
        const res = await fetch(`/api/presets/${presetId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete");
        await loadPresets();
        return true;
    } catch {
        return false;
    }
}
