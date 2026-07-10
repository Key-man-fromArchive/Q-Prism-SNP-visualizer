"""P25c: three small correctness/serialization fixes flagged by code review.

1. Anchor clamp/nudge must not FABRICATE a dosage the raw scaled value does
   not support -- fall back to anchor_conflict instead of inventing one.
2. ``_region_input_hash`` must fold in threshold_config + algorithm (not just
   wells/ploidy/cycle), so a boundary/algorithm-only edit is detected as a
   changed input.
3. The ``/api/data/{sid}/cluster`` responses omit None fields (regions/
   warnings/etc.) for the legacy single-marker path, while a multi-marker
   response still carries its (non-None) ``regions``.
"""
from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import ClusteringAlgorithm, ThresholdConfig, UnifiedData, WellCycleData
from app.processing.clustering import _resolve_anchor_dosages
from app.routers.clustering import _region_input_hash


# ---------------------------------------------------------------------------
# 1. Anchor clamp/nudge must not fabricate dosages
# ---------------------------------------------------------------------------


def test_anchor_resolver_well_behaved_case_still_resolves_1_3_5():
    """Regression guard (mirrors tests/test_c1_allele_anchors.py's core case):
    clusters at ratios 0.20/0.50/0.80 with allele-1@0.97 / allele-2@0.03 must
    still cleanly resolve to dosages 1/3/5 (ploidy 6), no conflict."""
    ploidy = 6
    order = [0, 1, 2]
    cluster_ratio = {0: 0.20, 1: 0.50, 2: 0.80}
    warnings: list[str] = []
    dosages = _resolve_anchor_dosages(
        order, cluster_ratio, ploidy, [0.97], [0.03], warnings,
    )
    assert dosages == [1, 3, 5]
    assert "anchor_conflict" not in warnings


def test_anchor_resolver_does_not_fabricate_colliding_clamped_dosages():
    """Two clusters whose raw scaled dosages BOTH land below 0 (outside the
    ladder, but within the documented +/-1 clamp tolerance) collide at the
    same clamped bound (0). The strict-monotonic nudge used to push the
    second one to dosage 1 -- a value the raw scaled data (~-0.5) does not
    support (off by 1.0, over the ~0.5-dosage-step tolerance). This must now
    be detected as an anchor_conflict (fall back), not silently invented."""
    ploidy = 6
    order = [0, 1]
    # Ratios chosen so raw = (r - r2) * ploidy lands at ~-0.6 and ~-0.48 for
    # r2=0.50 -- both clamp to dosage 0, and the naive nudge would fabricate
    # dosage 1 for the second cluster.
    cluster_ratio = {0: 0.40, 1: 0.42}
    warnings: list[str] = []
    dosages = _resolve_anchor_dosages(
        order, cluster_ratio, ploidy, [], [0.50], warnings,
    )
    assert dosages is None
    assert "anchor_conflict" in warnings


def test_anchor_resolver_in_range_rounding_collision_is_conflict_not_invention():
    """Two clusters whose raw scaled dosages both round to the SAME in-range
    integer (no extreme-bound clamping involved) must not be nudged apart
    into a fabricated neighboring dosage -- the raw value that rounded DOWN
    to N is, by construction, more than half a dosage step away from N+1."""
    ploidy = 6
    order = [0, 1]
    # r2 anchor at 0.0: raw = r * ploidy. Ratios 0.38 and 0.415 -> raw ~2.28
    # and ~2.49, both round to dosage 2. The old nudge would push the second
    # cluster to dosage 3 -- 0.51 away from its own raw value.
    cluster_ratio = {0: 0.38, 1: 0.415}
    warnings: list[str] = []
    dosages = _resolve_anchor_dosages(
        order, cluster_ratio, ploidy, [], [0.0], warnings,
    )
    assert dosages is None
    assert "anchor_conflict" in warnings


# ---------------------------------------------------------------------------
# 2. input_hash must fold in threshold_config + algorithm
# ---------------------------------------------------------------------------


