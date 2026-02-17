let clusterAssignments = {};
let manualAssignments = {};
let showAutoCluster = true;
let showManualTypes = true;

export function getClusterAssignments() { return clusterAssignments; }
export function getManualAssignments() { return manualAssignments; }
export function isAutoClusterVisible() { return showAutoCluster; }
export function isManualTypesVisible() { return showManualTypes; }

export function setAutoClusterVisible(v) {
    showAutoCluster = v;
    document.dispatchEvent(new CustomEvent("clustering-changed"));
}

export function setManualTypesVisible(v) {
    showManualTypes = v;
    document.dispatchEvent(new CustomEvent("welltypes-changed"));
}

export async function runClustering(sessionId, params) {
    const res = await fetch(`/api/data/${sessionId}/cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    });
    const json = await res.json();
    clusterAssignments = json.assignments || {};
    document.dispatchEvent(new CustomEvent("clustering-changed"));
    return json;
}

export async function loadClustering(sessionId) {
    const res = await fetch(`/api/data/${sessionId}/cluster`);
    const json = await res.json();
    clusterAssignments = json.assignments || {};
    return json;
}

export async function setManualWellTypes(sessionId, wells, wellType) {
    const res = await fetch(`/api/data/${sessionId}/welltypes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wells, well_type: wellType }),
    });
    const json = await res.json();
    manualAssignments = json.assignments || {};
    document.dispatchEvent(new CustomEvent("welltypes-changed"));
    return json;
}

export async function loadManualWellTypes(sessionId) {
    const res = await fetch(`/api/data/${sessionId}/welltypes`);
    const json = await res.json();
    manualAssignments = json.assignments || {};
    return json;
}

export async function clearManualWellTypes(sessionId) {
    await fetch(`/api/data/${sessionId}/welltypes`, { method: "DELETE" });
    manualAssignments = {};
    document.dispatchEvent(new CustomEvent("welltypes-changed"));
}
