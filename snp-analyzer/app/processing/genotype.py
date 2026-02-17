"""Shared genotype classification logic."""
from __future__ import annotations


def get_effective_types(
    cluster_assignments: dict[str, str],
    manual_assignments: dict[str, str],
    wells: list[str],
) -> dict[str, str]:
    """Merge auto-cluster and manual welltype assignments.
    Manual overrides auto. Returns well -> effective_type."""
    result = {}
    for well in wells:
        manual = manual_assignments.get(well)
        auto = cluster_assignments.get(well)
        result[well] = manual or auto or "Unknown"
    return result


# Genotype categories for allele frequency
GENOTYPED_TYPES = {"Allele 1 Homo", "Allele 2 Homo", "Heterozygous"}
EXCLUDED_TYPES = {"NTC", "Unknown", "Positive Control", "Undetermined"}


def count_genotypes(effective_types: dict[str, str]) -> dict[str, int]:
    """Count genotype categories, excluding NTC/controls.
    Returns dict with keys: 'AA' (Allele 1 Homo), 'BB' (Allele 2 Homo), 'AB' (Heterozygous), 'excluded'."""
    counts = {"AA": 0, "BB": 0, "AB": 0, "excluded": 0}
    for well, gt in effective_types.items():
        if gt == "Allele 1 Homo":
            counts["AA"] += 1
        elif gt == "Allele 2 Homo":
            counts["BB"] += 1
        elif gt == "Heterozygous":
            counts["AB"] += 1
        else:
            counts["excluded"] += 1
    return counts
