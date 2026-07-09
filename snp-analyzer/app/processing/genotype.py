"""Shared genotype classification logic."""
from __future__ import annotations

from app.processing.genotype_vocab import (
    DEFAULT_PLOIDY,
    genotype_labels,
    genotyped_types,
)


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


# Genotype categories for allele frequency. Kept as module constants for
# backward compatibility (diploid); the ploidy-aware source of truth lives in
# app.processing.genotype_vocab.
GENOTYPED_TYPES = set(genotyped_types(2))            # {"Allele 1 Homo","Allele 2 Homo","Heterozygous"}
EXCLUDED_TYPES = {"NTC", "Unknown", "Positive Control", "Undetermined"}


def count_genotypes(
    effective_types: dict[str, str], ploidy: int = DEFAULT_PLOIDY
) -> dict[str, int]:
    """Count genotype categories, excluding NTC/controls.

    Diploid (ploidy=2, the default) preserves the historical contract: keys
    'AA' (Allele 1 Homo), 'BB' (Allele 2 Homo), 'AB' (Heterozygous), 'excluded'.

    For higher ploidy the counts are keyed by dosage-class label (dosage 0..P,
    e.g. "AAAB") plus 'excluded'."""
    if ploidy == 2:
        counts = {"AA": 0, "BB": 0, "AB": 0, "excluded": 0}
        for gt in effective_types.values():
            if gt == "Allele 1 Homo":
                counts["AA"] += 1
            elif gt == "Allele 2 Homo":
                counts["BB"] += 1
            elif gt == "Heterozygous":
                counts["AB"] += 1
            else:
                counts["excluded"] += 1
        return counts

    labels = genotype_labels(ploidy)
    counts = {label: 0 for label in labels}
    counts["excluded"] = 0
    for gt in effective_types.values():
        if gt in counts and gt != "excluded":
            counts[gt] += 1
        else:
            counts["excluded"] += 1
    return counts
