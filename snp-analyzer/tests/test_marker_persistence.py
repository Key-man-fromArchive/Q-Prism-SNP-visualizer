"""Phase 2A: first-class marker (assay) definition persistence.

A marker region is a first-class resource (not a well-group). Its source of
truth is the new ``marker_regions`` table, NOT sessions.metadata_json (which
set_session_ploidy rewrites wholesale). It owns wells/ploidy/color/
threshold_config/name only -- well_type and sample_id stay in
manual_welltypes / sample_name_overrides and are never duplicated here.
"""
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UnifiedData, WellCycleData


# ---------------------------------------------------------------------------
# db.py-level round-trip tests (no HTTP layer)
# ---------------------------------------------------------------------------


@pytest.fixture
def fresh_db(tmp_path):
    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "markers.sqlite3"
    db.init_db()
    yield db
    if db._conn is not None:
        db._conn.close()
    db._conn = None


def _minimal_unified():
    wells = ["A1", "A2", "B1"]
    data = [
        WellCycleData(well=w, cycle=1, fam=1000.0, allele2=500.0, rox=800.0)
        for w in wells
    ]
    return UnifiedData(
        instrument="CFX Opus",
        allele2_dye="HEX",
        wells=wells,
        cycles=[1],
        data=data,
        has_rox=True,
        ploidy=2,
    )


def test_save_load_marker_regions_roundtrip(fresh_db):
    db = fresh_db
    sid = "sess-markers-1"
    db.save_session(sid, _minimal_unified(), filename="x.pcrd", user_id=None)

    regions = [
        {
            "id": "m1",
            "name": "qSwet5.3",
            "wells": ["A1", "A2"],
            "ploidy": 6,
            "color": "#ff0000",
            "threshold_config": {"ntc_threshold": 0.2},
        },
        {
            "id": "m2",
            "name": "qTotal11.1",
            "wells": ["B1"],
            "ploidy": 2,
            "color": None,
            "threshold_config": None,
        },
    ]
    db.save_marker_regions(sid, regions)

    loaded = db.load_marker_regions(sid)
    by_id = {r["id"]: r for r in loaded}
    assert set(by_id) == {"m1", "m2"}
    assert by_id["m1"]["wells"] == ["A1", "A2"]
    assert by_id["m1"]["ploidy"] == 6
    assert by_id["m1"]["color"] == "#ff0000"
    assert by_id["m1"]["threshold_config"] == {"ntc_threshold": 0.2}
    assert by_id["m2"]["wells"] == ["B1"]
    assert by_id["m2"]["color"] is None
    assert by_id["m2"]["threshold_config"] is None


def test_save_marker_regions_replaces_all(fresh_db):
    db = fresh_db
    sid = "sess-markers-2"
    db.save_session(sid, _minimal_unified(), filename="x.pcrd", user_id=None)

    db.save_marker_regions(sid, [
        {"id": "m1", "name": "A", "wells": ["A1"], "ploidy": 2, "color": None, "threshold_config": None},
    ])
    # Replace-all: m1 dropped, m2 added.
    db.save_marker_regions(sid, [
        {"id": "m2", "name": "B", "wells": ["A2"], "ploidy": 2, "color": None, "threshold_config": None},
    ])

    loaded = db.load_marker_regions(sid)
    assert [r["id"] for r in loaded] == ["m2"]


def test_delete_marker_regions(fresh_db):
    db = fresh_db
    sid = "sess-markers-3"
    db.save_session(sid, _minimal_unified(), filename="x.pcrd", user_id=None)
    db.save_marker_regions(sid, [
        {"id": "m1", "name": "A", "wells": ["A1"], "ploidy": 2, "color": None, "threshold_config": None},
    ])
    db.delete_marker_regions(sid)
    assert db.load_marker_regions(sid) == []


def test_load_all_sessions_includes_markers(fresh_db):
    db = fresh_db
    sid = "sess-markers-4"
    db.save_session(sid, _minimal_unified(), filename="x.pcrd", user_id=None)
    db.save_marker_regions(sid, [
        {"id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 4, "color": "#00ff00", "threshold_config": None},
    ])

    loaded = {s["session_id"]: s for s in db.load_all_sessions()}
    assert sid in loaded
    markers = loaded[sid]["markers"]
    assert len(markers) == 1
    assert markers[0]["id"] == "m1"
    assert markers[0]["ploidy"] == 4
    assert markers[0]["color"] == "#00ff00"


def test_session_with_no_markers_loads_fine(fresh_db):
    """Old sessions with no markers must load without error (empty list)."""
    db = fresh_db
    sid = "sess-no-markers"
    db.save_session(sid, _minimal_unified(), filename="x.pcrd", user_id=None)

    loaded = {s["session_id"]: s for s in db.load_all_sessions()}
    assert loaded[sid]["markers"] == []


# ---------------------------------------------------------------------------
# Migration test: simulate a v3 DB, then run init_db -> table + version 4.
# ---------------------------------------------------------------------------


def test_migration_4_adds_marker_regions_table_to_v3_db(tmp_path):
    import sqlite3

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "v3.sqlite3"

    # Build a schema-v3 DB by hand (pre-marker_regions), mirroring the existing
    # migration test pattern: create the base schema minus marker_regions,
    # then stamp version 3 without ever creating that table.
    conn = sqlite3.connect(str(db.DB_PATH))
    schema_sql = (
        db.Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    ).read_text()
    before, _, after = schema_sql.partition("-- Marker (assay) definitions")
    _, _, after = after.partition("-- Projects table (replaces projects.json)")
    v3_schema = before + "-- Projects table (replaces projects.json)" + after
    conn.executescript(v3_schema)
    conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (1)")
    conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (2)")
    conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (3)")
    conn.commit()

    # Sanity: marker_regions must NOT exist yet in this simulated v3 DB.
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "marker_regions" not in tables
    conn.close()

    # Now run init_db (as the real app does on startup) and verify migration 4
    # adds the table and bumps schema_version to 4, without touching existing
    # data.
    db.init_db()
    conn = db.get_db()
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "marker_regions" in tables
    version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    # init_db always chains to the latest migration (now 5, adding
    # saved_layouts) -- this test only asserts migration 4 itself ran.
    assert version >= 4

    # Migration 4 back-fills nothing: no markers exist for any session yet.
    assert db.load_marker_regions("any-session") == []

    if db._conn is not None:
        db._conn.close()
    db._conn = None


# ---------------------------------------------------------------------------
# HTTP endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def data_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-marker-tests",
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
        yield SimpleNamespace(client=client, upload=upload, clustering=clustering)

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
    import app.db as db

    data_client.upload.sessions[sid] = unified
    db.save_session(sid, unified, filename="test.eds", user_id=None)


def _plate_unified() -> UnifiedData:
    data = []
    wells = ["A1", "A2", "A3", "A4"]
    for w in wells:
        for cycle in [1, 2, 3]:
            data.append(
                WellCycleData(
                    well=w, cycle=cycle, fam=100.0 + cycle * 20, allele2=80.0 + cycle * 15, rox=None,
                )
            )
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=wells,
        cycles=[1, 2, 3],
        data=data,
        has_rox=False,
    )


