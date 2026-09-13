"""P22 (call-logic investigation): characterization tests for the no-signal
well gap in ``cluster_auto``.

Originally written to pin down the BUGGY behavior found during the P22
investigation (see docs/planning/feedback-2026-09-11/evidence/P22-CALL-LOGIC.md):
``cluster_auto`` computes ``median_total`` only from wells with total > 0
(clustering.py). When EVERY well handed to a given call has total <= 0,
``median_total`` collapsed to 0.0, so the relative-NTC mask (``total < 0.2 *
median_total`` => ``total < 0``) could never be true, and every zero-signal
well fell through to a real genotype call using the ``ratio = 0.5``
placeholder instead of being flagged as a no-call. This is exactly the
scenario a per-marker-region call reaches when an entire region's wells failed
to amplify (region-based clustering fits each marker on its own well subset --
see ``_run_regions`` in app/routers/clustering.py -- so "every well in this
call" can be as small as one marker, not the whole plate).

P22 (C5) FIX APPLIED: the two tests below (`test_small_all_zero_region_...`
and `test_larger_all_zero_region_...`) now assert the FIXED expectation
(Undetermined + "no_signal") instead of the original bug's output
(Heterozygous at 0.9/1.0 confidence) -- see the ``median_total == 0.0`` early
return in ``cluster_auto``. Each test's docstring records both the old
(pre-fix) and new (post-fix) output so the change is traceable. The third
test is an unchanged REGRESSION GUARD: it was passing before this fix and
must keep passing after it (a call scope that also has real signal must keep
using the existing, separately-tested relative-NTC path unchanged)."""

from __future__ import annotations

from app.processing.clustering import cluster_auto


def test_small_all_zero_region_gets_a_confident_genotype_not_a_no_call():
    """<4 signal wells, ALL exactly zero total.

    BEFORE the P22/C5 fix: hit the low_n fallback, which defaulted the
    missing ratio to 0.5 -- diploid dosage 1 -- and reported the
    _SMALL_REGION_CONFIDENCE ceiling (0.9): {"A1": "Heterozygous", ...},
    confidence 0.9, warnings == ["low_n"].

    AFTER the fix: median_total collapses to 0.0 for this call (no well has
    positive total), which now short-circuits straight to Undetermined
    before the low_n fallback is ever reached -- see the
    ``median_total == 0.0`` branch in cluster_auto (C5)."""
    points = [
        {"well": "A1", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A2", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A3", "norm_fam": 0.0, "norm_allele2": 0.0},
    ]
    warnings: list[str] = []
    assignments, confidences = cluster_auto(points, warnings=warnings)

    assert assignments == {
        "A1": "Undetermined",
        "A2": "Undetermined",
        "A3": "Undetermined",
    }
    assert all(confidences[w] == 0.0 for w in assignments)
    assert warnings == ["no_signal"]
    assert "low_n" not in warnings


def test_larger_all_zero_region_gets_max_confidence_and_no_warning_at_all():
    """>=4 signal wells, ALL exactly zero total.

    BEFORE the P22/C5 fix: this SKIPPED the low_n fallback entirely (no
    warning of any kind) and reached the mixture-fit branch. BIC fit a
    single degenerate cluster on the identical ratio=0.5 points, so every
    well got posterior 1.0 -- a MAX-confidence Heterozygous call for a
    marker region where nothing amplified, and no warning at all (strictly
    worse-flagged than the <4-well case above).

    AFTER the fix: the same ``median_total == 0.0`` guard fires regardless
    of well count, before the <4/>=4 branch split is even reached -- so a
    larger all-zero region is no longer worse-flagged than a smaller one;
    both get Undetermined + "no_signal"."""
    points = [{"well": f"W{i}", "norm_fam": 0.0, "norm_allele2": 0.0} for i in range(6)]
    warnings: list[str] = []
    assignments, confidences = cluster_auto(points, warnings=warnings)

    assert set(assignments.values()) == {"Undetermined"}
    assert all(c == 0.0 for c in confidences.values())
    assert warnings == ["no_signal"]


