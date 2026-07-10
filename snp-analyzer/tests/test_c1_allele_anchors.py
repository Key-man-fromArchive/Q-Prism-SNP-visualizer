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
    """3 real, well-separated dosage clusters at ratios ~0.20/0.50/0.80.

    From fluorescence alone this is ambiguous: the least-squares window fit
    places them at dosages 1/3/5 but CANNOT confirm the absolute offset (no
    cluster hugs an axis extreme), so offset_uncertain is True. The extreme
    dosage classes (0 and 6) are ABSENT -- exactly the polyploid case where
    snapping the top cluster onto an allele-1 control's dosage 6 would
    mislabel a dosage-5 class."""
    low = [0.185, 0.20, 0.215]
    mid = [0.485, 0.50, 0.515]
    high = [0.785, 0.80, 0.815]
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
    offset becomes DETERMINED (offset_uncertain False), and the sample clusters
    map to the SAME dosages the no-anchor path finds (1/3/5) -- the anchors set
    the ratio->dosage SCALE, they do NOT force the extreme clusters onto the
    absent dosages 0 and 6."""
    samples = _mid_class_points()
    pts = samples + [_allele1_control(), _allele2_control()]
    control_wells = {
        "A1CTRL": WellType.ALLELE1_CONTROL.value,
        "A2CTRL": WellType.ALLELE2_CONTROL.value,
    }

    # Baseline: the SAME samples with no controls resolve labels 1/3/5 but with
    # an UNCERTAIN offset.
    base_assign, _ = cluster_auto(samples, ploidy=PLOIDY)
    base_win = genotype_window(samples, base_assign, ploidy=PLOIDY)
    assert base_win["offset_uncertain"] is True
    base_labels = _sample_labels(base_assign)

    warnings: list[str] = []
    anchor_state: dict = {}
    assign, conf = cluster_auto(
        pts,
        ploidy=PLOIDY,
        control_wells=control_wells,
        warnings=warnings,
        anchor_state=anchor_state,
    )

    # No conflict; the anchors were actually used to fix the scale.
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

    # SAME labels as the no-anchor path (dosages 1/3/5), just now determined --
    # NOT relabelled to the absent extremes (dosage 6 / dosage 0).
    sample_labels = _sample_labels(assign)
    assert sample_labels == base_labels
    assert genotype_label(5, PLOIDY) in sample_labels  # top cluster = AAAAAB (5), not AAAAAA (6)
    assert genotype_label(1, PLOIDY) in sample_labels  # bottom cluster = ABBBBB (1), not BBBBBB (0)
    assert genotype_label(PLOIDY, PLOIDY) not in sample_labels
    assert genotype_label(0, PLOIDY) not in sample_labels
    assert win["offset"] == 1


def test_far_but_consistent_anchor_resolves_without_conflict():
    """An allele-1 control far from a monomorphic mid-range cluster is the
    normal 'extreme dosage absent' case -- it must resolve the offset cleanly
    (no anchor_conflict), NOT be treated as a disagreement."""
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

    assert "anchor_conflict" not in warnings
    assert anchor_state.get("resolved") is True
    win = genotype_window(pts, assign, ploidy=PLOIDY, anchor_resolved=True)
    assert win["offset_uncertain"] is False
    # r~0.50 on a ladder whose dosage-6 sits at r~0.95 -> dosage 3 (AAABBB).
    assert assign["A1CTRL"] == WellType.ALLELE1_CONTROL.value
    assert genotype_label(3, PLOIDY) in _sample_labels(assign)


def test_inverted_anchors_flag_conflict():
    """Anchors are INCONSISTENT when allele-1 (should be high fam-fraction) is
    not above allele-2 (should be low): an inverted/degenerate scale. Flag
    'anchor_conflict' and do NOT let them set the offset (fall back to the
    uncertain no-anchor result)."""
    samples = _mid_class_points()
    # Inverted: allele-1 control at the LOW extreme, allele-2 at the HIGH.
    pts = samples + [_allele1_control(ratio=0.03), _allele2_control(ratio=0.97)]
    control_wells = {
        "A1CTRL": WellType.ALLELE1_CONTROL.value,
        "A2CTRL": WellType.ALLELE2_CONTROL.value,
    }
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
    assert anchor_state.get("resolved") is False
    # Controls keep their own role labels; offset falls back to uncertain.
    assert assign["A1CTRL"] == WellType.ALLELE1_CONTROL.value
    assert assign["A2CTRL"] == WellType.ALLELE2_CONTROL.value
    win = genotype_window(pts, assign, ploidy=PLOIDY, anchor_resolved=False)
    assert win["offset_uncertain"] is True
