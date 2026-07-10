"""C4: relative-NTC mislabel guard (TDD, CONSERVATIVE -- warning-only).

Auto NTC detection is purely RELATIVE (total signal < 0.2 * the plate's own
median total -- see ``_NTC_SIGNAL_FRAC`` in app.processing.clustering). For a
narrow, low-dynamic-range marker this can auto-label real, naturally-lower
samples as NTC even though they are not truly no-template.

This guard NEVER invents a new label:
  (a) an explicit user-assigned control type is always honored verbatim and
      is never reachable by the relative-NTC auto-detector at all (it is
      filtered out of the clustering input before the relative check runs).
  (b) when the auto-detected NTC wells are NOT clearly (order-of-magnitude)
      separated from the sample cluster, emit the "relative_ntc" warning and
      stop reporting a blind maximum (1.0) confidence for those wells -- but
      the label stays "NTC" (warning-only, not a relabel).
"""
from __future__ import annotations

from app.processing.clustering import cluster_auto


def _narrow_range_with_ambiguous_low_wells():
    """6 real samples at ~550 total signal (median), plus 3 'borderline' wells
    at ~105 total -- below the 0.2 * 550 = 110 relative cutoff (so they DO get
    auto-flagged NTC) but only ~5x below sample level, not a real gap."""
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


def test_narrow_range_ambiguous_low_wells_flag_relative_ntc_warning():
    warnings: list[str] = []
    assign, conf = cluster_auto(
        _narrow_range_with_ambiguous_low_wells(), ploidy=2, warnings=warnings
    )
    assert "relative_ntc" in warnings
    for i in range(3):
        # Still labeled NTC -- warning-only, no new label invented.
        assert assign[f"LOW{i}"] == "NTC"
        # ... but not reported as a blind, maximum-confidence call.
        assert conf[f"LOW{i}"] < 1.0


def test_clean_ntc_with_clear_gap_does_not_warn():
    warnings: list[str] = []
    assign, conf = cluster_auto(_clean_ntc_with_clear_gap(), ploidy=2, warnings=warnings)
    assert "relative_ntc" not in warnings
    for i in range(3):
        assert assign[f"NTC{i}"] == "NTC"
        assert conf[f"NTC{i}"] == 1.0


def test_explicit_non_ntc_control_type_is_never_auto_relabeled_ntc():
    """Rule (a): a well the user explicitly typed is honored as-is, even
    though its own signal would otherwise fall under the relative-NTC cutoff.
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
