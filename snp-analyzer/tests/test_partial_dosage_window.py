"""A polyploid marker usually shows only part of its dosage ladder.

Field fact this covers: a hexaploid assay commonly tops out at dosage 3, so
the classes actually present are 0,1,2,3 out of 0..6 -- not the full seven.
The caller has to (a) label those four as 0,1,2,3 rather than stretching them
across the ladder, and (b) let the operator correct the window's absolute
POSITION when fluorescence cannot fix it, without giving up the fit.

(b) is the part that was missing. ``estimate_window`` reports
``offset_uncertain`` exactly when no cluster hugs an axis extreme -- which is
the normal case for a window like 1,2,3 -- but ``ThresholdConfig.offset`` only
had an effect on the manual-boundary branch, so the only way to move the
window was to also freeze the radial cuts into an override, discarding the
mixture fit in order to relabel it.
"""
from __future__ import annotations

from collections import Counter

import pytest

from app.models import ClusteringAlgorithm, ThresholdConfig
from app.processing.clustering import cluster_auto, estimate_window, genotype_window
from app.processing.genotype_vocab import genotype_label

# FAM-side amplification bias, as in the built-in example plates: real clusters
# sit off the exact d/P grid, so none of this is testing an idealised ladder.
_ALPHA = 1.25


def _biased(dosage: int, ploidy: int) -> float:
    x = dosage / ploidy
    return (_ALPHA * x) / (_ALPHA * x + (1 - x)) if 0 < x < 1 else x


def _points(dosages: list[int], ploidy: int, per: int = 12, total: float = 1000.0):
    """One deterministic cluster per dosage, with per-well ratio noise."""
    out = []
    for i, d in enumerate(dosages):
        for j in range(per):
            noise = ((i * 7 + j * 13) % 21 - 10) / 10.0 * 0.012
            r = min(max(_biased(d, ploidy) + noise, 0.0), 1.0)
            out.append(
                {"well": f"d{d}_{j}", "norm_fam": r * total, "norm_allele2": (1 - r) * total}
            )
    return out


def _labels(dosages: list[int], ploidy: int) -> set[str]:
    return {genotype_label(d, ploidy) for d in dosages}


# ---------------------------------------------------------------------------
# Labelling a partial window
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "ploidy,dosages",
    [
        (6, [0, 1, 2, 3]),   # the common hexaploid case
        (6, [0, 1, 2]),
        (6, [1, 2, 3]),      # bottom class absent too -- position unanchored
        (6, [3, 4, 5, 6]),
        (6, [0, 1, 2, 3, 4, 5, 6]),
        (4, [0, 1, 2]),
        (8, [0, 1, 2, 3]),
    ],
)
def test_only_the_dosages_present_are_called(ploidy, dosages):
    assignments, _ = cluster_auto(_points(dosages, ploidy), ploidy=ploidy)
    assert set(assignments.values()) == _labels(dosages, ploidy)


def test_a_bottom_anchored_window_is_not_flagged_uncertain():
    """0,1,2,3 of 6 has a class ON the allele-2 axis, so the position IS
    identifiable and the operator should not be asked to confirm it."""
    ratios = [_biased(d, 6) for d in (0, 1, 2, 3)]
    offset, step, uncertain = estimate_window(ratios, 6)
    assert (offset, step) == (0, 1)
    assert uncertain is False


def test_a_floating_window_is_flagged_uncertain():
    """1,2,3 of 6 touches neither axis: 1,2,3 and 2,3,4 (and more) fit equally
    well, so the estimate is a guess and says so."""
    ratios = [_biased(d, 6) for d in (1, 2, 3)]
    _offset, _step, uncertain = estimate_window(ratios, 6)
    assert uncertain is True


# ---------------------------------------------------------------------------
# Correcting the window position without discarding the fit
# ---------------------------------------------------------------------------

