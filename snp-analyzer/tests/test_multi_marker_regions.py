"""Phase A: per-marker independent clustering (run_clustering regions branch).

Mirrors the real qtotal11.1/qswet5.3 plate: marker A (cols 1-6) has a wide
dosage spread, marker B (cols 7-12) is a tight single distribution. Clustered
together they would collide; clustered per-marker they must resolve differently.
"""
import types

import pytest
from fastapi import HTTPException


def _points(wells, ratio, total=1000.0):
    """Build normalized point dicts at a fixed fam-fraction ratio."""
    return [
        {"well": w, "norm_fam": ratio * total, "norm_allele2": (1 - ratio) * total}
        for w in wells
    ]


def _marker_a_points():
    # 3 dosage clusters (~0.20 / 0.50 / 0.80), 12 wells
    pts = []
    pts += _points(["A1", "A2", "A3", "A4"], 0.20)
    pts += _points(["A5", "A6", "B1", "B2"], 0.50)
    pts += _points(["B3", "B4", "B5", "B6"], 0.80)
    return pts


def _marker_b_points():
    # tight single cluster ~0.74, 8 wells
    return (
        _points(["C1", "C2", "C3", "C4"], 0.73)
        + _points(["C5", "C6", "D1", "D2"], 0.75)
    )


def _req(regions):
    from app.models import ClusteringAlgorithm, ClusteringRequest

    return ClusteringRequest(algorithm=ClusteringAlgorithm.AUTO, cycle=1, regions=regions)


def _regions():
    from app.models import MarkerRegion

    a_wells = ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "B4", "B5", "B6"]
    b_wells = ["C1", "C2", "C3", "C4", "C5", "C6", "D1", "D2"]
    return [
        MarkerRegion(id="m1", name="qSwet5.3", wells=a_wells, ploidy=6),
        MarkerRegion(id="m2", name="qTotal11.1", wells=b_wells, ploidy=6),
    ]


def _distinct_calls(assignments):
    from app.models import WellType

    controls = {WellType.NTC.value, WellType.POSITIVE_CONTROL.value, WellType.UNDETERMINED.value}
    return {v for v in assignments.values() if v not in controls}


def test_regions_cluster_independently_and_merge():
    from app.routers.clustering import _run_regions

    point_dicts = _marker_a_points() + _marker_b_points()
    unified = types.SimpleNamespace(ploidy=2)
    result = _run_regions(_req(_regions()), unified, cycle=1, point_dicts=point_dicts, control_wells={})

    assert result.regions is not None and len(result.regions) == 2
    ra, rb = {r.id: r for r in result.regions}["m1"], {r.id: r for r in result.regions}["m2"]

    # Each region's assignments cover only its own wells.
    assert set(ra.assignments) == set(ra.wells)
    assert set(rb.assignments) == set(rb.wells)

    # Marker A resolves multiple dosage classes; marker B is (near) monomorphic.
    assert len(_distinct_calls(ra.assignments)) >= 2
    assert len(_distinct_calls(rb.assignments)) < len(_distinct_calls(ra.assignments))

    # Flat merge is the union across regions (for legacy plate-level consumers).
    assert set(result.assignments) == set(ra.wells) | set(rb.wells)

    # Per-marker metadata is populated independently.
    assert ra.ploidy == 6 and rb.ploidy == 6
    assert ra.genotype_counts is not None and rb.genotype_counts is not None


def test_overlapping_wells_rejected():
    from app.models import MarkerRegion
    from app.routers.clustering import _run_regions

    regions = [
        MarkerRegion(id="m1", name="A", wells=["A1", "A2"], ploidy=2),
        MarkerRegion(id="m2", name="B", wells=["A2", "A3"], ploidy=2),  # A2 overlaps
    ]
    unified = types.SimpleNamespace(ploidy=2)
    with pytest.raises(HTTPException) as exc:
        _run_regions(_req(regions), unified, cycle=1, point_dicts=_points(["A1", "A2", "A3"], 0.5), control_wells={})
    assert exc.value.status_code == 400


def test_regions_do_not_mutate_session_ploidy():
    """Multi-marker runs must not clobber the session's single-marker ploidy."""
    from app.routers.clustering import _run_regions

    unified = types.SimpleNamespace(ploidy=2)
    _run_regions(_req(_regions()), unified, cycle=1,
                 point_dicts=_marker_a_points() + _marker_b_points(), control_wells={})
    assert unified.ploidy == 2  # unchanged despite ploidy-6 regions
