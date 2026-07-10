"""C1: allele-control ANCHORING.

Genotype dosage offset is often unidentifiable from fluorescence alone (e.g.
sweetpotato-6x markers resolving 3 mid classes that could equally be dosages
0,1,2 or 4,5,6 -- see ``estimate_window`` / ``genotype_window``). A homozygous
ALLELE-1 CONTROL (ratio -> 1, dosage = ploidy) and/or ALLELE-2 CONTROL (ratio
-> 0, dosage 0) resolves this: they are INPUT roles (distinct from the
ALLELE1_HOMO/ALLELE2_HOMO RESULT labels a sample well can be genotyped as),
excluded from the clustering fit like NTC/Positive Control, but used to fix
the dosage offset so it is no longer a guess.

Scope: extreme homozygous controls only (dosage 0 / ploidy). Intermediate
heterozygous dosage-specific controls are out of scope (deferred).
"""
from __future__ import annotations

from app.models import WellType
from app.processing.clustering import cluster_auto, genotype_window
from app.processing.genotype_vocab import genotype_label

PLOIDY = 6


def _pts(prefix: str, ratios: list[float], total: float = 1000.0) -> list[dict]:
    return [
        {"well": f"{prefix}{i}", "norm_fam": r * total, "norm_allele2": (1 - r) * total}
        for i, r in enumerate(ratios)
    ]


def _mid_class_points() -> list[dict]:
    """3 real, well-separated dosage clusters at ratios ~0.33/0.50/0.67 (mid of
    the 0..6 ladder) -- ambiguous, from fluorescence alone, whether they sit at
    the bottom, middle, or top of the full dosage window (offset_uncertain)."""
    low = [0.30, 0.315, 0.33, 0.345, 0.36]
    mid = [0.47, 0.485, 0.50, 0.515, 0.53]
    high = [0.64, 0.655, 0.67, 0.685, 0.70]
    return _pts("LO", low) + _pts("MID", mid) + _pts("HI", high)


def _allele1_control(ratio: float = 0.97) -> dict:
    return {"well": "A1CTRL", "norm_fam": ratio * 1000.0, "norm_allele2": (1 - ratio) * 1000.0}


def _allele2_control(ratio: float = 0.03) -> dict:
    return {"well": "A2CTRL", "norm_fam": ratio * 1000.0, "norm_allele2": (1 - ratio) * 1000.0}


def _sample_labels(assignments: dict[str, str]) -> set[str]:
    controls = {
        WellType.NTC.value,
        WellType.POSITIVE_CONTROL.value,
        WellType.ALLELE1_CONTROL.value,
        WellType.ALLELE2_CONTROL.value,
        WellType.UNDETERMINED.value,
    }
    return {v for v in assignments.values() if v not in controls}


def test_no_anchor_regression_offset_uncertain_stays_true():
    """Same samples, NO controls: behaves exactly as today (offset ambiguous)."""
    pts = _mid_class_points()
    warnings: list[str] = []
    assign, _conf = cluster_auto(pts, ploidy=PLOIDY, warnings=warnings)
    win = genotype_window(pts, assign, ploidy=PLOIDY)

    assert win["offset_uncertain"] is True
    assert "anchor_conflict" not in warnings


def test_allele_control_anchors_determine_offset():
    """WITH allele-1 (ratio~0.97) and allele-2 (ratio~0.03) controls: the
    offset becomes DETERMINED, and the top/bottom sample classes map to the
    anchored dosages (ploidy and 0, respectively)."""
    pts = _mid_class_points() + [_allele1_control(), _allele2_control()]
    control_wells = {
        "A1CTRL": WellType.ALLELE1_CONTROL.value,
        "A2CTRL": WellType.ALLELE2_CONTROL.value,
    }
    warnings: list[str] = []
    anchor_state: dict = {}

    assign, conf = cluster_auto(
        pts,
        ploidy=PLOIDY,
        control_wells=control_wells,
        warnings=warnings,
        anchor_state=anchor_state,
    )

    # No conflict; the anchors were actually used.
    assert "anchor_conflict" not in warnings
    assert anchor_state.get("resolved") is True

    # Control wells get their OWN result label (input role, not a sample
    # genotype) -- mirrors how NTC / Positive Control are handled.
    assert assign["A1CTRL"] == WellType.ALLELE1_CONTROL.value
    assert assign["A2CTRL"] == WellType.ALLELE2_CONTROL.value
    assert conf["A1CTRL"] == 1.0
    assert conf["A2CTRL"] == 1.0

    win = genotype_window(pts, assign, ploidy=PLOIDY, anchor_resolved=True)
    assert win["offset_uncertain"] is False

    # Top/bottom sample classes are labeled at the anchored dosage extremes.
    top_label = genotype_label(PLOIDY, PLOIDY)
    bottom_label = genotype_label(0, PLOIDY)
    sample_labels = _sample_labels(assign)
    assert top_label in sample_labels
    assert bottom_label in sample_labels
    assert win["offset"] == 0


def test_anchor_conflict_flagged_when_far_from_any_cluster():
    """An allele-1 control sitting far from every fitted sample cluster is
    flagged, and NOT allowed to silently override the offset."""
    # A single, tight, genuinely monomorphic mid-range cluster.
    mono = [0.49, 0.495, 0.50, 0.505, 0.51]
    pts = _pts("S", mono) + [_allele1_control(ratio=0.95)]
    control_wells = {"A1CTRL": WellType.ALLELE1_CONTROL.value}
    warnings: list[str] = []
    anchor_state: dict = {}

    assign, _conf = cluster_auto(
        pts,
        ploidy=PLOIDY,
        control_wells=control_wells,
        warnings=warnings,
        anchor_state=anchor_state,
    )

    assert "anchor_conflict" in warnings
    # The conflicting anchor did not resolve/override the offset.
    assert anchor_state.get("resolved") is False
    # Still labeled as its own control role (never dropped/relabeled).
    assert assign["A1CTRL"] == WellType.ALLELE1_CONTROL.value
