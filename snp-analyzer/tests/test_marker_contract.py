"""Marker API contract freeze (Phase B): saved markers become authoritative for
clustering, PUT + structured validation lands on /markers, per-marker warnings
+ an ``authoritative`` flag are surfaced on statistics/qc, and marker writes go
DB-first (so a DB failure cannot leave memory/DB divergent).

TDD: this whole file starts RED against the routers as they existed before
B1/B2/B4/dbfix.
"""
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import ClusteringResult, RegionResult, UnifiedData, WellCycleData


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def data_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-marker-contract",
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


def _two_marker_payload():
    # Both markers diploid: cluster_threshold (no explicit boundaries) only
    # emits the diploid "Allele 1/2 Homo" labels, so a ploidy>2 marker here
    # would hit an unrelated, pre-existing gap in genotype_window (dosage
    # labels not matching the marker's own ploidy vocabulary) -- out of scope
    # for this contract; per-ploidy clustering correctness is already covered
    # by tests/test_multi_marker_regions.py (AUTO algorithm).
    return {
        "markers": [
            {"id": "m1", "name": "markerA", "wells": ["A1", "A2", "A3", "A4"], "ploidy": 2},
            {"id": "m2", "name": "markerB", "wells": ["B1", "B2", "B3", "B4"], "ploidy": 2},
        ]
    }


# ---------------------------------------------------------------------------
# B1 -- saved markers are authoritative for clustering
# ---------------------------------------------------------------------------


def test_cluster_uses_stored_markers_when_request_has_no_regions(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())
    assert resp.status_code == 200, resp.text

    resp = data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["regions"] is not None
    ids = {r["id"] for r in body["regions"]}
    assert ids == {"m1", "m2"}
    # Each region only covers its own wells.
    by_id = {r["id"]: r for r in body["regions"]}
    assert set(by_id["m1"]["assignments"]) == {"A1", "A2", "A3", "A4"}
    assert set(by_id["m2"]["assignments"]) == {"B1", "B2", "B3", "B4"}
    assert by_id["m2"]["ploidy"] == 2