def test_input_hash_differs_when_boundaries_change():
    wells = ["A1", "A2", "A3"]
    cfg_a = ThresholdConfig(boundaries=[0.9, 0.5, 0.1], offset=0)
    cfg_b = ThresholdConfig(boundaries=[0.9, 0.5, 0.2], offset=0)
    h_a = _region_input_hash(wells, 4, 1, cfg_a, ClusteringAlgorithm.AUTO)
    h_b = _region_input_hash(wells, 4, 1, cfg_b, ClusteringAlgorithm.AUTO)
    assert h_a != h_b


def test_input_hash_differs_when_algorithm_changes():
    wells = ["A1", "A2", "A3"]
    cfg = ThresholdConfig()
    h_auto = _region_input_hash(wells, 4, 1, cfg, ClusteringAlgorithm.AUTO)
    h_threshold = _region_input_hash(wells, 4, 1, cfg, ClusteringAlgorithm.THRESHOLD)
    assert h_auto != h_threshold


def test_input_hash_stable_for_identical_inputs():
    wells = ["A1", "A2", "A3"]
    cfg = ThresholdConfig(boundaries=[0.9, 0.5, 0.1], offset=1)
    h1 = _region_input_hash(wells, 4, 1, cfg, ClusteringAlgorithm.AUTO)
    h2 = _region_input_hash(list(reversed(wells)), 4, 1, cfg, ClusteringAlgorithm.AUTO)
    assert h1 == h2


def test_input_hash_differs_when_offset_changes():
    wells = ["A1", "A2", "A3"]
    cfg_a = ThresholdConfig(boundaries=[0.9, 0.5, 0.1], offset=0)
    cfg_b = ThresholdConfig(boundaries=[0.9, 0.5, 0.1], offset=1)
    h_a = _region_input_hash(wells, 4, 1, cfg_a, ClusteringAlgorithm.AUTO)
    h_b = _region_input_hash(wells, 4, 1, cfg_b, ClusteringAlgorithm.AUTO)
    assert h_a != h_b


# ---------------------------------------------------------------------------
# 3. exclude_none on /cluster responses
# ---------------------------------------------------------------------------


@pytest.fixture
def data_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-p25c-fixes",
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
    from app.routers import upload, clustering

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


def _plate_unified(wells=None) -> UnifiedData:
    wells = wells or ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"]
    data = []
    for i, w in enumerate(wells):
        for cycle in [1, 2, 3]:
            fam, a2 = (0.9, 0.1) if i % 2 == 0 else (0.1, 0.9)
            data.append(
                WellCycleData(well=w, cycle=cycle, fam=fam * (100 + cycle), allele2=a2 * (100 + cycle), rox=None)
            )
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=wells,
        cycles=[1, 2, 3],
        data=data,
        has_rox=False,
    )


def test_single_marker_cluster_response_omits_none_keys(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "regions" not in body
    assert "warnings" not in body
    # Legitimately-present fields must still be there.
    assert "assignments" in body
    assert "algorithm" in body
    assert "ploidy" in body


def test_single_marker_cluster_get_response_omits_none_keys(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})
    resp = data_client.client.get("/api/data/s1/cluster")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "regions" not in body
    assert "warnings" not in body
    assert "assignments" in body


def test_multi_marker_cluster_response_still_has_regions(data_client):
    _register(data_client, "s1", _plate_unified())
    payload = {
        "markers": [
            {"id": "m1", "name": "markerA", "wells": ["A1", "A2", "A3", "A4"], "ploidy": 2},
            {"id": "m2", "name": "markerB", "wells": ["B1", "B2", "B3", "B4"], "ploidy": 2},
        ]
    }
    resp = data_client.client.post("/api/data/s1/markers", json=payload)
    assert resp.status_code == 200, resp.text

    resp = data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "regions" in body
    assert body["regions"] is not None
    ids = {r["id"] for r in body["regions"]}
    assert ids == {"m1", "m2"}
