"""B3: a persisted manual boundary override (the user's dragged radial lines)
is AUTHORITATIVE for that marker's genotype calls and MUST be echoed back
unchanged on every re-cluster -- never silently recomputed from a fresh
auto-cluster fit.

Contract (see app/routers/clustering.py::_cluster_point_dicts):
  - When ``ThresholdConfig.boundaries`` is set (non-empty), the region/plate
    result is labeled by those cuts + ``offset`` directly (threshold-style),
    and the RegionResult/ClusteringResult ``boundaries``/``offset`` fields
    are EXACTLY the ones supplied -- not re-derived via ``genotype_window``.
    This applies regardless of the request's nominal ``algorithm`` (AUTO or
    THRESHOLD), because the cuts ARE the user's decision, not a hint for
    ``cluster_auto`` to refine.
  - When ``boundaries`` is None/absent, behavior is UNCHANGED: AUTO fits a
    fresh mixture and derives its own window via ``genotype_window``.

Also covers the related ploidy>2 THRESHOLD KeyError fix: ``genotype_window``
must always return all four keys (boundaries/offset/offset_uncertain/
low_separation), even when it recognizes zero dosage labels (e.g. the
diploid-only labels ``cluster_threshold`` emits without boundaries, for a
ploidy>2 marker).
"""
from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UnifiedData, WellCycleData


def _points(wells_ratios: dict[str, float], total: float = 1000.0) -> list[dict]:
    return [
        {"well": w, "norm_fam": r * total, "norm_allele2": (1 - r) * total}
        for w, r in wells_ratios.items()
    ]


# ---------------------------------------------------------------------------
# Unit-level: _cluster_point_dicts override semantics (fast, precise).
# ---------------------------------------------------------------------------


def test_manual_boundary_override_labels_by_cuts_on_auto_algorithm():
    """The core B3 bug: AUTO ignored a marker's saved boundaries entirely."""
    from app.models import ClusteringAlgorithm, ThresholdConfig
    from app.routers.clustering import _cluster_point_dicts

    ratios = {"W0": 0.05, "W1": 0.2, "W2": 0.5, "W3": 0.75, "W4": 0.95}
    points = _points(ratios)
    cuts = [0.9, 0.6, 0.3, 0.1]
    config = ThresholdConfig(ntc_threshold=0.0, boundaries=cuts, offset=0)

    assignments, confidences, window, warnings = _cluster_point_dicts(
        points, {}, ClusteringAlgorithm.AUTO, config, 4, ploidy=4,
    )

    assert assignments == {
        "W0": "BBBB", "W1": "ABBB", "W2": "AABB", "W3": "AAAB", "W4": "AAAA",
    }
    assert window["boundaries"] == cuts
    assert window["offset"] == 0
    assert window["offset_uncertain"] is False
    assert window["low_separation"] is False


def test_manual_boundary_override_honors_nonzero_offset():
    from app.models import ClusteringAlgorithm, ThresholdConfig
    from app.routers.clustering import _cluster_point_dicts

    ratios = {"W0": 0.2, "W1": 0.45, "W2": 0.8}
    points = _points(ratios)
    cuts = [0.6, 0.3]
    config = ThresholdConfig(ntc_threshold=0.0, boundaries=cuts, offset=1)

    assignments, confidences, window, warnings = _cluster_point_dicts(
        points, {}, ClusteringAlgorithm.THRESHOLD, config, 4, ploidy=4,
    )

    assert assignments == {"W0": "ABBB", "W1": "AABB", "W2": "AAAB"}
    assert window["boundaries"] == cuts
    assert window["offset"] == 1
    assert window["offset_uncertain"] is False
    assert window["low_separation"] is False


def test_manual_boundary_override_is_stable_across_repeated_calls():
    """Re-clustering (e.g. tab-switch) must not drift the returned window."""
    from app.models import ClusteringAlgorithm, ThresholdConfig
    from app.routers.clustering import _cluster_point_dicts

    ratios = {"W0": 0.05, "W1": 0.2, "W2": 0.5, "W3": 0.75, "W4": 0.95}
    points = _points(ratios)
    cuts = [0.9, 0.6, 0.3, 0.1]
    config = ThresholdConfig(ntc_threshold=0.0, boundaries=cuts, offset=0)

    first = _cluster_point_dicts(points, {}, ClusteringAlgorithm.AUTO, config, 4, ploidy=4)
    second = _cluster_point_dicts(points, {}, ClusteringAlgorithm.AUTO, config, 4, ploidy=4)

    assert first[0] == second[0]  # assignments
    assert first[2] == second[2]  # window (boundaries/offset/...)
    assert first[2]["boundaries"] == cuts
    assert first[2]["offset"] == 0


def test_no_boundaries_marker_auto_window_unchanged():
    """Control: without a manual override, AUTO behavior is byte-identical."""
    from app.models import ClusteringAlgorithm, ThresholdConfig
    from app.processing.clustering import cluster_auto, genotype_window
    from app.routers.clustering import _cluster_point_dicts

    ratios = {
        "LO1": 0.18, "LO2": 0.20, "LO3": 0.22, "LO4": 0.21,
        "MID1": 0.48, "MID2": 0.50, "MID3": 0.52, "MID4": 0.51,
        "HI1": 0.78, "HI2": 0.80, "HI3": 0.82, "HI4": 0.81,
    }
    points = _points(ratios)
    config = ThresholdConfig()  # boundaries=None

    expected_warnings: list[str] = []
    expected_anchor_state: dict = {}
    expected_assignments, expected_conf = cluster_auto(
        points,
        ntc_threshold=config.ntc_threshold,
        control_wells={},
        ploidy=2,
        warnings=expected_warnings,
        anchor_state=expected_anchor_state,
    )
    expected_window = genotype_window(
        points, expected_assignments, 2,
        anchor_resolved=expected_anchor_state.get("resolved", False),
    )

    assignments, confidences, window, warnings = _cluster_point_dicts(
        points, {}, ClusteringAlgorithm.AUTO, config, 4, ploidy=2,
    )

    assert assignments == expected_assignments
    assert confidences == expected_conf
    assert window == expected_window
    assert warnings == (expected_warnings or None)


