import { runClustering, setAutoClusterVisible, setManualTypesVisible, isAutoClusterVisible, isManualTypesVisible } from "./clustering.js";

const STORAGE_KEY = "snp-analyzer-settings";

const DEFAULTS = {
    fixAxis: false,
    xMax: 12,
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

    // Default: ON for QuantStudio, OFF for Bio-Rad/CFX
    let useRox = settings.useRox;
    if (useRox === null || useRox === undefined) {
        const instrument = (sessionInfo.instrument || "").toLowerCase();
        useRox = instrument.includes("quantstudio");
    }

    roxCheckbox.checked = useRox;

    roxCheckbox.addEventListener("change", () => {
        persist();
    });
}

function persist() {
    const roxCheckbox = document.getElementById("rox-normalize-checkbox");
    const settings = {
        fixAxis: document.getElementById("fix-axis-checkbox").checked,
        xMax: parseFloat(document.getElementById("x-axis-max").value) || DEFAULTS.xMax,
        yMax: parseFloat(document.getElementById("y-axis-max").value) || DEFAULTS.yMax,
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
