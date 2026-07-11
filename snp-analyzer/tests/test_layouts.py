"""Phase 3 (P3-layouts): per-user saved plate-layout library.

A layout snapshots a session's CURRENT marker set (+ optional well types/
sample ids) so it can be applied to a different session later. Scope is the
owning user only -- TokenData has no team/org concept -- so sharing is an
explicit copy, never a shared/team scope.
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
    db.DB_PATH = tmp_path / "layouts.sqlite3"
    db.init_db()
    yield db
    if db._conn is not None:
        db._conn.close()
    db._conn = None


def _insert_user(db, user_id: str, username: str):
    conn = db.get_db()
    conn.execute(
        "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
        (user_id, username, "x", username, "user"),
    )
    conn.commit()


def _sample_snapshot() -> dict:
    return {
        "schema_version": 1,
        "plate": {"rows": 8, "cols": 12},
        "markers": [
            {
                "id": "m1",
                "name": "qSwet5.3",
                "wells": ["A1", "A2"],
                "ploidy": 6,
                "color": "#ff0000",
                "threshold_config": {"ntc_threshold": 0.2},
            }
        ],
    }


def test_save_load_layout_roundtrip(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")

    db.save_layout("lay-1", "u1", "My Layout", _sample_snapshot())
    loaded = db.get_layout("lay-1")

    assert loaded["id"] == "lay-1"
    assert loaded["owner_user_id"] == "u1"
    assert loaded["name"] == "My Layout"
    assert loaded["snapshot"]["markers"][0]["id"] == "m1"
    assert loaded["snapshot"]["markers"][0]["ploidy"] == 6


def test_get_layout_missing_returns_none(fresh_db):
    assert fresh_db.get_layout("does-not-exist") is None


def test_list_layouts_scoped_to_owner(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    _insert_user(db, "u2", "bob")

    db.save_layout("lay-1", "u1", "Alice's Layout", _sample_snapshot())
    db.save_layout("lay-2", "u2", "Bob's Layout", _sample_snapshot())

    alice_layouts = db.list_layouts("u1")
    assert [row["id"] for row in alice_layouts] == ["lay-1"]

    bob_layouts = db.list_layouts("u2")
    assert [row["id"] for row in bob_layouts] == ["lay-2"]


def test_delete_layout(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.save_layout("lay-1", "u1", "L", _sample_snapshot())
    db.delete_layout("lay-1")
    assert db.get_layout("lay-1") is None


# ---------------------------------------------------------------------------
# Migration test: simulate a v4 DB, then run init_db -> table + version 5.
# ---------------------------------------------------------------------------


def test_migration_5_adds_saved_layouts_table_to_v4_db(tmp_path):
    import sqlite3

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "v4.sqlite3"

    # Build a schema-v4 DB by hand (pre-saved_layouts), mirroring the
    # existing migration test pattern: create the base schema minus
    # saved_layouts, then stamp versions 1-4 without ever creating that table.
    conn = sqlite3.connect(str(db.DB_PATH))
    schema_sql = (
        db.Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    ).read_text()
    before, _, after = schema_sql.partition("-- Saved plate layouts")
    _, _, after = after.partition("-- Projects table (replaces projects.json)")
    v4_schema = before + "-- Projects table (replaces projects.json)" + after
    conn.executescript(v4_schema)
    for v in (1, 2, 3, 4):
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (?)", (v,))
    conn.commit()

    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "saved_layouts" not in tables
    conn.close()

    db.init_db()
    conn = db.get_db()
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "saved_layouts" in tables
    version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    # init_db always chains to the latest migration (now 6, adding
    # marker_catalog) -- this test only asserts migration 5 itself ran.
    assert version >= 5

    # Migration 5 back-fills nothing: no layouts exist for any user yet.
    assert db.list_layouts("any-user") == []

    if db._conn is not None:
        db._conn.close()
    db._conn = None


# ---------------------------------------------------------------------------
# HTTP endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def layouts_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-layout-tests",
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
    from app.routers import sample

    state = {"user_id": "user-1", "username": "user1", "role": "user"}

    async def current_user_override():
        return TokenData(user_id=state["user_id"], username=state["username"], role=state["role"])

    app.dependency_overrides[get_current_user] = current_user_override
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    clustering.group_store.clear()
    clustering.marker_store.clear()
    sample.sample_name_store.clear()

    with TestClient(app) as client:
        # Real user rows for the FK on saved_layouts.owner_user_id.
        _insert_user(db, "user-1", "user1")
        _insert_user(db, "user-2", "user2")
        yield SimpleNamespace(
            client=client, upload=upload, clustering=clustering, sample=sample, state=state
        )

    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    clustering.group_store.clear()
    clustering.marker_store.clear()
    sample.sample_name_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(layouts_client, sid: str, unified: UnifiedData):
    import app.db as db

    layouts_client.upload.sessions[sid] = unified
    db.save_session(sid, unified, filename="test.eds", user_id=None)


def _plate_unified(wells=None) -> UnifiedData:
    wells = wells or ["A1", "A2", "A3", "A4"]
    data = []
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


def test_list_layouts_empty_by_default(layouts_client):
    resp = layouts_client.client.get("/api/layouts")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"layouts": []}


def test_create_layout_snapshots_current_markers(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [
            {"id": "m1", "name": "qSwet5.3", "wells": ["A1", "A2"], "ploidy": 6, "color": "#ff0000"},
            {"id": "m2", "name": "qTotal11.1", "wells": ["A3", "A4"], "ploidy": 2},
        ]},
    )

    resp = layouts_client.client.post("/api/layouts", json={"name": "Assay Set A", "sid": "s1"})
    assert resp.status_code == 200, resp.text
    layout = resp.json()
    assert layout["name"] == "Assay Set A"
    assert layout["owner_user_id"] == "user-1"
    snap = layout["snapshot"]
    assert snap["schema_version"] == 1
    assert snap["plate"] == {"rows": 1, "cols": 4}
    ids = {m["id"] for m in snap["markers"]}
    assert ids == {"m1", "m2"}

    # Persisted -- appears in the list.
    resp2 = layouts_client.client.get("/api/layouts")
    assert [row["id"] for row in resp2.json()["layouts"]] == [layout["id"]]


def test_create_layout_rejects_empty_name(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    resp = layouts_client.client.post("/api/layouts", json={"name": "  ", "sid": "s1"})
    assert resp.status_code == 400


def test_create_layout_404_for_missing_session(layouts_client):
    resp = layouts_client.client.post("/api/layouts", json={"name": "L", "sid": "nope"})
    assert resp.status_code == 404


def test_get_layout(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    created = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    resp = layouts_client.client.get(f"/api/layouts/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


def test_get_layout_404_if_missing(layouts_client):
    resp = layouts_client.client.get("/api/layouts/does-not-exist")
    assert resp.status_code == 404


def test_delete_layout_http(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    created = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    resp = layouts_client.client.delete(f"/api/layouts/{created['id']}")
    assert resp.status_code == 200

    resp2 = layouts_client.client.get(f"/api/layouts/{created['id']}")
    assert resp2.status_code == 404


# --- scope isolation: user A cannot GET/DELETE user B's layout -------------


def test_scope_isolation_get(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    created = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    layouts_client.state["user_id"] = "user-2"
    resp = layouts_client.client.get(f"/api/layouts/{created['id']}")
    assert resp.status_code == 404


def test_scope_isolation_delete(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    created = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    layouts_client.state["user_id"] = "user-2"
    resp = layouts_client.client.delete(f"/api/layouts/{created['id']}")
    assert resp.status_code == 404

    # Original owner still has it -- delete-as-non-owner did not remove it.
    layouts_client.state["user_id"] = "user-1"
    resp2 = layouts_client.client.get(f"/api/layouts/{created['id']}")
    assert resp2.status_code == 200


def test_scope_isolation_list(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post("/api/layouts", json={"name": "L", "sid": "s1"})

    layouts_client.state["user_id"] = "user-2"
    resp = layouts_client.client.get("/api/layouts")
    assert resp.json() == {"layouts": []}


# --- copy -------------------------------------------------------------------


def test_copy_layout_creates_independent_entry_owned_by_caller(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    created = layouts_client.client.post(
        "/api/layouts", json={"name": "Original", "sid": "s1"}
    ).json()

    layouts_client.state["user_id"] = "user-2"
    resp = layouts_client.client.post(f"/api/layouts/{created['id']}/copy")
    assert resp.status_code == 200, resp.text
    copy = resp.json()
    assert copy["id"] != created["id"]
    assert copy["owner_user_id"] == "user-2"
    assert "Original" in copy["name"]
    assert copy["snapshot"] == created["snapshot"]

    # The original owner's layout is untouched.
    layouts_client.state["user_id"] = "user-1"
    resp2 = layouts_client.client.get(f"/api/layouts/{created['id']}")
    assert resp2.status_code == 200


def test_copy_layout_404_if_missing(layouts_client):
    resp = layouts_client.client.post("/api/layouts/does-not-exist/copy")
    assert resp.status_code == 404


# --- apply -------------------------------------------------------------------


def test_apply_layout_writes_markers_into_target_session(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 6, "color": "#abc"}]},
    )
    layout = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    _register(layouts_client, "s2", _plate_unified())
    resp = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply", json={"sid": "s2"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    applied = {m["id"]: m for m in body["markers"]}
    assert applied["m1"]["wells"] == ["A1", "A2"]
    assert applied["m1"]["ploidy"] == 6

    # Reflected via GET /api/data/s2/markers too.
    resp2 = layouts_client.client.get("/api/data/s2/markers")
    ids = {m["id"] for m in resp2.json()["markers"]}
    assert ids == {"m1"}


def test_apply_layout_404_if_not_owner(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    layout = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    layouts_client.state["user_id"] = "user-2"
    _register(layouts_client, "s2", _plate_unified())
    resp = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply", json={"sid": "s2"}
    )
    assert resp.status_code == 404


def test_apply_layout_l3_rejects_missing_wells(layouts_client):
    """L3: layout's wells must all exist on the target plate."""
    _register(layouts_client, "s1", _plate_unified(["A1", "A2", "A3", "A4"]))
    layouts_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 2}]},
    )
    layout = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    # Target plate does not have well A2.
    _register(layouts_client, "s2", _plate_unified(["A1", "B1"]))
    resp = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply", json={"sid": "s2"}
    )
    assert resp.status_code == 400, resp.text
    assert "A2" in resp.text


