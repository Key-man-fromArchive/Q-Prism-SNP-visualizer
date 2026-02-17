import { runClustering, setAutoClusterVisible, setManualTypesVisible, isAutoClusterVisible, isManualTypesVisible } from "./clustering.js";

const STORAGE_KEY = "snp-analyzer-settings";

const DEFAULTS = {
    fixAxis: false,
    xMin: 0,
    xMax: 12,
    yMin: 0,
    yMax: 12,
    useRox: null,  // null = auto (ON for QuantStudio, OFF for Bio-Rad)
};

let onChangeCallback = null;
let currentSessionId = null;

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

export function getUseRox() {
    return load().useRox ?? true;
}

export function initSettings(callback, sessionId, sessionInfo) {
    onChangeCallback = callback;
    currentSessionId = sessionId;

    const settings = load();

    const fixCheckbox = document.getElementById("fix-axis-checkbox");
    const xMinInput = document.getElementById("x-axis-min");
    const xMaxInput = document.getElementById("x-axis-max");
    const yMinInput = document.getElementById("y-axis-min");
    const yMaxInput = document.getElementById("y-axis-max");

    fixCheckbox.checked = settings.fixAxis;
    xMinInput.value = settings.xMin;
    xMaxInput.value = settings.xMax;
    yMinInput.value = settings.yMin;
    yMaxInput.value = settings.yMax;

    // Toggle disabled state of inputs
    const toggleDisabled = (on) => {
        xMinInput.disabled = !on;
        xMaxInput.disabled = !on;
        yMinInput.disabled = !on;
        yMaxInput.disabled = !on;
    };
    toggleDisabled(settings.fixAxis);

    fixCheckbox.addEventListener("change", () => {
        toggleDisabled(fixCheckbox.checked);
        persist();
    });

    xMinInput.addEventListener("input", persist);
    xMaxInput.addEventListener("input", persist);
    yMinInput.addEventListener("input", persist);
    yMaxInput.addEventListener("input", persist);

    // ROX normalization toggle
    initRoxToggle(settings, sessionInfo);

    // Clustering controls
    initClusteringControls();
}

function initRoxToggle(settings, sessionInfo) {
    const roxCheckbox = document.getElementById("rox-normalize-checkbox");
    const roxGroup = document.getElementById("rox-normalize-group");
    if (!roxCheckbox || !roxGroup) return;

    const hasRox = sessionInfo && sessionInfo.has_rox;
    if (!hasRox) {
        // No ROX data available — hide the toggle entirely
        roxGroup.classList.add("hidden");
        return;
    }
    roxGroup.classList.remove("hidden");

    // Always derive default from instrument on each new upload
    // (stale localStorage from a prior session must not override)
    const instrument = (sessionInfo.instrument || "").toLowerCase();
    const useRox = instrument.includes("quantstudio");
    roxCheckbox.checked = useRox;

    // Save instrument-appropriate default so getUseRox() reads correctly
    persist();

    roxCheckbox.addEventListener("change", () => {
        persist();
    });
}

function numOrDefault(val, def) {
    const n = parseFloat(val);
    return Number.isNaN(n) ? def : n;
}

function persist() {
    const roxCheckbox = document.getElementById("rox-normalize-checkbox");
    const settings = {
        fixAxis: document.getElementById("fix-axis-checkbox").checked,
        xMin: numOrDefault(document.getElementById("x-axis-min").value, DEFAULTS.xMin),
        xMax: numOrDefault(document.getElementById("x-axis-max").value, DEFAULTS.xMax),
        yMin: numOrDefault(document.getElementById("y-axis-min").value, DEFAULTS.yMin),
        yMax: numOrDefault(document.getElementById("y-axis-max").value, DEFAULTS.yMax),
        useRox: roxCheckbox ? roxCheckbox.checked : true,
    };
    save(settings);
    if (onChangeCallback) onChangeCallback();
}

function initClusteringControls() {
    const algoRadios = document.querySelectorAll('input[name="cluster-algo"]');
    const thresholdSection = document.getElementById("threshold-config");
    const kmeansSection = document.getElementById("kmeans-config");
    const runBtn = document.getElementById("run-clustering-btn");
    const showAutoCheckbox = document.getElementById("show-auto-cluster");
    const showManualCheckbox = document.getElementById("show-manual-types");

    if (!runBtn) return;

    // Algorithm radio toggle
    algoRadios.forEach(radio => {
        radio.addEventListener("change", () => {
            const algo = document.querySelector('input[name="cluster-algo"]:checked').value;
            thresholdSection.classList.toggle("hidden", algo !== "threshold");
            kmeansSection.classList.toggle("hidden", algo !== "kmeans");
        });
    });

    // Run clustering button
    runBtn.addEventListener("click", async () => {
        if (!currentSessionId) return;

        const algo = document.querySelector('input[name="cluster-algo"]:checked').value;
        const params = { algorithm: algo, cycle: 0 };

        if (algo === "threshold") {
            params.threshold_config = {
                ntc_threshold: parseFloat(document.getElementById("ntc-threshold").value) || 0.1,
                allele1_ratio_max: parseFloat(document.getElementById("allele1-ratio-max").value) || 0.4,
                allele2_ratio_min: parseFloat(document.getElementById("allele2-ratio-min").value) || 0.6,
            };
        } else {
            params.n_clusters = parseInt(document.getElementById("n-clusters").value) || 4;
        }

        runBtn.disabled = true;
        runBtn.textContent = "Running...";
        try {
            await runClustering(currentSessionId, params);
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = "Run Auto Clustering";
        }
    });

    // Layer toggle checkboxes
    showAutoCheckbox.checked = isAutoClusterVisible();
    showManualCheckbox.checked = isManualTypesVisible();

    showAutoCheckbox.addEventListener("change", () => {
        setAutoClusterVisible(showAutoCheckbox.checked);
    });

    showManualCheckbox.addEventListener("change", () => {
        setManualTypesVisible(showManualCheckbox.checked);
    });
}
