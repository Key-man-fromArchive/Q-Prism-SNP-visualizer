"""Central genotype vocabulary, parameterized by ploidy.

Single source of truth for the mapping between allele *dosage* (the canonical,
ploidy-agnostic representation) and the human-readable genotype label strings
used across clustering, statistics, export and the cross-service contract.

Canonical model
---------------
* ``ploidy`` P is the number of allele copies at a locus (2 = diploid ... 8).
* ``dosage`` d is the number of *allele-1* (FAM / "A") copies, an integer in
  ``0..P``. Higher dosage => higher fam-fraction ``r = fam / (fam + allele2)``.
* A locus therefore resolves into ``P + 1`` dosage classes.

Diploid (P=2) keeps its historical label strings verbatim so nothing regresses:
dosage 2 -> "Allele 1 Homo", 1 -> "Heterozygous", 0 -> "Allele 2 Homo".
For higher ploidy the label is the allele-count string (e.g. tetraploid dosage 3
-> "AAAB"); this is the default display convention and can be remapped in the UI
i18n layer without touching the canonical dosage integer.

This module is intentionally free of any clustering logic: it only defines the
vocabulary. The equal-spacing ``default_ratio_cuts`` are a FIRST APPROXIMATION;
the model-based caller refines cut positions from the data (see the handoff doc
``docs/polyploid-genotyping-handoff.md`` Part II).
"""
from __future__ import annotations

MIN_PLOIDY = 2
MAX_PLOIDY = 8
DEFAULT_PLOIDY = 2

# Non-genotype well categories — constant across ploidy. These are the same
# strings historically used in models.WellType; kept here so callers can ask the
# vocabulary "is this a genotype call?" without importing the enum.
CONTROL_TYPES = ("NTC", "Positive Control")
EXCLUDED_TYPES = frozenset(
    {"NTC", "Unknown", "Positive Control", "Undetermined", "Empty", "Omit"}
)

# Diploid legacy labels, indexed by dosage 0..2 (preserved verbatim).
_DIPLOID_LABELS = ("Allele 2 Homo", "Heterozygous", "Allele 1 Homo")


def validate_ploidy(ploidy: int) -> int:
    if not isinstance(ploidy, int) or ploidy < MIN_PLOIDY or ploidy > MAX_PLOIDY:
        raise ValueError(
            f"ploidy must be an integer in [{MIN_PLOIDY}, {MAX_PLOIDY}], got {ploidy!r}"
        )
    return ploidy


def genotype_labels(ploidy: int = DEFAULT_PLOIDY) -> list[str]:
    """Ordered dosage-class labels; index == dosage (0..ploidy). Length ploidy+1."""
    validate_ploidy(ploidy)
    if ploidy == 2:
        return list(_DIPLOID_LABELS)
    # allele-count string: d copies of A (allele-1), (P-d) of B (allele-2).
    return ["A" * d + "B" * (ploidy - d) for d in range(ploidy + 1)]


def genotype_label(dosage: int, ploidy: int = DEFAULT_PLOIDY) -> str:
    labels = genotype_labels(ploidy)
    if not 0 <= dosage <= ploidy:
        raise ValueError(f"dosage {dosage} out of range for ploidy {ploidy}")
    return labels[dosage]


def dosage_of_label(label: str, ploidy: int = DEFAULT_PLOIDY) -> int | None:
    """Reverse-map a genotype label to its dosage; None if not a genotype label."""
    try:
        return genotype_labels(ploidy).index(label)
    except ValueError:
        return None


def genotyped_types(ploidy: int = DEFAULT_PLOIDY) -> frozenset[str]:
    """Set of labels that count as a genotype call (not a control / no-call)."""
    return frozenset(genotype_labels(ploidy))


def default_ratio_cuts(ploidy: int = DEFAULT_PLOIDY) -> list[float]:
    """Descending fam-fraction boundaries between adjacent dosages, at the
    midpoints ``(d + 0.5) / P``. Equal-spacing FIRST APPROXIMATION only; the
    model-based caller (Phase 1+) refines cut positions from the data."""
    validate_ploidy(ploidy)
    return [(d + 0.5) / ploidy for d in range(ploidy - 1, -1, -1)]


def dosage_by_ratio(
    r: float, ploidy: int = DEFAULT_PLOIDY, cuts: list[float] | None = None
) -> int:
    """Dosage (0..P) for fam-fraction ``r`` given descending boundary ``cuts``.

    ``dosage = number of cuts that r meets or exceeds``. With the default cuts a
    well near the FAM axis (r->1) gets the highest dosage (all allele-1 copies)
    and a well near the allele-2 axis (r->0) gets dosage 0.
    """
    if cuts is None:
        cuts = default_ratio_cuts(ploidy)
    return sum(1 for c in cuts if r >= c)


def label_by_ratio(
    r: float, ploidy: int = DEFAULT_PLOIDY, cuts: list[float] | None = None
) -> str:
    return genotype_label(dosage_by_ratio(r, ploidy, cuts), ploidy)