def test_apply_layout_l2_conflict_requires_force(layouts_client):
    """L2: applying must not silently change ploidy for an existing marker id."""
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 6}]},
    )
    layout = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    _register(layouts_client, "s2", _plate_unified())
    layouts_client.client.post(
        "/api/data/s2/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 2}]},
    )

    resp = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply", json={"sid": "s2"}
    )
    assert resp.status_code == 409, resp.text
    assert "m1" in resp.text

    # force=True confirms the change.
    resp2 = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply", json={"sid": "s2", "force": True}
    )
    assert resp2.status_code == 200, resp2.text
    applied = {m["id"]: m for m in resp2.json()["markers"]}
    assert applied["m1"]["ploidy"] == 6


def test_apply_layout_l4_drops_threshold_config_by_default(layouts_client):
    """L4: apply_analysis_settings=false (default) must not carry boundaries."""
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{
            "id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 2,
            "threshold_config": {"boundaries": [0.5], "offset": 0},
        }]},
    )
    layout = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()
    assert layout["snapshot"]["markers"][0]["threshold_config"]["boundaries"] == [0.5]

    _register(layouts_client, "s2", _plate_unified())
    resp = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply", json={"sid": "s2"}
    )
    assert resp.status_code == 200, resp.text
    applied = {m["id"]: m for m in resp.json()["markers"]}
    assert applied["m1"].get("threshold_config") is None


