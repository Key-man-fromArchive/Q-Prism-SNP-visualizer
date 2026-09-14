"""P32: retain the ORIGINAL uploaded file (not just its parsed readings) on
disk for a bounded, configurable window, and let an operator get it back.

Before this, ``app/routers/upload.py`` threw the uploaded bytes away the
moment parsing finished (only ``sessions.raw_filename`` -- the NAME -- ever
reached the DB). That means a later parser fix could never be re-applied to
a past upload, and an operator who lost their own copy had no way to
recover it.

The property this file exists to prove, beyond "a file gets saved", is that
a caller can always tell WHY a raw file is unavailable -- three completely
different situations must never collapse into one undifferentiated "no
file" answer (see ``app.services.raw_file_storage.RawFileStatus``):

1. ``none``    -- the session predates this feature (or its store failed at
                  upload time); there was never anything to lose.
2. ``expired`` -- retention closed and it was swept; the readings/calls the
                  session already produced are untouched.
3. ``missing`` -- an anomaly: the DB says it should be there and it isn't.

There is no background scheduler in this app (``cleanup_sessions_older_than``
is itself dead code, never invoked automatically) and none is introduced
here either -- expiry is swept opportunistically from the read paths that
already enumerate sessions.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UnifiedData, WellCycleData

FIXTURES = Path(__file__).parent / "fixtures" / "import"


# ---------------------------------------------------------------------------
# Full-stack fixture: real TestClient, real temp DB + raw-file storage dir.
# ---------------------------------------------------------------------------


@pytest.fixture
def raw_file_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-raw-file-tests",
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
    from app.routers import import_api, sample, upload
    from app.services import raw_file_storage

    user = SimpleNamespace(
        value=TokenData(user_id="user-1", username="user1", role="user")
    )

    async def current_user_override():
        return user.value

    app.dependency_overrides[get_current_user] = current_user_override

    with TestClient(app) as client:
        conn = db.get_db()
        for user_id, username in (
            ("user-1", "raw-user-1"),
            ("someone-else", "raw-user-2"),
        ):
            conn.execute(
                "INSERT OR IGNORE INTO users (id, username, hashed_password, display_name, role) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, username, "x", username, "user"),
            )
        conn.commit()
        yield SimpleNamespace(
            client=client,
            upload=upload,
            sample=sample,
            import_api=import_api,
            raw_file_storage=raw_file_storage,
            db=db,
            user=user,
            tmp_path=tmp_path,
        )

    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    import_api.preview_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _fake_unified() -> UnifiedData:
    """A minimal, genuinely valid UnifiedData -- db.save_session() (run for
    real by these tests, unlike test_upload_limits.py's mocked-DB unit
    tests) reads many of its fields."""
    return UnifiedData(
        instrument="QuantStudio",
        allele2_dye="VIC",
        wells=["A1"],
        cycles=[1, 2, 3],
        data=[
            WellCycleData(
                well="A1", cycle=cycle, fam=100.0 + cycle, allele2=50.0 + cycle
            )
            for cycle in [1, 2, 3]
        ],
        has_rox=True,
    )


def _upload_bytes(
    client: TestClient, content: bytes, filename: str = "plate.xls"
) -> dict:
    """Real multipart POST to /api/upload -- only the parser is mocked, so
    the temp-file lifecycle and raw-file storage wiring run for real."""
    with patch("app.routers.upload.detect_and_parse", return_value=_fake_unified()):
        response = client.post(
            "/api/upload",
            files={"file": (filename, content, "application/vnd.ms-excel")},
        )
    assert response.status_code == 200, response.text
    return response.json()


def _expire_now(rc, sid: str) -> None:
    """Simulate the retention window having already closed."""
    conn = rc.db.get_db()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    conn.execute(
        "UPDATE session_raw_files SET expires_at = ? WHERE session_id = ?", (past, sid)
    )
    conn.commit()


def _stored_path_on_disk(rc, sid: str) -> Path:
    row = rc.db.get_raw_file_record(sid)
    assert row is not None
    return rc.raw_file_storage._raw_file_dir() / row["stored_path"]


# ---------------------------------------------------------------------------
# 1. Upload stores the original bytes; download returns them byte-identical.
# ---------------------------------------------------------------------------


def test_upload_stores_raw_file_and_download_roundtrips_exact_bytes(raw_file_client):
    rc = raw_file_client
    content = b"\x00binary plate export bytes\xffwith odd values\x01\x02"

    body = _upload_bytes(rc.client, content, filename="plate.xls")
    sid = body["session_id"]

    status = rc.client.get(f"/api/sessions/{sid}/raw-file")
    assert status.status_code == 200
    payload = status.json()
    assert payload["status"] == "available"
    assert payload["original_filename"] == "plate.xls"
    assert payload["size_bytes"] == len(content)
    assert payload["sha256"] == hashlib.sha256(content).hexdigest()
    assert payload["expires_at"] is not None
    assert payload["deleted_at"] is None

    download = rc.client.get(f"/api/sessions/{sid}/raw-file/download")
    assert download.status_code == 200
    assert download.content == content
    assert "plate.xls" in download.headers["content-disposition"]


def test_expires_at_is_in_the_future_right_after_upload_so_it_can_be_shown_ahead_of_time(
    raw_file_client,
):
    """Expiry must be visible BEFORE deletion, not discovered after the fact."""
    rc = raw_file_client
    body = _upload_bytes(rc.client, b"some plate bytes")
    sid = body["session_id"]

    payload = rc.client.get(f"/api/sessions/{sid}/raw-file").json()
    expires_at = datetime.fromisoformat(payload["expires_at"])
    assert expires_at > datetime.now(timezone.utc)


def test_retention_window_is_configurable(raw_file_client, monkeypatch):
    rc = raw_file_client
    monkeypatch.setattr(rc.raw_file_storage, "RAW_FILE_RETENTION_DAYS", 1)

    body = _upload_bytes(rc.client, b"short retention plate")
    sid = body["session_id"]

    payload = rc.client.get(f"/api/sessions/{sid}/raw-file").json()
    stored_at = datetime.fromisoformat(payload["stored_at"])
    expires_at = datetime.fromisoformat(payload["expires_at"])
    assert timedelta(hours=23) < (expires_at - stored_at) < timedelta(hours=25)


# ---------------------------------------------------------------------------
# 2. Ownership: nobody but the session's own user can read or download it.
# ---------------------------------------------------------------------------


def test_other_users_session_raw_file_is_denied(raw_file_client):
    rc = raw_file_client
    body = _upload_bytes(rc.client, b"owner-only bytes")
    sid = body["session_id"]

    rc.user.value = TokenData(
        user_id="someone-else", username="raw-user-2", role="user"
    )
    try:
        status = rc.client.get(f"/api/sessions/{sid}/raw-file")
        download = rc.client.get(f"/api/sessions/{sid}/raw-file/download")
    finally:
        rc.user.value = TokenData(user_id="user-1", username="raw-user-1", role="user")

    assert status.status_code == 403
    assert download.status_code == 403


# ---------------------------------------------------------------------------
# 3. The three distinct "not available" states.
# ---------------------------------------------------------------------------


def test_legacy_session_with_no_raw_file_record_reports_none_and_does_not_break(
    raw_file_client,
):
    """A session created before this feature existed has NO row at all --
    this must not be confused with a file that expired."""
    rc = raw_file_client
    sid = "legacy-session-1"
    conn = rc.db.get_db()
    conn.execute(
        "INSERT INTO sessions (session_id, instrument, num_wells, num_cycles, allele2_dye, raw_filename, user_id) "
        "VALUES (?, 'QuantStudio', 1, 2, 'VIC', 'old-plate.eds', 'user-1')",
        (sid,),
    )
    conn.commit()

    status = rc.client.get(f"/api/sessions/{sid}/raw-file")
    assert status.status_code == 200
    payload = status.json()
    assert payload["status"] == "none"
    assert payload["expires_at"] is None
    assert payload["deleted_at"] is None

    download = rc.client.get(f"/api/sessions/{sid}/raw-file/download")
    assert download.status_code == 404
    assert download.json()["detail"]["status"] == "none"

    # Existing list/detail endpoints must keep working for a session that
    # simply has no raw file -- this is the routine, unremarkable case.
    listed = rc.client.get("/api/sessions").json()
    row = next(r for r in listed if r["session_id"] == sid)
    assert row["raw_filename"] == "old-plate.eds"
    assert row["raw_file"]["status"] == "none"


def test_expired_raw_file_is_swept_and_reported_distinctly_readings_survive(
    raw_file_client,
):
    rc = raw_file_client
    body = _upload_bytes(rc.client, b"will expire soon")
    sid = body["session_id"]
    on_disk = _stored_path_on_disk(rc, sid)
    assert on_disk.exists()

    _expire_now(rc, sid)

    status = rc.client.get(f"/api/sessions/{sid}/raw-file")
    payload = status.json()
    assert payload["status"] == "expired"
    # Historical metadata survives the sweep so the UI can still say what it
    # was and when it disappeared -- only the bytes are gone.
    assert payload["original_filename"] == "plate.xls"
    assert payload["deleted_at"] is not None
    assert not on_disk.exists()

    download = rc.client.get(f"/api/sessions/{sid}/raw-file/download")
    assert download.status_code == 410
    assert download.json()["detail"]["status"] == "expired"

    # The session's own parsed data must be completely unaffected.
    detail = rc.client.get(f"/api/sessions/{sid}").json()
    assert detail["instrument"] == "QuantStudio"
    assert detail["well_ids"] == ["A1"]
    assert detail["raw_file"]["status"] == "expired"


def test_missing_raw_file_is_an_anomaly_distinct_from_expired_and_none(
    raw_file_client, caplog
):
    """The DB row says the file should still be there (not expired) but the
    bytes are gone from disk -- this must show up as its own state, not be
    silently relabelled 'expired' or 'none'."""
    rc = raw_file_client
    body = _upload_bytes(rc.client, b"will vanish unexpectedly")
    sid = body["session_id"]
    on_disk = _stored_path_on_disk(rc, sid)
    on_disk.unlink()

    import logging

    with caplog.at_level(logging.WARNING, logger="app.services.raw_file_storage"):
        status = rc.client.get(f"/api/sessions/{sid}/raw-file")

    payload = status.json()
    assert payload["status"] == "missing"
    assert payload["deleted_at"] is None
    assert payload["expires_at"] is not None
    assert any(sid in record.getMessage() for record in caplog.records)

    download = rc.client.get(f"/api/sessions/{sid}/raw-file/download")
    assert download.status_code == 404
    assert download.json()["detail"]["status"] == "missing"


def test_storage_failure_never_blocks_the_upload(raw_file_client, caplog, monkeypatch):
    """Raw-file retention is a convenience layered on an already-persisted
    session -- a storage fault here must not fail the upload."""
    rc = raw_file_client
    blocked = rc.tmp_path / "blocked-raw-dir"
    blocked.write_text("a plain file sits where a directory is expected")
    monkeypatch.setenv("RAW_FILE_DIR", str(blocked))

    import logging

    with caplog.at_level(logging.ERROR, logger="app.services.raw_file_storage"):
        body = _upload_bytes(rc.client, b"upload must still succeed")

    assert body["instrument"] == "QuantStudio"
    sid = body["session_id"]

    status = rc.client.get(f"/api/sessions/{sid}/raw-file")
    assert status.json()["status"] == "none"
    assert any(sid in record.getMessage() for record in caplog.records)

    # The session itself is fully usable despite the storage failure.
    detail = rc.client.get(f"/api/sessions/{sid}").json()
    assert detail["instrument"] == "QuantStudio"


# ---------------------------------------------------------------------------
# 4. Session deletion takes the raw file with it.
# ---------------------------------------------------------------------------


def test_deleting_a_session_deletes_its_raw_file_directory(raw_file_client):
    rc = raw_file_client
    body = _upload_bytes(rc.client, b"deleted along with its session")
    sid = body["session_id"]
    session_dir = rc.raw_file_storage._raw_file_dir() / sid
    assert session_dir.exists()

    response = rc.client.delete(f"/api/sessions/{sid}")
    assert response.status_code == 200
    assert not session_dir.exists()


# ---------------------------------------------------------------------------
# 5. GET /api/sessions and GET /api/sessions/{sid} surface the same status.
# ---------------------------------------------------------------------------


def test_session_list_includes_per_row_raw_file_status(raw_file_client):
    rc = raw_file_client
    with_file = _upload_bytes(rc.client, b"has a raw file")["session_id"]

    conn = rc.db.get_db()
    conn.execute(
        "INSERT INTO sessions (session_id, instrument, num_wells, num_cycles, allele2_dye, raw_filename, user_id) "
        "VALUES ('legacy-2', 'QuantStudio', 1, 2, 'VIC', 'old.eds', 'user-1')"
    )
    conn.commit()

    rows = {row["session_id"]: row for row in rc.client.get("/api/sessions").json()}
    assert rows[with_file]["raw_file"]["status"] == "available"
    assert rows["legacy-2"]["raw_file"]["status"] == "none"


# ---------------------------------------------------------------------------
# 6. The import/preview + import/parse path (preview-required extensions)
#    also persists the raw file, not just the direct /api/upload path.
# ---------------------------------------------------------------------------


def test_import_parse_flow_also_persists_the_raw_file(raw_file_client):
    rc = raw_file_client
    csv_path = FIXTURES / "generic_wide" / "wt_mt.csv"
    mapping_payload = json.loads(
        (FIXTURES / "generic_wide" / "wt_mt.mapping.json").read_text()
    )
    mapping = {
        "assay_mode": "wt_mt",
        "normalization_mode": "none",
        "channel_roles": dict(mapping_payload["channels"]),
        "well_column": "well",
        "cycle_column": "cycle",
        "sample_column": "sample",
        "target_column": "target",
        "rfu_columns": {channel: channel for channel in mapping_payload["channels"]},
    }
    original_bytes = csv_path.read_bytes()

    with csv_path.open("rb") as handle:
        preview_response = rc.client.post(
            "/api/import/preview",
            files={"file": (csv_path.name, handle, "text/csv")},
        )
    assert preview_response.status_code == 200, preview_response.text
    preview_id = preview_response.json()["preview_id"]

    parse_response = rc.client.post(
        "/api/import/parse",
        json={"preview_id": preview_id, "mapping": mapping},
    )
    assert parse_response.status_code == 200, parse_response.text
    sid = parse_response.json()["session_id"]

    status = rc.client.get(f"/api/sessions/{sid}/raw-file").json()
    assert status["status"] == "available"
    assert status["original_filename"] == "wt_mt.csv"
    assert status["sha256"] == hashlib.sha256(original_bytes).hexdigest()

    download = rc.client.get(f"/api/sessions/{sid}/raw-file/download")
    assert download.status_code == 200
    assert download.content == original_bytes


# ---------------------------------------------------------------------------
# 7. Migration regression: an existing DB (schema version 9, pre-P32) must
#    gain the new table without disturbing any session already in it. Never
#    touches the real production DB -- this reproduces its SCHEMA only.
# ---------------------------------------------------------------------------


def test_migration_10_adds_session_raw_files_without_touching_existing_sessions(
    tmp_path,
):
    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "pre-p32.sqlite3"

    try:
        # 1. Build a DB exactly as it would have existed right before this
        #    migration: run the full (post-P32) schema, then tear back down
        #    to "as if migration 10 had never run" -- drop the new table and
        #    its schema_version stamp -- while keeping a real session and its
        #    readings, exactly what a production DB would have.
        db.init_db()
        conn = db.get_db()
        conn.execute("DROP TABLE session_raw_files")
        conn.execute("DELETE FROM schema_version WHERE version = 10")
        conn.execute(
            "INSERT INTO sessions (session_id, instrument, num_wells, num_cycles, allele2_dye, raw_filename, user_id) "
            "VALUES ('pre-existing-1', 'QuantStudio', 1, 1, 'VIC', 'old.eds', NULL)"
        )
        conn.execute(
            "INSERT INTO well_cycle_data (session_id, well, cycle, fam, allele2) VALUES "
            "('pre-existing-1', 'A1', 1, 123.0, 45.0)"
        )
        conn.commit()
        assert db._get_schema_version(conn) == 9

        # 2. Re-run exactly what app startup does.
        db.init_db()

        # 3. The new table exists and is usable...
        conn = db.get_db()
        assert (
            conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='session_raw_files'"
            ).fetchone()
            is not None
        )
        assert db._get_schema_version(conn) == 10

        # ...and the pre-existing session/reading are completely untouched.
        session_row = conn.execute(
            "SELECT * FROM sessions WHERE session_id = 'pre-existing-1'"
        ).fetchone()
        assert session_row["instrument"] == "QuantStudio"
        assert session_row["raw_filename"] == "old.eds"
        reading_row = conn.execute(
            "SELECT * FROM well_cycle_data WHERE session_id = 'pre-existing-1'"
        ).fetchone()
        assert reading_row["fam"] == 123.0

        # ...and that session correctly has NO raw file record (legacy, not
        # expired) rather than any synthesized/back-filled row.
        assert db.get_raw_file_record("pre-existing-1") is None
    finally:
        if db._conn is not None:
            db._conn.close()
        db._conn = None
