"""C4: relative-NTC mislabel guard.

Auto NTC detection is purely RELATIVE (total signal < 0.2 * the plate's own
median total -- see ``_NTC_SIGNAL_FRAC`` in app.processing.clustering). For a
narrow, low-dynamic-range marker -- or a plate where a large share of the wells
simply failed -- this flags real, naturally-lower samples as no-signal even
though nothing about them says "no template".

This guard never invents a label. It does decline to make a claim the evidence
does not support:
  (a) an explicit user-assigned control type is always honored verbatim and is
      never reachable by the relative detector at all (it is filtered out of
      the clustering input before the relative check runs).
  (b) when the flagged wells are NOT clearly (order-of-magnitude) separated
      from the sample cluster, or when they span more of a full-size plate
      than a control set plausibly could, they are called UNDETERMINED -- a
      no-call, which is what a signal-level cutoff can actually conclude --
      and the "relative_ntc" warning is emitted.

Why (b) is a no-call and not "NTC with a lower confidence": "NTC" is a claim
about what was pipetted into the well, and a signal cutoff has no access to
that. This was originally implemented the other way (label kept as NTC,
confidence lowered) until a real plate settled it:
``1-2_admin_2026-09-03 16-14-11_783BR20183.pcrd`` had 25 of 96 wells
auto-labelled NTC at a gap of 5.3 -- none of them no-template wells -- and the
operator relabelled every one of them Undetermined by hand.
"""
from __future__ import annotations

from app.processing.clustering import cluster_auto


def _narrow_range_with_ambiguous_low_wells():
    """6 real samples at ~550 total signal (median), plus 3 'borderline' wells
    at ~105 total -- below the 0.2 * 550 = 110 relative cutoff (so they DO get
    auto-flagged) but only ~5x below sample level, not a real gap."""
    pts = []
    for i, r in enumerate([0.3, 0.4, 0.5, 0.6, 0.7, 0.8]):
        pts.append({"well": f"S{i}", "norm_fam": r * 550.0, "norm_allele2": (1 - r) * 550.0})
    for i in range(3):
        pts.append({"well": f"LOW{i}", "norm_fam": 52.5, "norm_allele2": 52.5})
    return pts


def _clean_ntc_with_clear_gap():
    """Same 6 real samples, but NTC wells near true zero (~5 total) -- a clean
    ~100x gap below the sample level."""
    pts = []
    for i, r in enumerate([0.3, 0.4, 0.5, 0.6, 0.7, 0.8]):
        pts.append({"well": f"S{i}", "norm_fam": r * 550.0, "norm_allele2": (1 - r) * 550.0})
    for i in range(3):
        pts.append({"well": f"NTC{i}", "norm_fam": 2.5, "norm_allele2": 2.5})
    return pts


def _full_plate_with_a_clean_but_huge_low_group(n_low: int):
    """A 96-well plate whose low group sits at a clean ~100x gap, but covers
    ``n_low`` of the wells. The gap alone would infer NTC; the share of the
    plate is what says these are failed wells, not controls."""
    pts = []
    for i in range(96 - n_low):
        r = 0.2 + (i % 3) * 0.3
        pts.append({"well": f"S{i}", "norm_fam": r * 550.0, "norm_allele2": (1 - r) * 550.0})
    for i in range(n_low):
        pts.append({"well": f"LOW{i}", "norm_fam": 2.5, "norm_allele2": 2.5})
    return pts


def test_narrow_range_ambiguous_low_wells_are_a_no_call_not_ntc():
    warnings: list[str] = []
    assign, conf = cluster_auto(
        _narrow_range_with_ambiguous_low_wells(), ploidy=2, warnings=warnings
    )
    assert "relative_ntc" in warnings
    for i in range(3):
        # A signal cutoff can conclude "no signal", not "no template".
        assert assign[f"LOW{i}"] == "Undetermined"
        # ... and reports how far below the plate they sat, not a blind 1.0.
        assert conf[f"LOW{i}"] < 1.0


def test_clean_ntc_with_clear_gap_is_still_called_ntc():
    warnings: list[str] = []
    assign, conf = cluster_auto(_clean_ntc_with_clear_gap(), ploidy=2, warnings=warnings)
    assert "relative_ntc" not in warnings
    for i in range(3):
        assert assign[f"NTC{i}"] == "NTC"
        assert conf[f"NTC{i}"] == 1.0


def test_a_small_region_is_not_judged_by_the_plate_fraction():
    """3 of 9 wells is 33% -- over the plate-fraction bar -- but 9 wells is a
    marker region, not a plate, and 3 NTC wells in one is entirely normal. The
    fraction test needs a full-size well set to be evidence of anything."""
    assign, _ = cluster_auto(_clean_ntc_with_clear_gap(), ploidy=2)
    assert [assign[f"NTC{i}"] for i in range(3)] == ["NTC"] * 3


def test_a_clean_gap_over_too_much_of_a_full_plate_is_a_no_call():
    warnings: list[str] = []
    assign, _ = cluster_auto(
        _full_plate_with_a_clean_but_huge_low_group(25), ploidy=2, warnings=warnings
    )
    assert "relative_ntc" in warnings
    assert assign["LOW0"] == "Undetermined"


def test_a_clean_gap_over_a_plausible_control_count_is_still_ntc():
    """The same plate with a control-sized low group keeps the NTC call, so the
    fraction bar cannot be read as "large plates never get NTC"."""
    warnings: list[str] = []
    assign, _ = cluster_auto(
        _full_plate_with_a_clean_but_huge_low_group(8), ploidy=2, warnings=warnings
    )
    assert "relative_ntc" not in warnings
    assert assign["LOW0"] == "NTC"


def test_explicit_non_ntc_control_type_is_never_auto_relabeled():
    """Rule (a): a well the user explicitly typed is honored as-is, even
    though its own signal would otherwise fall under the relative cutoff.
    (This is a non-regression check: control_wells are already filtered out of
    the clustering input before the relative check runs.)"""
    pts = _narrow_range_with_ambiguous_low_wells()
    assign, conf = cluster_auto(
        pts, ploidy=2, control_wells={"LOW0": "Positive Control"}
    )
    assert assign["LOW0"] == "Positive Control"
    assert conf["LOW0"] == 1.0


def test_qtotal_fixture_clear_ntc_gap_no_warning_no_regression():
    """Regression guard: the real qTotal11.1-style fixture (true NTC wells at
    ~1% of sample signal) must not pick up a spurious relative_ntc warning."""
    from fixtures_multimarker import qtotal_points

    warnings: list[str] = []
    cluster_auto(qtotal_points(), ploidy=6, warnings=warnings)
    assert "relative_ntc" not in warnings