def test_the_operator_can_move_the_window_on_the_auto_calls():
    """The same clusters, relabelled 3,4,5 instead of 1,2,3 -- fit untouched."""
    points = _points([1, 2, 3], 6)

    auto, _ = cluster_auto(points, ploidy=6)
    assert set(auto.values()) == _labels([1, 2, 3], 6)

    moved, _ = cluster_auto(points, ploidy=6, offset_override=3)
    assert set(moved.values()) == _labels([3, 4, 5], 6)

    # Same wells in the same clusters -- only the names changed.
    auto_groups = {frozenset(w for w, lab in auto.items() if lab == g) for g in set(auto.values())}
    moved_groups = {frozenset(w for w, lab in moved.items() if lab == g) for g in set(moved.values())}
    assert auto_groups == moved_groups


def test_moving_the_window_keeps_the_class_spacing():
    """A window with step 2 (every other dosage) slides as a whole; the
    override sets where it starts, not how the classes are spaced."""
    points = _points([0, 2, 4], 6)
    moved, _ = cluster_auto(points, ploidy=6, offset_override=2)
    assert set(moved.values()) == _labels([2, 4, 6], 6)


def test_a_window_pushed_past_the_top_lands_flush_against_it():
    points = _points([0, 1, 2, 3], 6)
    moved, _ = cluster_auto(points, ploidy=6, offset_override=99)
    # Four classes, step 1, so the highest start that still fits is 3.
    assert set(moved.values()) == _labels([3, 4, 5, 6], 6)


def test_locking_zero_is_expressible():
    """0 is the most common correct answer, so "offset 0, locked" has to mean
    something different from "offset not supplied" -- otherwise the operator
    cannot confirm a bottom-anchored window against a wrong guess."""
    points = _points([1, 2, 3], 6)
    forced, _ = cluster_auto(points, ploidy=6, offset_override=0)
    assert set(forced.values()) == _labels([0, 1, 2], 6)


def test_a_locked_window_is_reported_as_certain_not_as_a_guess():
    points = _points([1, 2, 3], 6)
    anchor_state: dict = {}
    assignments, _ = cluster_auto(
        points, ploidy=6, offset_override=3, anchor_state=anchor_state
    )
    assert anchor_state["resolved"] is True
    window = genotype_window(points, assignments, 6, anchor_resolved=True)
    assert window["offset"] == 3
    assert window["offset_uncertain"] is False


# ---------------------------------------------------------------------------
# Through the router, where the lock lives on the marker's threshold config
# ---------------------------------------------------------------------------

def _cluster_via_router(points, config, ploidy):
    from app.routers.clustering import _cluster_point_dicts

    return _cluster_point_dicts(points, {}, ClusteringAlgorithm.AUTO, config, 4, ploidy)


def test_an_unlocked_offset_does_not_touch_the_auto_calls():
    """Non-regression: ``offset`` alone is the estimator's own output being
    echoed back, and must not be fed in as an instruction."""
    points = _points([1, 2, 3], 6)
    baseline, _, _, _ = _cluster_via_router(points, ThresholdConfig(), 6)
    with_offset, _, _, _ = _cluster_via_router(points, ThresholdConfig(offset=5), 6)
    assert with_offset == baseline


def test_a_locked_offset_reaches_the_auto_path_and_comes_back_flagged():
    points = _points([1, 2, 3], 6)
    assignments, _, window, _ = _cluster_via_router(
        points, ThresholdConfig(offset=3, offset_locked=True), 6
    )
    assert set(assignments.values()) == _labels([3, 4, 5], 6)
    assert window["offset"] == 3
    assert window["offset_locked"] is True
    assert window["offset_uncertain"] is False


def test_the_counts_of_a_partial_hexaploid_window_are_the_present_classes_only():
    points = _points([0, 1, 2, 3], 6)
    assignments, _, window, _ = _cluster_via_router(points, ThresholdConfig(), 6)
    counts = Counter(assignments.values())
    assert set(counts) == _labels([0, 1, 2, 3], 6)
    assert all(n == 12 for n in counts.values())
    # Three internal cuts for four observed classes -- not the six a full
    # ladder would seed, which is what the draggable lines are drawn from.
    assert len(window["boundaries"]) == 3
    assert window["offset"] == 0