def test_apply_layout_l4_keeps_threshold_config_when_opted_in(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{
            "id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 2,
            "threshold_config": {"boundaries": [0.5], "offset": 0},
        }]},
    )
    layout = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()

    _register(layouts_client, "s2", _plate_unified())
    resp = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply",
        json={"sid": "s2", "apply_analysis_settings": True},
    )
    assert resp.status_code == 200, resp.text
    applied = {m["id"]: m for m in resp.json()["markers"]}
    assert applied["m1"]["threshold_config"]["boundaries"] == [0.5]


def test_apply_layout_carries_well_types_not_sample_ids(layouts_client):
    """Documented carryover choice: well_type roles are physical-design and
    travel with the marker set; sample_ids are per-run data and never do."""
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "A", "wells": ["A1", "A2"], "ploidy": 2}]},
    )
    layouts_client.client.post(
        "/api/data/s1/welltypes",
        json={"wells": ["A1"], "well_type": "NTC"},
    )
    layouts_client.client.put(
        "/api/data/s1/samples", json={"samples": {"A1": "Patient-42"}}
    )
    layout = layouts_client.client.post(
        "/api/layouts", json={"name": "L", "sid": "s1"}
    ).json()
    assert layout["snapshot"]["well_types"] == {"A1": "NTC"}
    assert layout["snapshot"]["sample_ids"] == {"A1": "Patient-42"}

    _register(layouts_client, "s2", _plate_unified())
    resp = layouts_client.client.post(
        f"/api/layouts/{layout['id']}/apply", json={"sid": "s2"}
    )
    assert resp.status_code == 200, resp.text

    wt_resp = layouts_client.client.get("/api/data/s2/welltypes")
    assert wt_resp.json()["assignments"].get("A1") == "NTC"

    samples_resp = layouts_client.client.get("/api/data/s2/samples")
    assert samples_resp.json()["samples"].get("A1") is None
