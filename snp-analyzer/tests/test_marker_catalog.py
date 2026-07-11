"""Marker (assay) CATALOG -- durable, user-scoped, plate-independent assay
registry (distinct from the ephemeral per-session marker_regions /
app/routers/layouts.py plate snapshots). Mirrors tests/test_layouts.py's
structure and fixtures closely.
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
    db.DB_PATH = tmp_path / "marker_catalog.sqlite3"
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


def _sample_entry_data() -> dict:
    return {
        "name": "qSwet5.3",
        "target_gene": "Swet5",
        "snp_id": "rs123",
        "allele1_base": "A",
        "allele2_base": "G",
        "chemistry": "KASP",
        "default_ploidy": 6,
        "color": "#ff0000",
        "expected_dosage_classes": 7,
        "interpretation_notes": "hexaploid sweetpotato marker",
        "asg_target_id": "asg-target-1",
        "calibration": {
            "controls_present": True,
            "amplification_verified": True,
            "defined_ratio_points": [{"ratio": 0.5, "expected_dosage": 3}],
            "notes": "calibrated against controls",
            "verified_at": "2026-01-01T00:00:00Z",
        },
        "validation": {
            "status": "validated",
            "ground_truth_method": "SNP array",
            "n_compared": 50,
            "concordance": 0.98,
            "notes": "validated against array data",
        },
    }


def test_save_load_catalog_entry_roundtrip(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")

    db.save_marker_catalog_entry("cat-1", "u1", _sample_entry_data())
    loaded = db.get_marker_catalog_entry("cat-1")

    assert loaded["id"] == "cat-1"
    assert loaded["owner_user_id"] == "u1"
    assert loaded["name"] == "qSwet5.3"
    assert loaded["default_ploidy"] == 6
    assert loaded["calibration"]["amplification_verified"] is True
    assert loaded["validation"]["status"] == "validated"
    assert loaded["validation"]["concordance"] == 0.98


def test_get_catalog_entry_missing_returns_none(fresh_db):
    assert fresh_db.get_marker_catalog_entry("does-not-exist") is None


def test_list_catalog_entries_scoped_to_owner(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    _insert_user(db, "u2", "bob")

    db.save_marker_catalog_entry("cat-1", "u1", _sample_entry_data())
    db.save_marker_catalog_entry("cat-2", "u2", _sample_entry_data())

    assert [r["id"] for r in db.list_marker_catalog_entries("u1")] == ["cat-1"]
    assert [r["id"] for r in db.list_marker_catalog_entries("u2")] == ["cat-2"]


def test_update_catalog_entry(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.save_marker_catalog_entry("cat-1", "u1", _sample_entry_data())

    data = _sample_entry_data()
    data["name"] = "qSwet5.3-updated"
    data["default_ploidy"] = 4
    db.update_marker_catalog_entry("cat-1", data)

    loaded = db.get_marker_catalog_entry("cat-1")
    assert loaded["name"] == "qSwet5.3-updated"
    assert loaded["default_ploidy"] == 4


def test_delete_catalog_entry(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.save_marker_catalog_entry("cat-1", "u1", _sample_entry_data())

    db.delete_marker_catalog_entry("cat-1")
    assert db.get_marker_catalog_entry("cat-1") is None


# ---------------------------------------------------------------------------
# Migration 6 (on a simulated v5 DB)
# ---------------------------------------------------------------------------


def test_migration_6_adds_marker_catalog_table_and_catalog_id_column(tmp_path):
    import sqlite3

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "v5.sqlite3"

    # Build a schema-v5 DB by hand (pre-marker_catalog, marker_regions
    # without catalog_id), mirroring the existing migration test pattern.
    conn = sqlite3.connect(str(db.DB_PATH))
    schema_sql = (
        db.Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    ).read_text()

    # Strip the catalog_id column out of marker_regions (simulate pre-mig-6).
    v5_schema = schema_sql.replace(
        "    -- Optional link to a durable marker_catalog entry (see below) this\n"
        "    -- session marker was attached to. Nullable: most markers never link.\n"
        "    catalog_id TEXT,\n",
        "",
    )
    # Strip out the marker_catalog table entirely.
    before, _, after = v5_schema.partition("-- Marker (assay) CATALOG")
    _, _, after = after.partition("-- Saved plate layouts")
    v5_schema = before + "-- Saved plate layouts" + after

    conn.executescript(v5_schema)
    for v in (1, 2, 3, 4, 5):
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (?)", (v,))
    conn.commit()

    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "marker_catalog" not in tables
    cols = [r[1] for r in conn.execute("PRAGMA table_info(marker_regions)").fetchall()]
    assert "catalog_id" not in cols
    conn.close()

    db.init_db()
    conn = db.get_db()
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "marker_catalog" in tables
    cols = [r[1] for r in conn.execute("PRAGMA table_info(marker_regions)").fetchall()]
    assert "catalog_id" in cols
    version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert version == 6

    # Migration 6 back-fills nothing.
    assert db.list_marker_catalog_entries("any-user") == []

    if db._conn is not None:
        db._conn.close()
    db._conn = None


# ---------------------------------------------------------------------------
# HTTP endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def catalog_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-catalog-tests",
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


def _register(catalog_client, sid: str, unified: UnifiedData):
    import app.db as db

    catalog_client.upload.sessions[sid] = unified
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


def _create_body(**overrides) -> dict:
    body = {
        "name": "qSwet5.3",
        "target_gene": "Swet5",
        "default_ploidy": 6,
        "color": "#ff0000",
    }
    body.update(overrides)
    return body


def test_list_catalog_empty_by_default(catalog_client):
    resp = catalog_client.client.get("/api/marker-catalog")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"entries": []}


def test_create_catalog_entry(catalog_client):
    resp = catalog_client.client.post("/api/marker-catalog", json=_create_body())
    assert resp.status_code == 200, resp.text
    entry = resp.json()
    assert entry["name"] == "qSwet5.3"
    assert entry["owner_user_id"] == "user-1"
    assert entry["default_ploidy"] == 6
    assert entry["dosage_trust"] == "putative"  # default calibration/validation

    resp2 = catalog_client.client.get("/api/marker-catalog")
    assert [e["id"] for e in resp2.json()["entries"]] == [entry["id"]]


def test_create_catalog_entry_rejects_empty_name(catalog_client):
    resp = catalog_client.client.post("/api/marker-catalog", json=_create_body(name="  "))
    assert resp.status_code == 400


def test_create_catalog_entry_rejects_invalid_ploidy(catalog_client):
    resp = catalog_client.client.post("/api/marker-catalog", json=_create_body(default_ploidy=1))
    assert resp.status_code == 400


def test_create_catalog_entry_rejects_invalid_concordance(catalog_client):
    body = _create_body(validation={"status": "validated", "concordance": 1.5})
    resp = catalog_client.client.post("/api/marker-catalog", json=body)
    assert resp.status_code == 400


def test_dosage_trust_validated_requires_both_conditions(catalog_client):
    # validated status alone (without amplification_verified) => putative.
    body = _create_body(validation={"status": "validated"})
    resp = catalog_client.client.post("/api/marker-catalog", json=body)
    assert resp.json()["dosage_trust"] == "putative"

    # amplification_verified alone (without validated status) => putative.
    body = _create_body(calibration={"amplification_verified": True})
    resp = catalog_client.client.post("/api/marker-catalog", json=body)
    assert resp.json()["dosage_trust"] == "putative"

    # both conditions => validated.
    body = _create_body(
        calibration={"amplification_verified": True},
        validation={"status": "validated"},
    )
    resp = catalog_client.client.post("/api/marker-catalog", json=body)
    assert resp.json()["dosage_trust"] == "validated"


def test_get_catalog_entry_404_for_missing(catalog_client):
    resp = catalog_client.client.get("/api/marker-catalog/does-not-exist")
    assert resp.status_code == 404


def test_update_catalog_entry_partial(catalog_client):
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    resp = catalog_client.client.put(
        f"/api/marker-catalog/{created['id']}", json={"default_ploidy": 4}
    )
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["default_ploidy"] == 4
    assert updated["name"] == "qSwet5.3"  # untouched field preserved


def test_delete_catalog_entry(catalog_client):
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    resp = catalog_client.client.delete(f"/api/marker-catalog/{created['id']}")
    assert resp.status_code == 200

    resp2 = catalog_client.client.get(f"/api/marker-catalog/{created['id']}")
    assert resp2.status_code == 404


def test_copy_catalog_entry_creates_independent_copy_for_any_user(catalog_client):
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    # Switch to user-2 and copy user-1's entry.
    catalog_client.state["user_id"] = "user-2"
    catalog_client.state["username"] = "user2"

    resp = catalog_client.client.post(f"/api/marker-catalog/{created['id']}/copy")
    assert resp.status_code == 200, resp.text
    copy = resp.json()
    assert copy["owner_user_id"] == "user-2"
    assert copy["id"] != created["id"]
    assert copy["name"] == "qSwet5.3 (copy)"

    # Editing the copy never touches the original.
    catalog_client.client.put(f"/api/marker-catalog/{copy['id']}", json={"default_ploidy": 8})
    original = catalog_client.client.get(f"/api/marker-catalog/{created['id']}")
    # user-2 cannot read user-1's original (404) -- switch back to verify unchanged.
    assert original.status_code == 404
    catalog_client.state["user_id"] = "user-1"
    catalog_client.state["username"] = "user1"
    original = catalog_client.client.get(f"/api/marker-catalog/{created['id']}")
    assert original.json()["default_ploidy"] == 6


# ---------------------------------------------------------------------------
# Scope isolation: user A cannot GET/PUT/DELETE user B's entry, but CAN copy.
# ---------------------------------------------------------------------------


def test_scope_isolation_get_put_delete_404_but_copy_allowed(catalog_client):
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    catalog_client.state["user_id"] = "user-2"
    catalog_client.state["username"] = "user2"

    assert catalog_client.client.get(f"/api/marker-catalog/{created['id']}").status_code == 404
    assert catalog_client.client.put(
        f"/api/marker-catalog/{created['id']}", json={"name": "hijacked"}
    ).status_code == 404
    assert catalog_client.client.delete(f"/api/marker-catalog/{created['id']}").status_code == 404

    # But copying by id is explicitly allowed regardless of ownership.
    resp = catalog_client.client.post(f"/api/marker-catalog/{created['id']}/copy")
    assert resp.status_code == 200

    # The original is untouched -- confirm as user-1.
    catalog_client.state["user_id"] = "user-1"
    catalog_client.state["username"] = "user1"
    resp = catalog_client.client.get(f"/api/marker-catalog/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "qSwet5.3"


# ---------------------------------------------------------------------------
# attach-catalog
# ---------------------------------------------------------------------------


def test_attach_catalog_prefills_ploidy_and_color_when_unset(catalog_client):
    _register(catalog_client, "s1", _plate_unified())
    catalog_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [
            {"id": "m1", "name": "qSwet5.3", "wells": ["A1", "A2"]},  # ploidy defaults 2, color None
        ]},
    )
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    resp = catalog_client.client.post(
        "/api/data/s1/markers/m1/attach-catalog", json={"catalog_id": created["id"]}
    )
    assert resp.status_code == 200, resp.text
    marker = resp.json()
    assert marker["catalog_id"] == created["id"]
    assert marker["ploidy"] == 6
    assert marker["color"] == "#ff0000"


def test_attach_catalog_does_not_overwrite_customized_ploidy_or_color(catalog_client):
    _register(catalog_client, "s1", _plate_unified())
    catalog_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [
            {"id": "m1", "name": "qSwet5.3", "wells": ["A1", "A2"], "ploidy": 4, "color": "#00ff00"},
        ]},
    )
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    resp = catalog_client.client.post(
        "/api/data/s1/markers/m1/attach-catalog", json={"catalog_id": created["id"]}
    )
    assert resp.status_code == 200, resp.text
    marker = resp.json()
    assert marker["catalog_id"] == created["id"]
    assert marker["ploidy"] == 4
    assert marker["color"] == "#00ff00"


def test_attach_catalog_404_for_missing_marker(catalog_client):
    _register(catalog_client, "s1", _plate_unified())
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    resp = catalog_client.client.post(
        "/api/data/s1/markers/does-not-exist/attach-catalog", json={"catalog_id": created["id"]}
    )
    assert resp.status_code == 404


def test_attach_catalog_404_for_catalog_entry_not_owned(catalog_client):
    _register(catalog_client, "s1", _plate_unified())
    catalog_client.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "qSwet5.3", "wells": ["A1", "A2"]}]},
    )
    created = catalog_client.client.post("/api/marker-catalog", json=_create_body()).json()

    # user-2 owns the session's marker attach attempt but not the catalog entry.
    catalog_client.state["user_id"] = "user-2"
    catalog_client.state["username"] = "user2"
    resp = catalog_client.client.post(
        "/api/data/s1/markers/m1/attach-catalog", json={"catalog_id": created["id"]}
    )
    assert resp.status_code == 404