# ---------------------------------------------------------------------------
# Integration: persisted-marker path (run_clustering) -- a dragged boundary
# must survive re-cluster / tab-switch.
# ---------------------------------------------------------------------------


@pytest.fixture
def data_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-b3-boundary",
            "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
            "SNP_AUTH_MODE": "local",
        },
        clear=False,
    )
    env.start()

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "test.sqlite3"

    from app.main import app
    from app.routers import upload
    from app.routers import clustering

    async def current_user_override():
        return TokenData(user_id="user-1", username="user1", role="user")

    app.dependency_overrides[get_current_user] = current_user_override
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    clustering.group_store.clear()
    clustering.marker_store.clear()

    with TestClient(app) as client:
        yield SimpleNamespace(client=client, upload=upload, clustering=clustering, db=db)

    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    clustering.group_store.clear()
    clustering.marker_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(data_client, sid: str, unified: UnifiedData):
    data_client.upload.sessions[sid] = unified
    data_client.db.save_session(sid, unified, filename="test.eds", user_id=None)


def _tetraploid_plate() -> UnifiedData:
    ratios = {"W0": 0.05, "W1": 0.2, "W2": 0.5, "W3": 0.75, "W4": 0.95}
    wells = list(ratios)
    data = []
    for w, r in ratios.items():
        for cycle in [1]:
            data.append(WellCycleData(well=w, cycle=cycle, fam=r * 1000.0, allele2=(1 - r) * 1000.0, rox=None))
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=wells,
        cycles=[1],
        data=data,
        has_rox=False,
    )


def test_persisted_marker_boundary_survives_recluster(data_client):
    _register(data_client, "s1", _tetraploid_plate())

    cuts = [0.9, 0.6, 0.3, 0.1]
    marker_payload = {
        "markers": [
            {
                "id": "m1",
                "name": "markerA",
                "wells": ["W0", "W1", "W2", "W3", "W4"],
                "ploidy": 4,
                "threshold_config": {"ntc_threshold": 0.0, "boundaries": cuts, "offset": 0},
            }
        ]
    }
    resp = data_client.client.post("/api/data/s1/markers", json=marker_payload)
    assert resp.status_code == 200, resp.text

    expected_assignments = {
        "W0": "BBBB", "W1": "ABBB", "W2": "AABB", "W3": "AAAB", "W4": "AAAA",
    }

    for _ in range(2):
        resp = data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["regions"] is not None
        region = body["regions"][0]
        assert region["id"] == "m1"
        assert region["assignments"] == expected_assignments
        assert region["boundaries"] == cuts
        assert region["offset"] == 0
        assert region["offset_uncertain"] is False


# ---------------------------------------------------------------------------
# Regression: ploidy>2 THRESHOLD path must not KeyError when genotype_window
# recognizes zero dosage labels (diploid-only labels from a boundary-less
# cluster_threshold, for a ploidy>2 marker).
# ---------------------------------------------------------------------------


def test_genotype_window_returns_all_four_keys_when_no_dosage_recognized():
    from app.processing.clustering import genotype_window

    points = [
        {"well": "A1", "norm_fam": 200.0, "norm_allele2": 800.0},
        {"well": "A2", "norm_fam": 500.0, "norm_allele2": 500.0},
        {"well": "A3", "norm_fam": 800.0, "norm_allele2": 200.0},
    ]
    # Diploid-vocabulary labels on a ploidy=6 marker -- dosage_of_label(label, 6)
    # returns None for every well, so ratio_by_dosage is empty.
    assignments = {
        "A1": "Allele 2 Homo", "A2": "Heterozygous", "A3": "Allele 1 Homo",
    }

    window = genotype_window(points, assignments, ploidy=6)

    assert set(window) == {"boundaries", "offset", "offset_uncertain", "low_separation"}
    assert window["low_separation"] is False


def test_run_regions_threshold_ploidy6_no_boundaries_does_not_keyerror():
    """Reproduces the exact crash path: THRESHOLD algorithm, no boundaries,
    ploidy=6 marker -- cluster_threshold falls back to diploid labels, and
    genotype_window used to omit low_separation/offset_uncertain in that case."""
    import types

    from app.models import ClusteringAlgorithm, ClusteringRequest, MarkerRegion
    from app.routers.clustering import _run_regions

    wells = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"]
    ratios = [0.2, 0.2, 0.2, 0.2, 0.5, 0.5, 0.8, 0.8]
    point_dicts = [
        {"well": w, "norm_fam": r * 1000.0, "norm_allele2": (1 - r) * 1000.0}
        for w, r in zip(wells, ratios)
    ]
    regions = [MarkerRegion(id="m1", name="hexMarker", wells=wells, ploidy=6)]
    req = ClusteringRequest(algorithm=ClusteringAlgorithm.THRESHOLD, cycle=1, regions=regions)
    unified = types.SimpleNamespace(ploidy=2)

    result = _run_regions(req, unified, cycle=1, point_dicts=point_dicts, control_wells={})

    assert result.regions is not None and len(result.regions) == 1
    reg = result.regions[0]
    assert reg.offset_uncertain in (True, False)
    assert reg.low_separation in (True, False)
