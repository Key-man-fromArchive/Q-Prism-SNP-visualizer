"""P22 (call-logic investigation): characterization tests for a no-signal well
gap in ``cluster_auto``, NOT a specification of desired behavior.

These pin down the CURRENT (as of this investigation) output for wells whose
normalized total signal is exactly 0 -- e.g. after ``shift_to_origin`` clamps a
reading below the plate's own background floor to 0 (see
``app.processing.ratio_origin.shift_to_origin``) -- when the call has no
manual NTC quadrant and no allele-control anchors, so the only detector in
play is the relative-median one.

``cluster_auto`` computes ``median_total`` only from wells with total > 0
(clustering.py:332-333). When EVERY well handed to a given call has total <= 0,
``median_total`` is 0.0, so the relative-NTC mask (``total < 0.2 *
median_total`` => ``total < 0``) can never be true, and every zero-signal well
falls through to a real genotype call using the ``ratio = 0.5`` placeholder
(clustering.py:325) instead of being flagged as a no-call. This is exactly the
scenario a per-marker-region call reaches when an entire region's wells failed
to amplify (region-based clustering fits each marker on its own well subset --
see ``_run_regions`` in app/routers/clustering.py -- so "every well in this
call" can be as small as one marker, not the whole plate).

Do not read these assertions as "this is correct" -- they exist so that a
future fix to the no-call gap has a documented, reproducible "before" state,
and so a fix's own tests can invert exactly these assertions on purpose.
"""
from __future__ import annotations

from app.processing.clustering import cluster_auto


def test_small_all_zero_region_gets_a_confident_genotype_not_a_no_call():
    """<4 signal wells, ALL exactly zero total: hits the low_n fallback, which
    defaults the missing ratio to 0.5 -- diploid dosage 1 -- and reports the
    _SMALL_REGION_CONFIDENCE ceiling (0.9), not Undetermined."""
    points = [
        {"well": "A1", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A2", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A3", "norm_fam": 0.0, "norm_allele2": 0.0},
    ]
    warnings: list[str] = []
    assignments, confidences = cluster_auto(points, warnings=warnings)

    assert assignments == {"A1": "Heterozygous", "A2": "Heterozygous", "A3": "Heterozygous"}
    assert all(confidences[w] == 0.9 for w in assignments)
    assert "low_n" in warnings


def test_larger_all_zero_region_gets_max_confidence_and_no_warning_at_all():
    """>=4 signal wells, ALL exactly zero total: this SKIPS the low_n fallback
    entirely (no warning of any kind) and reaches the mixture-fit branch. BIC
    fits a single degenerate cluster on the identical ratio=0.5 points, so
    every well gets posterior 1.0 -- a MAX-confidence Heterozygous call for a
    marker region where nothing amplified. This is a strictly worse-flagged
    outcome than the <4-well case above (no warning at all vs. low_n)."""
    points = [{"well": f"W{i}", "norm_fam": 0.0, "norm_allele2": 0.0} for i in range(6)]
    warnings: list[str] = []
    assignments, confidences = cluster_auto(points, warnings=warnings)

    assert set(assignments.values()) == {"Heterozygous"}
    assert all(c == 1.0 for c in confidences.values())
    assert warnings == []


def test_zero_signal_wells_are_caught_correctly_when_the_call_also_has_real_signal():
    """Contrast case: the SAME zero-signal wells, but the call also includes
    real-signal wells (so ``median_total`` is positive). Here the relative
    detector DOES see them -- with an infinite gap ratio they are labelled NTC
    at full confidence, per the existing, separately-tested C4 policy (see
    tests/test_c4_relative_ntc.py::test_clean_ntc_with_clear_gap_is_still_called_ntc).
    This shows the gap above is specific to an ENTIRE call being zero-signal
    (e.g. one whole failed marker region), not to zero-signal wells in
    general."""
    points = [{"well": "A1", "norm_fam": 0.0, "norm_allele2": 0.0},
              {"well": "A2", "norm_fam": 0.0, "norm_allele2": 0.0},
              {"well": "A3", "norm_fam": 0.0, "norm_allele2": 0.0}]
    points += [{"well": f"B{i}", "norm_fam": 800.0, "norm_allele2": 200.0} for i in range(1, 6)]
    warnings: list[str] = []
    assignments, confidences = cluster_auto(points, warnings=warnings)

    for w in ("A1", "A2", "A3"):
        assert assignments[w] == "NTC"
        assert confidences[w] == 1.0