def test_get_markers_empty_by_default(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.get("/api/data/s1/markers")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"markers": []}


def test_create_markers(data_client):
    _register(data_client, "s1", _plate_unified())
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={
            "markers": [
                {"id": "m1", "name": "qSwet5.3", "wells": ["A1", "A2"], "ploidy": 6, "color": "#ff0000"},
                {"id": "m2", "name": "qTotal11.1", "wells": ["A3", "A4"], "ploidy": 2},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    markers = resp.json()["markers"]
    assert {m["id"] for m in markers} == {"m1", "m2"}

    # Persisted -- a fresh GET returns the same set.
    resp2 = data_client.client.get("/api/data/s1/markers")
    assert resp2.status_code == 200
    markers2 = resp2.json()["markers"]
    assert {m["id"] for m in markers2} == {"m1", "m2"}
    m1 = next(m for m in markers2 if m["id"] == "m1")
    assert m1["wells"] == ["A1", "A2"]
    assert m1["ploidy"] == 6
    assert m1["color"] == "#ff0000"


def test_create_markers_rejects_overlapping_wells(data_client):
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


def test_create_markers_replaces_previous_set(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1"], "ploidy": 2}]},
    )
    resp = data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m2", "name": "B", "wells": ["A2"], "ploidy": 2}]},
    )
    assert resp.status_code == 200, resp.text

    resp2 = data_client.client.get("/api/data/s1/markers")
    ids = {m["id"] for m in resp2.json()["markers"]}
    assert ids == {"m2"}


def test_delete_markers(data_client):
    _register(data_client, "s1", _plate_unified())
    data_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1"], "ploidy": 2}]},
    )
    resp = data_client.client.delete("/api/data/s1/markers")
    assert resp.status_code == 200, resp.text

    resp2 = data_client.client.get("/api/data/s1/markers")
    assert resp2.json() == {"markers": []}


def test_markers_require_session_access(data_client):
    resp = data_client.client.get("/api/data/does-not-exist/markers")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# input_hash groundwork (A5): populated per-region in _run_regions.
# ---------------------------------------------------------------------------


def test_region_result_has_input_hash():
    import types

    from app.models import ClusteringAlgorithm, ClusteringRequest, MarkerRegion
    from app.routers.clustering import _run_regions

    wells = ["A1", "A2", "A3", "A4"]
    point_dicts = [
        {"well": w, "norm_fam": 500.0, "norm_allele2": 500.0} for w in wells
    ]
    regions = [MarkerRegion(id="m1", name="A", wells=wells, ploidy=2)]
    req = ClusteringRequest(algorithm=ClusteringAlgorithm.THRESHOLD, cycle=1, regions=regions)
    unified = types.SimpleNamespace(ploidy=2)

    result = _run_regions(req, unified, cycle=1, point_dicts=point_dicts, control_wells={})
    assert result.regions is not None and len(result.regions) == 1
    reg_result = result.regions[0]
    assert reg_result.input_hash is not None
    assert isinstance(reg_result.input_hash, str)
    assert len(reg_result.input_hash) == 16


def test_input_hash_stable_for_same_inputs_changes_when_wells_differ():
    import types

    from app.models import ClusteringAlgorithm, ClusteringRequest, MarkerRegion
    from app.routers.clustering import _run_regions

    def _run(wells, cycle=1):
        point_dicts = [
            {"well": w, "norm_fam": 500.0, "norm_allele2": 500.0} for w in wells
        ]
        regions = [MarkerRegion(id="m1", name="A", wells=wells, ploidy=2)]
        req = ClusteringRequest(algorithm=ClusteringAlgorithm.THRESHOLD, cycle=cycle, regions=regions)
        unified = types.SimpleNamespace(ploidy=2)
        result = _run_regions(req, unified, cycle=cycle, point_dicts=point_dicts, control_wells={})
        return result.regions[0].input_hash

    h1 = _run(["A1", "A2"])
    h2 = _run(["A1", "A2"])
    h3 = _run(["A1", "A3"])
    assert h1 == h2
    assert h1 != h3
