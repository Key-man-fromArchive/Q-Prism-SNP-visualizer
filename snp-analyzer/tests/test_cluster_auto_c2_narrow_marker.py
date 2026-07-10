"""C2 regression: a narrow, genuinely monomorphic marker must not be over-split
into spurious adjacent dosage classes by BIC at high ploidy, while a genuinely
wide multi-dosage marker must still resolve all of its real dosage classes.

Mirrors the real two-marker hexaploid plate: qTotal11.1 (narrow, monomorphic)
and qSwet5.3 (wide, 3 real dosage classes). See tests/fixtures_multimarker.py.
"""
from __future__ import annotations

from app.processing.clustering import cluster_auto
from app.processing.genotype_vocab import EXCLUDED_TYPES
from fixtures_multimarker import qswet_points, qtotal_points


def _distinct_genotype_labels(assignments: dict[str, str]) -> set[str]:
    return {v for v in assignments.values() if v not in EXCLUDED_TYPES}


def test_narrow_marker_calls_single_dosage_monomorphic():
    assign, _ = cluster_auto(qtotal_points(), ploidy=6)
    labels = _distinct_genotype_labels(assign)
    assert len(labels) == 1, f"expected 1 monomorphic dosage class, got {labels}"


def test_wide_marker_still_resolves_multiple_dosages_no_regression():
    assign, _ = cluster_auto(qswet_points(), ploidy=6)
    labels = _distinct_genotype_labels(assign)
    assert len(labels) >= 3, f"expected >=3 dosage classes, got {labels}"
