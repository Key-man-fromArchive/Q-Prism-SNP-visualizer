"""StepOnePlus session survives a process restart with its StepOne-only fields.

Upload -> drop every process-local cache -> reopen through the same
``GET /api/sessions/{sid}`` path the frontend uses.
"""

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from tests import stepone_fixtures as so


@pytest.fixture
def restore(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-stepone-restore",
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
    db.DB_PATH = tmp_path / "stepone-restore.sqlite3"
    from app.main import app
    from app.routers import clustering, data, sample, upload
    from app.services import session_restore

    async def user():
        return TokenData(user_id="user-1", username="user1", role="user")

    def drop_caches():
        upload.sessions.clear()
        clustering.cluster_store.clear()
        clustering.welltype_store.clear()
        clustering.group_store.clear()
        clustering.marker_store.clear()
        sample.sample_name_store.clear()
        data.protocol_store.clear()
        session_restore._access_order.clear()

    app.dependency_overrides[get_current_user] = user
    drop_caches()
    with TestClient(app) as client:
        conn = db.get_db()
        conn.execute(
            "INSERT OR IGNORE INTO users (id, username, hashed_password, display_name, role) "
            "VALUES (?, ?, ?, ?, ?)",
            ("user-1", "stepone-restore", "x", "stepone-restore", "user"),
        )
        conn.commit()
        yield client, drop_caches, upload
    app.dependency_overrides.pop(get_current_user, None)
    drop_caches()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _upload(client) -> dict:
    response = client.post(
        "/api/upload",
        files={
            "file": ("plate.eds", so.build_stepone_eds(), "application/octet-stream")
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_suggested_cycle_is_two_after_restart(restore):
    client, drop_caches, upload = restore
    body = _upload(client)
    assert body["suggested_cycle"] == 2

    drop_caches()
    assert body["session_id"] not in upload.sessions

    reopened = client.get(f"/api/sessions/{body['session_id']}")
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["suggested_cycle"] == 2


def test_stepone_fields_round_trip_through_the_database(restore):
    client, drop_caches, upload = restore
    sid = _upload(client)["session_id"]
    drop_caches()
    client.get(f"/api/sessions/{sid}")

    restored = upload.sessions[sid]
    assert restored.default_cycle == 2
    assert restored.has_amplification_curve is False
    assert restored.read_labels[2].pcr_cycle == 36
    assert restored.read_labels[2].temperature == 40.0
    assert restored.imported_marker_alleles["QPrism1"].fam == "WT"
    assert restored.imported_marker_alleles["QPrism1"].allele2 == "MT"


def test_default_cycle_outside_cycles_is_ignored_after_restore(restore):
    client, drop_caches, upload = restore
    sid = _upload(client)["session_id"]
    upload.sessions[sid].default_cycle = 99
    import app.db as db

    db.save_session(sid, upload.sessions[sid], filename="plate.eds", user_id="user-1")
    drop_caches()

    reopened = client.get(f"/api/sessions/{sid}")
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["suggested_cycle"] != 99
