const STORAGE_KEY = "snp-analyzer-settings";

const DEFAULTS = {
    fixAxis: false,
    xMax: 12,
    yMax: 12,
};

let onChangeCallback = null;

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...DEFAULTS };
}

function save(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getAxisSettings() {
    return load();
}

export function initSettings(callback) {
    onChangeCallback = callback;

    const settings = load();

    const fixCheckbox = document.getElementById("fix-axis-checkbox");
    const xMaxInput = document.getElementById("x-axis-max");
    const yMaxInput = document.getElementById("y-axis-max");

    fixCheckbox.checked = settings.fixAxis;
    xMaxInput.value = settings.xMax;
    yMaxInput.value = settings.yMax;

    // Toggle disabled state of inputs
    xMaxInput.disabled = !settings.fixAxis;
    yMaxInput.disabled = !settings.fixAxis;

    fixCheckbox.addEventListener("change", () => {
        xMaxInput.disabled = !fixCheckbox.checked;
        yMaxInput.disabled = !fixCheckbox.checked;
        persist();
    });

    xMaxInput.addEventListener("input", persist);
    yMaxInput.addEventListener("input", persist);
}

function persist() {
    const settings = {
        fixAxis: document.getElementById("fix-axis-checkbox").checked,
        xMax: parseFloat(document.getElementById("x-axis-max").value) || DEFAULTS.xMax,
        yMax: parseFloat(document.getElementById("y-axis-max").value) || DEFAULTS.yMax,
    };
    save(settings);
    if (onChangeCallback) onChangeCallback();
}
