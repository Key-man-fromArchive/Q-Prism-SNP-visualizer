"""User presets belong to the user who saved them and live in the app DB."""
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user

SETTINGS = {"algorithm": "threshold", "ntc_threshold": 0.2, "use_rox": True}


def _insert_user(db, user_id: str, username: str):
    conn = db.get_db()
    conn.execute(
        "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
        (user_id, username, "x", username, "user"),
    )
    conn.commit()


@pytest.fixture
def ctx(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-preset-tests",
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
    db.DB_PATH = tmp_path / "presets.sqlite3"

    from app.main import app

    state = {"user_id": "user-a", "username": "alice", "role": "user"}

    async def current_user_override():
        return TokenData(user_id=state["user_id"], username=state["username"], role=state["role"])

    app.dependency_overrides[get_current_user] = current_user_override

    with TestClient(app) as client:
        _insert_user(db, "user-a", "alice")
        _insert_user(db, "user-b", "bob")

        def as_user(user_id: str):
            state["user_id"] = user_id
            state["username"] = user_id

        yield SimpleNamespace(client=client, as_user=as_user, db=db)

    app.dependency_overrides.pop(get_current_user, None)
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _create(ctx, name="My preset", settings=None):
    resp = ctx.client.post("/api/presets", json={"name": name, "settings": settings or SETTINGS})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ids(ctx):
    return [p["id"] for p in ctx.client.get("/api/presets").json()["presets"]]


def test_create_returns_preset_shape(ctx):
    preset = _create(ctx, "  Padded name  ")
    assert set(preset) == {"id", "name", "builtin", "settings"}
    assert preset["name"] == "Padded name"
    assert preset["builtin"] is False
    assert preset["settings"] == SETTINGS
    assert len(preset["id"]) >= 16
    assert all(c in "0123456789abcdef" for c in preset["id"])


def test_presets_listed_only_for_the_user_who_saved_them(ctx):
    mine = _create(ctx)
    assert mine["id"] in _ids(ctx)

    ctx.as_user("user-b")
    assert mine["id"] not in _ids(ctx)


def test_other_users_cannot_update_or_delete_a_preset(ctx):
    mine = _create(ctx)

    ctx.as_user("user-b")
    put = ctx.client.put(f"/api/presets/{mine['id']}", json={"name": "Renamed", "settings": {"x": 1}})
    assert put.status_code == 404
    assert put.json()["detail"] == "Preset not found"
    delete = ctx.client.delete(f"/api/presets/{mine['id']}")
    assert delete.status_code == 404
    assert delete.json()["detail"] == "Preset not found"
    # Same answer as for a preset that does not exist at all.
    missing = ctx.client.delete("/api/presets/does-not-exist")
    assert missing.status_code == 404
    assert missing.json() == delete.json()

    ctx.as_user("user-a")
    listed = {p["id"]: p for p in ctx.client.get("/api/presets").json()["presets"]}
    assert listed[mine["id"]]["name"] == "My preset"
    assert listed[mine["id"]]["settings"] == SETTINGS


def test_owner_can_update_and_delete(ctx):
    mine = _create(ctx)

    put = ctx.client.put(f"/api/presets/{mine['id']}", json={"name": "Renamed"})
    assert put.status_code == 200, put.text
    assert put.json() == {"id": mine["id"], "name": "Renamed", "builtin": False, "settings": SETTINGS}

    put = ctx.client.put(f"/api/presets/{mine['id']}", json={"settings": {"n_clusters": 3}})
    assert put.status_code == 200
    assert put.json()["name"] == "Renamed"
    assert put.json()["settings"] == {"n_clusters": 3}

    delete = ctx.client.delete(f"/api/presets/{mine['id']}")
    assert delete.status_code == 200
    assert delete.json() == {"status": "ok"}
    assert mine["id"] not in _ids(ctx)
    assert ctx.client.delete(f"/api/presets/{mine['id']}").status_code == 404


def test_builtin_presets_visible_to_everyone_and_read_only(ctx):
    for user in ("user-a", "user-b"):
        ctx.as_user(user)
        presets = ctx.client.get("/api/presets").json()["presets"]
        builtin_ids = [p["id"] for p in presets if p["builtin"]]
        assert "default-asgpcr" in builtin_ids and "cfx-no-rox" in builtin_ids
        assert ctx.client.put("/api/presets/default-asgpcr", json={"name": "x"}).status_code == 400
        assert ctx.client.delete("/api/presets/cfx-no-rox").status_code == 400
    assert ctx.client.get("/api/presets").json()["presets"][0]["id"] == "default-asgpcr"


def test_oversize_settings_rejected(ctx):
    big = {"blob": "x" * (16 * 1024)}
    resp = ctx.client.post("/api/presets", json={"name": "Big", "settings": big})
    assert resp.status_code == 422
    mine = _create(ctx)
    assert ctx.client.put(f"/api/presets/{mine['id']}", json={"settings": big}).status_code == 422
    # Just under the limit is accepted.
    ok = {"blob": "x" * (16 * 1024 - 64)}
    assert ctx.client.post("/api/presets", json={"name": "Ok", "settings": ok}).status_code == 200


def test_settings_must_be_an_object(ctx):
    for bad in ([1, 2], "text", 5, None):
        resp = ctx.client.post("/api/presets", json={"name": "Bad", "settings": bad})
        assert resp.status_code == 422


@pytest.mark.parametrize("name", ["", "   ", "n" * 101])
def test_invalid_names_rejected(ctx, name):
    assert ctx.client.post("/api/presets", json={"name": name, "settings": SETTINGS}).status_code == 422
    mine = _create(ctx)
    assert ctx.client.put(f"/api/presets/{mine['id']}", json={"name": name}).status_code == 422


def test_name_at_maximum_length_accepted(ctx):
    assert _create(ctx, "n" * 100)["name"] == "n" * 100


def test_per_user_preset_limit(ctx, monkeypatch):
    from app.routers import presets

    monkeypatch.setattr(presets, "MAX_PRESETS_PER_USER", 3)
    for i in range(3):
        _create(ctx, f"p{i}")
    resp = ctx.client.post("/api/presets", json={"name": "extra", "settings": SETTINGS})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Preset limit reached"

    # The limit is per user, and deleting frees a slot.
    ctx.as_user("user-b")
    _create(ctx, "bobs")
    ctx.as_user("user-a")
    first = [p for p in ctx.client.get("/api/presets").json()["presets"] if not p["builtin"]][0]
    assert ctx.client.delete(f"/api/presets/{first['id']}").status_code == 200
    _create(ctx, "again")


def test_presets_survive_a_restart(ctx):
    mine = _create(ctx)
    db = ctx.db

    # Reopen the database from disk with a fresh connection.
    db._conn.close()
    db._conn = None
    db.init_db()

    assert mine["id"] in _ids(ctx)
    rows = db.get_db().execute(
        "SELECT owner_user_id, name FROM user_presets WHERE id = ?", (mine["id"],)
    ).fetchall()
    assert [tuple(r) for r in rows] == [("user-a", "My preset")]


def test_init_db_is_idempotent_for_presets_table(ctx):
    mine = _create(ctx)
    ctx.db.init_db()
    ctx.db.init_db()
    assert mine["id"] in _ids(ctx)


def test_legacy_preset_file_is_ignored(ctx, tmp_path, monkeypatch):
    import json
    from app.routers import presets

    legacy = tmp_path / "presets.json"
    legacy.write_text(json.dumps([{"id": "legacy1", "name": "Old", "settings": {}}]))
    monkeypatch.setattr(presets, "PRESETS_FILE", legacy, raising=False)
    assert "legacy1" not in _ids(ctx)