def test_cluster_request_regions_take_precedence_over_stored_markers(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.post(
        "/api/data/s1/cluster",
        json={
            "cycle": 1,
            "regions": [
                {"id": "req1", "name": "reqMarker", "wells": ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"], "ploidy": 2},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    ids = {r["id"] for r in body["regions"]}
    assert ids == {"req1"}


def test_cluster_no_stored_markers_and_no_request_regions_is_single_marker(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # P25c: single-marker responses omit None fields entirely (see
    # tests/test_p25c_fixes.py), so a clean single-marker result carries no
    # "regions" key at all rather than an explicit null.
    assert "regions" not in body


def test_editing_markers_via_post_invalidates_stale_clustering(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())
    resp = data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})
    assert resp.status_code == 200, resp.text
    assert resp.json()["regions"] is not None

    # Replace the marker set entirely.
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m3", "name": "markerC", "wells": ["A1"], "ploidy": 2}]},
    )
    assert resp.status_code == 200, resp.text

    resp = data_client.client.get("/api/data/s1/cluster")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["algorithm"] is None
    assert body["assignments"] == {}


def test_deleting_markers_invalidates_stale_clustering(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())
    data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})

    resp = data_client.client.delete("/api/data/s1/markers")
    assert resp.status_code == 200, resp.text

    resp = data_client.client.get("/api/data/s1/cluster")
    body = resp.json()
    assert body["algorithm"] is None


def test_updating_one_marker_via_put_invalidates_stale_clustering(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())
    data_client.client.post("/api/data/s1/cluster", json={"cycle": 1})

    resp = data_client.client.put(
        "/api/data/s1/markers/m1",
        json={"name": "markerA-renamed"},
    )
    assert resp.status_code == 200, resp.text

    resp = data_client.client.get("/api/data/s1/cluster")
    body = resp.json()
    assert body["algorithm"] is None


# ---------------------------------------------------------------------------
# B2 -- PUT endpoint + validation + structured errors
# ---------------------------------------------------------------------------


def test_put_updates_single_marker_partial_fields(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put(
        "/api/data/s1/markers/m1",
        json={"name": "markerA-v2", "ploidy": 6},
    )
    assert resp.status_code == 200, resp.text

    resp = data_client.client.get("/api/data/s1/markers")
    markers = {m["id"]: m for m in resp.json()["markers"]}
    m1 = markers["m1"]
    assert m1["name"] == "markerA-v2"
    assert m1["ploidy"] == 6
    # Untouched fields preserved.
    assert m1["wells"] == ["A1", "A2", "A3", "A4"]
    # Other marker untouched.
    assert markers["m2"]["name"] == "markerB"


def test_put_persists_to_db(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())
    data_client.client.put("/api/data/s1/markers/m1", json={"name": "renamed"})

    loaded = {r["id"]: r for r in data_client.db.load_marker_regions("s1")}
    assert loaded["m1"]["name"] == "renamed"


def test_put_unknown_marker_id_404(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put(
        "/api/data/s1/markers/does-not-exist",
        json={"name": "x"},
    )
    assert resp.status_code == 404


def test_put_rejects_invalid_ploidy(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put("/api/data/s1/markers/m1", json={"ploidy": 1})
    assert resp.status_code == 400, resp.text
    assert "ploidy" in resp.json()["detail"]


def test_put_rejects_empty_name(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put("/api/data/s1/markers/m1", json={"name": ""})
    assert resp.status_code == 400, resp.text
    assert "name" in resp.json()["detail"].lower()


def test_put_rejects_duplicate_name_against_other_marker(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put("/api/data/s1/markers/m1", json={"name": "markerB"})
    assert resp.status_code == 400, resp.text
    assert "markerB" in resp.json()["detail"] or "name" in resp.json()["detail"].lower()


def test_put_rejects_wells_not_in_plate(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put("/api/data/s1/markers/m1", json={"wells": ["Z9"]})
    assert resp.status_code == 400, resp.text
    assert "Z9" in resp.json()["detail"]


def test_put_rejects_empty_well_list(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put("/api/data/s1/markers/m1", json={"wells": []})
    assert resp.status_code == 400, resp.text


def test_put_rejects_wells_overlapping_another_marker(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    resp = data_client.client.put("/api/data/s1/markers/m1", json={"wells": ["A1", "B1"]})
    assert resp.status_code == 400, resp.text
    assert "B1" in resp.json()["detail"]


def test_post_rejects_invalid_ploidy(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1"], "ploidy": 1}]},
    )
    assert resp.status_code == 400, resp.text
    assert "ploidy" in resp.json()["detail"]


def test_post_rejects_empty_marker_name(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "", "wells": ["A1"], "ploidy": 2}]},
    )
    assert resp.status_code == 400, resp.text


def test_post_rejects_empty_well_list(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": [], "ploidy": 2}]},
    )
    assert resp.status_code == 400, resp.text


def test_post_rejects_duplicate_marker_id_with_400_not_500(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={
            "markers": [
                {"id": "m1", "name": "A", "wells": ["A1"], "ploidy": 2},
                {"id": "m1", "name": "B", "wells": ["A2"], "ploidy": 2},
            ]
        },
    )
    assert resp.status_code == 400, resp.text
    assert "m1" in resp.json()["detail"]


def test_post_rejects_duplicate_marker_name(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={
            "markers": [
                {"id": "m1", "name": "same", "wells": ["A1"], "ploidy": 2},
                {"id": "m2", "name": "same", "wells": ["A2"], "ploidy": 2},
            ]
        },
    )
    assert resp.status_code == 400, resp.text


def test_post_rejects_wells_not_in_plate(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["Z9"], "ploidy": 2}]},
    )
    assert resp.status_code == 400, resp.text
    assert "Z9" in resp.json()["detail"]


def test_post_still_rejects_overlapping_wells(data_client):
    """Existing behavior (pre-B2) must still work."""
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={
            "markers": [
                {"id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 2},
                {"id": "m2", "name": "B", "wells": ["A2", "A3"], "ploidy": 2},
            ]
        },
    )
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# dbfix -- DB write happens before in-memory store update
# ---------------------------------------------------------------------------


def test_create_markers_db_failure_does_not_update_memory(data_client):
    _register(data_client, "s1", _plate_unified())

    with patch("app.db.save_marker_regions", side_effect=RuntimeError("db down")):
        with pytest.raises(RuntimeError):
            data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    assert data_client.clustering.marker_store.get("s1", []) == []


def test_put_marker_db_failure_does_not_update_memory(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post("/api/data/s1/markers", json=_two_marker_payload())

    with patch("app.db.save_marker_regions", side_effect=RuntimeError("db down")):
        with pytest.raises(RuntimeError):
            data_client.client.put("/api/data/s1/markers/m1", json={"name": "renamed"})

    stored = {m.id: m for m in data_client.clustering.marker_store["s1"]}
    assert stored["m1"].name == "markerA"


# ---------------------------------------------------------------------------
# B4 -- authoritative flag + per-marker warnings on statistics/qc
# ---------------------------------------------------------------------------


def _multi_marker_cluster_result_with_warnings() -> ClusteringResult:
    region_a = RegionResult(
        id="m1", name="markerA", wells=["A1", "A2", "A3", "A4"], ploidy=2,
        assignments={
            "A1": "Allele 1 Homo", "A2": "Allele 1 Homo",
            "A3": "Allele 2 Homo", "A4": "Allele 2 Homo",
        },
        genotype_counts={"AA": 2, "AB": 0, "BB": 2, "excluded": 0},
        warnings=["low_n"],
    )
    region_b = RegionResult(
        id="m2", name="markerB", wells=["B1", "B2", "B3", "B4"], ploidy=4,
        assignments={
            "B1": "AAAA", "B2": "AAAB", "B3": "ABBB", "B4": "BBBB",
        },
        genotype_counts={"AAAA": 1, "AAAB": 1, "AABB": 0, "ABBB": 1, "BBBB": 1, "excluded": 0},
        warnings=None,
    )
    flat_assignments = {**region_a.assignments, **region_b.assignments}
    return ClusteringResult(
        algorithm="threshold",
        cycle=1,
        assignments=flat_assignments,
        ploidy=2,
        regions=[region_a, region_b],
    )


def test_statistics_multi_marker_has_authoritative_flag_and_warnings(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.clustering.cluster_store["s1"] = _multi_marker_cluster_result_with_warnings()

    resp = data_client.client.get("/api/data/s1/statistics")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["authoritative"] == "markers"
    by_id = {m["id"]: m for m in body["markers"]}
    assert by_id["m1"]["warnings"] == ["low_n"]
    assert by_id["m2"]["warnings"] is None
    # Pooled plate-level block is still present (not removed).
    assert "allele_frequency" in body
    assert "genotype_distribution" in body


def test_statistics_single_marker_has_no_authoritative_key(data_client):
    _register(data_client, "s1", _plate_unified(["A1", "A2", "A3", "A4"]))
    data_client.clustering.cluster_store["s1"] = ClusteringResult(
        algorithm="threshold", cycle=1,
        assignments={"A1": "Allele 1 Homo", "A2": "Allele 1 Homo", "A3": "Allele 2 Homo", "A4": "Allele 2 Homo"},
        ploidy=2,
    )
    resp = data_client.client.get("/api/data/s1/statistics")
    body = resp.json()
    assert "authoritative" not in body
    assert "markers" not in body


def test_qc_multi_marker_has_authoritative_flag_and_warnings(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.clustering.cluster_store["s1"] = _multi_marker_cluster_result_with_warnings()

    resp = data_client.client.get("/api/data/s1/qc?cycle=1&use_rox=false")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["authoritative"] == "markers"
    by_id = {m["id"]: m for m in body["markers"]}
    assert by_id["m1"]["warnings"] == ["low_n"]
    assert by_id["m2"]["warnings"] is None
    # Pooled plate-level block is still present (not removed).
    assert "cluster_separation" in body
    assert "call_rate" in body


def test_qc_single_marker_has_no_authoritative_key(data_client):
    _register(data_client, "s1", _plate_unified(["A1", "A2", "A3", "A4"]))
    data_client.clustering.cluster_store["s1"] = ClusteringResult(
        algorithm="threshold", cycle=1,
        assignments={"A1": "Allele 1 Homo", "A2": "Allele 1 Homo", "A3": "Allele 2 Homo", "A4": "Allele 2 Homo"},
        ploidy=2,
    )
    resp = data_client.client.get("/api/data/s1/qc?cycle=1&use_rox=false")
    body = resp.json()
    assert "authoritative" not in body
    assert "markers" not in body
