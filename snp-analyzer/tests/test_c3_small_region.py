"""C3: small-region overconfidence guard (TDD).

``cluster_auto``'s <4-signal-well fallback (too few points to fit a mixture)
used to report confidence 1.0 -- a 2-3 well marker got a MAX-confidence blind
call. This is capped to a principled low value (see
``app.processing.clustering._SMALL_REGION_CONFIDENCE``) and flagged with the
"low_n" warning code (Phase 1 diagnostics/warnings contract, see also
tests/test_c4_relative_ntc.py and tests/test_multi_marker_regions.py).
"""
from __future__ import annotations

from app.processing.clustering import cluster_auto
from app.processing.genotype_vocab import EXCLUDED_TYPES


def _three_signal_wells():
    """3 normal-signal wells (< 4 => hits the ratio-only fallback branch)."""
    return [
        {"well": "W1", "norm_fam": 700.0, "norm_allele2": 300.0},
        {"well": "W2", "norm_fam": 720.0, "norm_allele2": 280.0},
        {"well": "W3", "norm_fam": 690.0, "norm_allele2": 310.0},
    ]


def test_small_region_fallback_is_not_max_confidence():
    warnings: list[str] = []
    assign, conf = cluster_auto(_three_signal_wells(), ploidy=6, warnings=warnings)

    assert len(assign) == 3
    labels = {v for v in assign.values() if v not in EXCLUDED_TYPES}
    assert labels, f"expected a genotype ratio-call, got {assign}"
    for w in assign:
        assert conf[w] < 1.0, f"{w} got a blind max-confidence call: {conf[w]}"


def test_small_region_fallback_emits_low_n_warning():
    warnings: list[str] = []
    cluster_auto(_three_signal_wells(), ploidy=6, warnings=warnings)
    assert "low_n" in warnings


def test_small_region_fallback_does_not_change_labels():
    """The guard only caps confidence + adds a warning; the ratio-based label
    itself (dosage call) is unchanged."""
    plain_assign, _ = cluster_auto(_three_signal_wells(), ploidy=6)
    warned_assign, _ = cluster_auto(_three_signal_wells(), ploidy=6, warnings=[])
    assert plain_assign == warned_assign


def test_warnings_channel_is_optional_and_backward_compatible():
    """Passing no ``warnings`` list must not change the (assignments,
    confidences) 2-tuple return contract (existing callers are unaffected)."""
    assert cluster_auto([], ntc_threshold=0.1) == ({}, {})
    result = cluster_auto(_three_signal_wells(), ploidy=6)
    assert isinstance(result, tuple) and len(result) == 2


def test_clean_normal_size_marker_has_no_low_n_warning():
    """A normal (>=4 signal wells), clean marker must not be flagged low_n."""
    pts = [
        {"well": f"A{i}", "norm_fam": 0.92 + i * 0.002, "norm_allele2": 0.08 + i * 0.002}
        for i in range(10)
    ]
    warnings: list[str] = []
    cluster_auto(pts, warnings=warnings)
    assert "low_n" not in warnings


def test_low_n_warning_surfaces_on_region_result():
    """End-to-end: the diagnostics/warnings channel threads from cluster_auto
    through ``_cluster_point_dicts`` onto a per-marker ``RegionResult``."""
    from app.models import ClusteringAlgorithm, ClusteringRequest, MarkerRegion
    from app.routers.clustering import _run_regions
    import types

    small_region_points = _three_signal_wells()
    other_points = [
        {"well": f"B{i}", "norm_fam": 0.20 + i * 0.001, "norm_allele2": 0.80 - i * 0.001}
        for i in range(10)
    ]
    regions = [
        MarkerRegion(id="m1", name="tiny", wells=["W1", "W2", "W3"], ploidy=6),
        MarkerRegion(id="m2", name="normal", wells=[f"B{i}" for i in range(10)], ploidy=2),
    ]
    req = ClusteringRequest(algorithm=ClusteringAlgorithm.AUTO, cycle=1, regions=regions)
    unified = types.SimpleNamespace(ploidy=2)
    result = _run_regions(
        req, unified, cycle=1,
        point_dicts=small_region_points + other_points,
        control_wells={},
    )
    by_id = {r.id: r for r in result.regions}
    assert by_id["m1"].warnings is not None and "low_n" in by_id["m1"].warnings
    # The clean region stays clean -- no cross-contamination between regions.
    assert by_id["m2"].warnings is None


def test_clean_single_marker_clustering_result_has_no_warnings():
    """Single-marker (whole-plate, no regions) path: warnings=None when clean,
    so existing output is byte-for-byte unchanged."""
    from app.models import ClusteringAlgorithm
    from app.routers.clustering import _cluster_point_dicts

    pts = [
        {"well": f"A{i}", "norm_fam": 0.92 + i * 0.002, "norm_allele2": 0.08 + i * 0.002}
        for i in range(10)
    ]
    _, _, _, warnings = _cluster_point_dicts(
        pts, {}, ClusteringAlgorithm.AUTO, None, 4, 2
    )
    assert warnings is None
