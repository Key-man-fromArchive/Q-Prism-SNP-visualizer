export const WELL_TYPES = {
    NTC:              { label: "NTC",              color: "#000000", symbol: "square" },
    Unknown:          { label: "Unknown",          color: "#a3a3a3", symbol: "diamond" },
    "Positive Control": { label: "Positive Control", color: "#f59e0b", symbol: "star" },
    "Allele 1 Homo":  { label: "Allele 1 Homo",   color: "#dc2626", symbol: "circle" },
    "Allele 2 Homo":  { label: "Allele 2 Homo",   color: "#2563eb", symbol: "circle" },
    Heterozygous:     { label: "Heterozygous",     color: "#16a34a", symbol: "circle" },
    Undetermined:     { label: "Undetermined",     color: "#000000", symbol: "x" },
};

export const UNASSIGNED = { label: "Unassigned", color: "#6b7280", symbol: "circle" };

export function getWellTypeInfo(type) {
    return WELL_TYPES[type] || UNASSIGNED;
}

export function effectiveType(autoCluster, manualType, showAuto, showManual) {
    if (showManual && manualType) return manualType;
    if (showAuto && autoCluster) return autoCluster;
    return null;
}
