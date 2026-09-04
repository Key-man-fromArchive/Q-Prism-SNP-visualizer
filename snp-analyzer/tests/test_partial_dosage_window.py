"""A polyploid marker usually shows only part of its dosage ladder.

Field fact this covers: a hexaploid assay commonly tops out at dosage 3, so
the classes actually present are 0,1,2,3 out of 0..6 -- not the full seven.
The caller has to (a) label those four as 0,1,2,3 rather than stretching them
across the ladder, and (b) let the operator correct the window's absolute
POSITION when fluorescence cannot fix it, without giving up the fit.

(b) is not a correction after the fact. The reachable range is a property of
the ASSAY -- the operator knows it before any plate is read -- so it is
declared up front (``ThresholdConfig.dosage_max``) and acts as a CONSTRAINT:
the class-count search is capped at ``dosage_max + 1`` and the dosage window
may not run past it. Both halves matter. Without the cap, BIC is free to split
four real classes into seven; without the ceiling, four clusters get stretched
across the whole 0..6 ladder and every one of them is mislabelled.
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
# A declared ceiling as a constraint on the fit
# ---------------------------------------------------------------------------

def test_the_declared_ceiling_bounds_the_window():
    """1,2,3 of six is unanchored on its own, so the estimator has to choose
    between 1,2,3 / 2,3,4 / 3,4,5 / 4,5,6. Declaring "this assay tops out at 3"
    removes all but the first."""
    points = _points([1, 2, 3], 6)
    unconstrained, _ = cluster_auto(points, ploidy=6)
    constrained, _ = cluster_auto(points, ploidy=6, dosage_max=3)

    assert set(constrained.values()) == _labels([1, 2, 3], 6)
    # Same clusters either way -- the ceiling changes the labelling, not the fit.
    def groups(a):
        return {frozenset(w for w, lab in a.items() if lab == g) for g in set(a.values())}
    assert groups(constrained) == groups(unconstrained)


def test_a_window_that_would_run_past_the_ceiling_is_pulled_under_it():
    """Ratios that best fit 3,4,5 on the full ladder cannot mean that on an
    assay declared to stop at 3."""
    points = _points([3, 4, 5], 6)
    called, _ = cluster_auto(points, ploidy=6, dosage_max=3)
    dosages = {
        d for d in range(7) if genotype_label(d, 6) in set(called.values())
    }
    assert max(dosages) <= 3


def test_the_ceiling_caps_how_many_classes_can_be_invented():
    """Four real classes on a hexaploid: with no ceiling the mixture may split
    them further, and a declared max of 3 makes that impossible by
    construction (K <= dosage_max + 1)."""
    points = _points([0, 1, 2, 3], 6)
    called, _ = cluster_auto(points, ploidy=6, dosage_max=3)
    genotypes = {lab for lab in called.values() if lab not in ("NTC", "Undetermined")}
    assert len(genotypes) <= 4
    assert genotypes == _labels([0, 1, 2, 3], 6)


def test_a_declared_ceiling_makes_the_top_class_an_anchor():
    """Without a ceiling, 1,2,3 of six touches neither end and the position is
    a guess. With the ceiling declared, the top class sits ON the end of the
    window, so there is nothing left for the operator to confirm."""
    ratios = [_biased(d, 6) for d in (1, 2, 3)]
    assert estimate_window(ratios, 6)[2] is True
    assert estimate_window(ratios, 6, dosage_max=3)[2] is False


def test_the_ceiling_seeds_the_draggable_ladder_too():
    """The radial lines start from the declared ladder, not the organism's: a
    hexaploid capped at 3 gets three cuts over the range its data occupies."""
    from app.processing.genotype_vocab import default_ratio_cuts

    assert len(default_ratio_cuts(6)) == 6
    assert len(default_ratio_cuts(6, dosage_max=3)) == 3
    # The ratio scale is still the organism's ploidy -- a dosage-3 hexaploid
    # class sits at r~0.5, not r~1.
    assert max(default_ratio_cuts(6, dosage_max=3)) == pytest.approx(2.5 / 6)


def test_a_ceiling_of_the_full_ploidy_changes_nothing():
    points = _points([0, 2, 4, 6], 6)
    assert cluster_auto(points, ploidy=6, dosage_max=6)[0] == cluster_auto(points, ploidy=6)[0]


def test_a_three_well_region_cannot_exceed_the_ceiling():
    """The <4-well path skips the mixture entirely and calls by raw ratio; it
    has to respect the declared range too."""
    points = [
        {"well": "A1", "norm_fam": 950.0, "norm_allele2": 50.0},
        {"well": "A2", "norm_fam": 500.0, "norm_allele2": 500.0},
        {"well": "A3", "norm_fam": 60.0, "norm_allele2": 940.0},
    ]
    called, _ = cluster_auto(points, ploidy=6, dosage_max=3)
    dosages = {
        d for d in range(7) if genotype_label(d, 6) in set(called.values())
    }
    assert max(dosages) <= 3


# ---------------------------------------------------------------------------
# Through the router, where the ceiling lives on the marker's threshold config
# ---------------------------------------------------------------------------

def _cluster_via_router(points, config, ploidy):
    from app.routers.clustering import _cluster_point_dicts

    return _cluster_point_dicts(points, {}, ClusteringAlgorithm.AUTO, config, 4, ploidy)


def test_an_undeclared_ceiling_leaves_the_auto_calls_alone():
    """Non-regression: the default config must behave exactly as before."""
    points = _points([1, 2, 3], 6)
    baseline, _, _, _ = _cluster_via_router(points, ThresholdConfig(), 6)
    explicit_full, _, _, _ = _cluster_via_router(points, ThresholdConfig(dosage_max=6), 6)
    assert explicit_full == baseline


def test_a_declared_ceiling_reaches_the_auto_path_and_comes_back_echoed():
    points = _points([1, 2, 3], 6)
    assignments, _, window, _ = _cluster_via_router(
        points, ThresholdConfig(dosage_max=3), 6
    )
    assert set(assignments.values()) == _labels([1, 2, 3], 6)
    assert window["dosage_max"] == 3
    # The declaration anchored the window, so this is no longer a guess.
    assert window["offset_uncertain"] is False


def test_the_counts_of_a_partial_hexaploid_window_are_the_present_classes_only():
    points = _points([0, 1, 2, 3], 6)
    assignments, _, window, _ = _cluster_via_router(
        points, ThresholdConfig(dosage_max=3), 6
    )
    counts = Counter(assignments.values())
    assert set(counts) == _labels([0, 1, 2, 3], 6)
    assert all(n == 12 for n in counts.values())
    # Three internal cuts for four observed classes -- not the six a full
    # ladder would seed, which is what the draggable lines are drawn from.
    assert len(window["boundaries"]) == 3
    assert window["offset"] == 0
