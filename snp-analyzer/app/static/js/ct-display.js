/**
 * Ct/Cq display module - shows Ct values in plate wells and detail panel.
 */

let ctData = null;
let sessionId = null;

export function initCtDisplay(sid) {
    sessionId = sid;
}

export async function loadCtData(useRox = true) {
    if (!sessionId) return null;
    try {
        const res = await fetch(`/api/data/${sessionId}/ct?use_rox=${useRox}`);
        if (!res.ok) return null;
        const json = await res.json();
        ctData = json.results;
        return ctData;
    } catch {
        return null;
    }
}

export function getCtData() {
    return ctData;
}

export function getWellCt(well) {
    if (!ctData || !ctData[well]) return null;
    return ctData[well];
}

export function formatCt(ct) {
    if (ct === null || ct === undefined) return "Undet.";
    return ct.toFixed(1);
}

export function renderCtInDetail(well, allele2Dye) {
    const ct = getWellCt(well);
    if (!ct) return "";

    return `
        <tr><td>FAM Ct</td><td>${formatCt(ct.fam_ct)}</td></tr>
        <tr><td>${allele2Dye} Ct</td><td>${formatCt(ct.allele2_ct)}</td></tr>
    `;
}