def test_zero_signal_wells_are_caught_correctly_when_the_call_also_has_real_signal():
    """Contrast case: the SAME zero-signal wells, but the call also includes
    real-signal wells (so ``median_total`` is positive). Here the relative
    detector DOES see them -- with an infinite gap ratio they are labelled NTC
    at full confidence, per the existing, separately-tested C4 policy (see
    tests/test_c4_relative_ntc.py::test_clean_ntc_with_clear_gap_is_still_called_ntc).
    This shows the gap above is specific to an ENTIRE call being zero-signal
    (e.g. one whole failed marker region), not to zero-signal wells in
    general."""
    points = [
        {"well": "A1", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A2", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A3", "norm_fam": 0.0, "norm_allele2": 0.0},
    ]
    points += [
        {"well": f"B{i}", "norm_fam": 800.0, "norm_allele2": 200.0} for i in range(1, 6)
    ]
    warnings: list[str] = []
    assignments, confidences = cluster_auto(points, warnings=warnings)

    for w in ("A1", "A2", "A3"):
        assert assignments[w] == "NTC"
        assert confidences[w] == 1.0


def test_origin_shifted_zero_and_originally_zero_are_treated_identically():
    """Distinguishing 'became (0,0) via shift_to_origin' from 'was always
    (0,0)' is possible one layer up (the router keeps ``plot_fam``/
    ``plot_allele2`` -- the PRE-shift values -- alongside the post-shift
    ``norm_fam``/``norm_allele2``, see app.routers.clustering._snapshot_points
    and app.processing.clustering._manual_ntc_mask). ``cluster_auto`` itself
    only ever sees the POST-shift ``norm_fam``/``norm_allele2`` -- it has no
    access to the pre-shift values at all -- so by construction it cannot
    (and, per the P22 no-signal definition adopted here, should not) treat the
    two cases differently: both are "no signal to measure a ratio from" after
    the plate's own background floor is subtracted out.

    This test proves that equivalence directly: a marker region whose wells
    all read raw signal AT the plate's own background floor (so
    ``shift_to_origin`` clamps every one of them to exactly (0, 0)) is
    classified exactly the same way as a region that was (0, 0) before any
    shift at all."""
    from app.processing.ratio_origin import RatioOrigin, shift_to_origin

    # Region A: raw values already (0, 0) pre-shift; a (0, 0) origin is a
    # no-op for shift_to_origin (see its own early return), so this is the
    # "originally zero" case.
    region_a_raw = [
        {"well": "A1", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A2", "norm_fam": 0.0, "norm_allele2": 0.0},
        {"well": "A3", "norm_fam": 0.0, "norm_allele2": 0.0},
    ]
    region_a = shift_to_origin(
        region_a_raw, RatioOrigin(fam=0.0, allele2=0.0, source="zero")
    )

    # Region B: raw values sit exactly AT the plate's own background floor
    # (50, 20) -- a real, positive reading -- so shift_to_origin clamps every
    # well down to (0, 0). This is the "became zero via origin shift" case.
    region_b_raw = [
        {"well": "B1", "norm_fam": 50.0, "norm_allele2": 20.0},
        {"well": "B2", "norm_fam": 50.0, "norm_allele2": 20.0},
        {"well": "B3", "norm_fam": 50.0, "norm_allele2": 20.0},
    ]
    region_b = shift_to_origin(
        region_b_raw, RatioOrigin(fam=50.0, allele2=20.0, source="plate_floor")
    )

    # Both regions reach cluster_auto as exactly (0, 0) -- confirming
    # cluster_auto cannot tell them apart (and does not need to).
    for p in region_a + region_b:
        assert p["norm_fam"] == 0.0
        assert p["norm_allele2"] == 0.0

    warnings_a: list[str] = []
    assignments_a, confidences_a = cluster_auto(region_a, warnings=warnings_a)
    warnings_b: list[str] = []
    assignments_b, confidences_b = cluster_auto(region_b, warnings=warnings_b)

    assert set(assignments_a.values()) == {"Undetermined"}
    assert set(assignments_b.values()) == {"Undetermined"}
    assert all(c == 0.0 for c in confidences_a.values())
    assert all(c == 0.0 for c in confidences_b.values())
    assert warnings_a == ["no_signal"]
    assert warnings_b == ["no_signal"]
