"""Periodic housekeeping, the per-user analysis cap and the size-bounded cache.

* each cleanup step is tested against temp dirs / DB rows with a frozen clock;
* a step that fails must not stop the others;
* interval 0 means no background task, any other value starts and cancels one;
* a user at the cap is refused (409) before any file is parsed;
* the warm session cache is also bounded by the number of stored readings;
* the old static UI is gone and the React build is what is served.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.models import UnifiedData, WellCycleData
from app.services import maintenance

# Reused full-stack fixture and helpers (real TestClient, temp DB, temp storage).
from test_raw_file_retention import (  # noqa: F401
    FIXTURES,
    _fake_unified,
    _upload_bytes,
    raw_file_client,
)

NOW = 1_800_000_000.0
HOUR = 3600.0


@pytest.fixture
def fresh_db(tmp_path):
    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "maintenance.sqlite3"
    db.init_db()
    conn = db.get_db()
    for user_id in ("user-1", "user-2"):
        conn.execute(
            "INSERT INTO users (id, username, hashed_password, display_name, role) "
            "VALUES (?, ?, 'x', ?, 'user')",
            (user_id, user_id, user_id),
        )
    conn.commit()
    yield db
    if db._conn is not None:
        db._conn.close()
    db._conn = None


def _freeze(monkeypatch, now: float = NOW) -> None:
    monkeypatch.setattr(time, "time", lambda: now)


# ---------------------------------------------------------------------------
# (a) expired import previews
# ---------------------------------------------------------------------------


def test_expired_previews_and_their_files_are_removed(tmp_path, monkeypatch):
    from app.routers import import_api

    _freeze(monkeypatch)
    old_file = tmp_path / "old.csv"
    fresh_file = tmp_path / "fresh.csv"
    old_file.write_text("a")
    fresh_file.write_text("b")

    def record(pid: str, path: Path, expires_at: float):
        return import_api.PreviewRecord(
            preview_id=pid,
            owner_user_id="user-1",
            file_path=path,
            filename=path.name,
            parser_id="x",
            expires_at=expires_at,
        )

    monkeypatch.setattr(
        import_api,
        "preview_store",
        {
            "old": record("old", old_file, NOW - 1),
            "fresh": record("fresh", fresh_file, NOW + 600),
        },
    )

    assert maintenance.remove_expired_previews() == 1
    assert "old" not in import_api.preview_store
    assert "fresh" in import_api.preview_store
    assert not old_file.exists()
    assert fresh_file.exists()


# ---------------------------------------------------------------------------
# (b) feedback screenshots that were never attached to a report
# ---------------------------------------------------------------------------


def test_only_old_unattached_feedback_attachments_are_removed(fresh_db):
    conn = fresh_db.get_db()
    conn.execute(
        "INSERT INTO user_feedback (id, owner_user_id, category, title, body) "
        "VALUES ('fb-1', 'user-1', 'bug', 'title', 'body')"
    )

    def attach(att_id: str, feedback_id: str | None, age_hours: int) -> None:
        conn.execute(
            "INSERT INTO user_feedback_attachments "
            "(id, feedback_id, owner_user_id, filename, mime_type, size_bytes, content, created_at) "
            "VALUES (?, ?, 'user-1', 'a.png', 'image/png', 1, x'00', datetime('now', ?))",
            (att_id, feedback_id, f"-{age_hours} hours"),
        )

    attach("old-orphan", None, 30)
    attach("new-orphan", None, 2)
    attach("old-linked", "fb-1", 30)
    conn.commit()

    assert maintenance.remove_orphan_feedback_attachments() == 1

    remaining = {r[0] for r in conn.execute("SELECT id FROM user_feedback_attachments")}
    assert remaining == {"new-orphan", "old-linked"}


# ---------------------------------------------------------------------------
# (c) stored copies of uploaded files past their retention window
# ---------------------------------------------------------------------------


def test_expired_raw_copies_are_removed_but_sessions_stay(raw_file_client):
    rc = raw_file_client
    expired = _upload_bytes(rc.client, b"old bytes", filename="old.xls")["session_id"]
    kept = _upload_bytes(rc.client, b"new bytes", filename="new.xls")["session_id"]
    old_path = rc.raw_file_storage._raw_file_dir() / rc.db.get_raw_file_record(expired)["stored_path"]
    new_path = rc.raw_file_storage._raw_file_dir() / rc.db.get_raw_file_record(kept)["stored_path"]

    conn = rc.db.get_db()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    conn.execute("UPDATE session_raw_files SET expires_at = ? WHERE session_id = ?", (past, expired))
    conn.commit()

    assert maintenance.remove_expired_raw_files() == 1

    assert not old_path.exists()
    assert new_path.exists()
    # Both analyses are still there.
    count = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE session_id IN (?, ?)", (expired, kept)
    ).fetchone()[0]
    assert count == 2


# ---------------------------------------------------------------------------
# (d) leftover temp files created by the app itself
# ---------------------------------------------------------------------------


def _touch(path: Path, mtime: float) -> None:
    if path.is_dir():
        (path / "inner.txt").write_text("x")
    else:
        path.write_text("x")
    os.utime(path, (mtime, mtime))


def test_only_old_known_prefix_temp_entries_are_removed(tmp_path):
    old = NOW - 7 * HOUR
    recent = NOW - 1 * HOUR

    old_upload = tmp_path / "qprism_upload_abc.xls"
    old_fixed = tmp_path / "cfx_fixed_abc.xlsx"
    old_dir = tmp_path / "cfx_xml_abc"
    old_dir.mkdir()
    recent_upload = tmp_path / "qprism_upload_new.xls"
    other_old = tmp_path / "somebody_elses_file.tmp"
    for path in (old_upload, old_fixed, old_dir):
        _touch(path, old)
    _touch(recent_upload, recent)
    _touch(other_old, old)
    link = tmp_path / "qprism_upload_link"
    link.symlink_to(other_old)

    protected = tmp_path / "qprism_upload_inuse.xls"
    _touch(protected, old)

    removed = maintenance.remove_stale_temp_files(
        temp_dir=tmp_path, now=NOW, protected={str(protected)}
    )

    assert removed == 3
    assert not old_upload.exists() and not old_fixed.exists() and not old_dir.exists()
    assert recent_upload.exists()
    assert other_old.exists()  # not one of our prefixes
    assert link.is_symlink() and other_old.exists()
    assert protected.exists()  # a live preview still uses it


def test_temp_sweep_uses_the_frozen_clock_by_default(tmp_path, monkeypatch):
    _freeze(monkeypatch)
    stale = tmp_path / "cfx_fixed_x.xlsx"
    _touch(stale, NOW - 6 * HOUR - 5)
    young = tmp_path / "cfx_fixed_y.xlsx"
    _touch(young, NOW - 6 * HOUR + 60)

    assert maintenance.remove_stale_temp_files(temp_dir=tmp_path) == 1
    assert young.exists() and not stale.exists()


def test_uploads_are_spooled_with_the_known_prefix():
    from app.routers.upload import UPLOAD_TEMP_PREFIX

    assert UPLOAD_TEMP_PREFIX in maintenance.TEMP_PREFIXES


# ---------------------------------------------------------------------------
# Runner: every step logs, a failing step does not stop the others
# ---------------------------------------------------------------------------


def test_run_maintenance_reports_counts_and_survives_a_failing_step(monkeypatch, caplog):
    monkeypatch.setattr(maintenance, "remove_expired_previews", lambda: 2)

    def boom() -> int:
        raise RuntimeError("disk problem")

    monkeypatch.setattr(maintenance, "remove_orphan_feedback_attachments", boom)
    monkeypatch.setattr(maintenance, "remove_expired_raw_files", lambda: 5)
    monkeypatch.setattr(maintenance, "remove_stale_temp_files", lambda **_: 7)

    with caplog.at_level(logging.INFO, logger=maintenance.logger.name):
        results = asyncio.run(maintenance.run_maintenance())

    assert results == {
        "expired_previews": 2,
        "orphan_attachments": 0,
        "expired_raw_files": 5,
        "temp_files": 7,
    }
    messages = [r.getMessage() for r in caplog.records]
    assert any("expired previews removed 2" in m for m in messages)
    assert any("orphan feedback attachments failed" in m for m in messages)
    assert any("stale temp files removed 7" in m for m in messages)


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------


def test_interval_zero_starts_no_task(monkeypatch):
    monkeypatch.setenv("SNP_MAINTENANCE_INTERVAL_SECONDS", "0")

    async def scenario():
        return maintenance.start_maintenance_task()

    assert asyncio.run(scenario()) is None


def test_default_interval_is_one_hour(monkeypatch):
    from app.config import maintenance_interval_seconds

    monkeypatch.delenv("SNP_MAINTENANCE_INTERVAL_SECONDS", raising=False)
    assert maintenance_interval_seconds() == 3600


def test_task_runs_periodically_and_is_cancelled_cleanly(monkeypatch):
    monkeypatch.setenv("SNP_MAINTENANCE_INTERVAL_SECONDS", "1")
    monkeypatch.setattr(maintenance, "FIRST_RUN_DELAY_SECONDS", 0)
    runs: list[int] = []

    async def fake_run() -> dict:
        runs.append(1)
        return {}

    monkeypatch.setattr(maintenance, "run_maintenance", fake_run)

    async def scenario():
        task = maintenance.start_maintenance_task()
        assert task is not None
        await asyncio.sleep(0.05)
        assert runs, "first run happens right after the initial delay"
        await maintenance.stop_maintenance_task(task)
        assert task.cancelled() or task.done()

    asyncio.run(scenario())


def test_app_lifespan_starts_and_stops_the_task(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    import app.db as db

    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-that-is-long-enough-for-maintenance-tests")
    monkeypatch.setenv("ADMIN_PASSWORD", "StrongerOperatorPassword123!")
    monkeypatch.setenv("SNP_AUTH_MODE", "local")
    monkeypatch.setenv("SNP_MAINTENANCE_INTERVAL_SECONDS", "3600")
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "lifespan.sqlite3")

    started: list[asyncio.Task] = []
    real_start = maintenance.start_maintenance_task

    def spy():
        task = real_start()
        started.append(task)
        return task

    monkeypatch.setattr(maintenance, "start_maintenance_task", spy)
    from app.main import app

    try:
        with TestClient(app):
            assert started and started[0] is not None
            assert not started[0].done()
        assert started[0].done()
    finally:
        if db._conn is not None:
            db._conn.close()
        db._conn = None


# ---------------------------------------------------------------------------
# Per-user analysis cap
# ---------------------------------------------------------------------------


def _insert_sessions(rc, count: int, user_id: str = "user-1") -> None:
    for i in range(count):
        rc.db.save_session(f"cap-{user_id}-{i}", _fake_unified(), filename="x.xls", user_id=user_id)


def test_default_cap_is_one_thousand(monkeypatch):
    from app.config import max_sessions_per_user

    monkeypatch.delenv("SNP_MAX_SESSIONS_PER_USER", raising=False)
    assert max_sessions_per_user() == 1000


def test_upload_at_the_cap_is_refused_before_parsing(raw_file_client, monkeypatch):
    rc = raw_file_client
    monkeypatch.setenv("SNP_MAX_SESSIONS_PER_USER", "3")
    _insert_sessions(rc, 3)

    def must_not_parse(*_args, **_kwargs):
        raise AssertionError("the file must not be parsed once the cap is reached")

    monkeypatch.setattr("app.routers.upload.detect_and_parse", must_not_parse)

    response = rc.client.post(
        "/api/upload",
        files={"file": ("plate.xls", b"bytes", "application/vnd.ms-excel")},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "You have reached the limit of 3 saved analyses. Delete older analyses to upload more."
    )


def test_cap_counts_each_user_separately_and_frees_up_after_delete(raw_file_client, monkeypatch):
    rc = raw_file_client
    monkeypatch.setenv("SNP_MAX_SESSIONS_PER_USER", "2")
    _insert_sessions(rc, 2, user_id="someone-else")
    _insert_sessions(rc, 1)

    # user-1 has one analysis, so one more is fine even though others are full.
    _upload_bytes(rc.client, b"fits under the cap")

    refused = rc.client.post(
        "/api/upload",
        files={"file": ("plate.xls", b"bytes", "application/vnd.ms-excel")},
    )
    assert refused.status_code == 409

    deleted = rc.client.delete("/api/sessions/cap-user-1-0")
    assert deleted.status_code == 200
    _upload_bytes(rc.client, b"fits again")


def test_import_preview_and_parse_and_examples_respect_the_cap(raw_file_client, monkeypatch):
    rc = raw_file_client
    monkeypatch.setenv("SNP_MAX_SESSIONS_PER_USER", "1")
    _insert_sessions(rc, 1)

    preview = rc.client.post(
        "/api/import/preview",
        files={"file": ("plate.csv", b"a,b\n1,2\n", "text/csv")},
    )
    assert preview.status_code == 409

    mapping_payload = json.loads(
        (FIXTURES / "generic_wide" / "wt_mt.mapping.json").read_text()
    )
    mapping = {
        "assay_mode": "wt_mt",
        "normalization_mode": "none",
        "channel_roles": dict(mapping_payload["channels"]),
        "well_column": "well",
        "cycle_column": "cycle",
        "rfu_columns": {channel: channel for channel in mapping_payload["channels"]},
    }
    parse = rc.client.post("/api/import/parse", json={"preview_id": "nope", "mapping": mapping})
    assert parse.status_code == 409

    example = rc.client.post("/api/examples", json={"ploidy": 2})
    assert example.status_code == 409


def test_admin_is_not_exempt(monkeypatch):
    from fastapi import HTTPException
    from app.services import import_session

    monkeypatch.setenv("SNP_MAX_SESSIONS_PER_USER", "1")
    monkeypatch.setattr(import_session.db, "count_user_sessions", lambda user_id: 1)
    with pytest.raises(HTTPException) as exc:
        import_session.ensure_session_capacity("admin-user")
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# Session cache: bounded by readings as well as by entry count
# ---------------------------------------------------------------------------


def _plate(points: int) -> UnifiedData:
    return UnifiedData(
        instrument="QuantStudio",
        allele2_dye="VIC",
        wells=["A1"],
        cycles=list(range(points)),
        data=[WellCycleData(well="A1", cycle=c, fam=1.0, allele2=1.0) for c in range(points)],
    )


@pytest.fixture
def cache(monkeypatch):
    from app.routers import upload
    from app.services import session_restore

    upload.sessions.clear()
    session_restore._access_order.clear()
    monkeypatch.setattr(session_restore, "SESSION_CACHE_MAX_ENTRIES", 100)
    yield SimpleNamespace(sessions=upload.sessions, restore=session_restore)
    upload.sessions.clear()
    session_restore._access_order.clear()


def _add(cache, sid: str, points: int) -> None:
    cache.sessions[sid] = _plate(points)
    cache.restore.touch_session(sid)


def test_cache_evicts_least_recently_used_until_under_the_points_budget(cache, monkeypatch):
    monkeypatch.setattr(cache.restore, "SESSION_CACHE_MAX_POINTS", 100)
    _add(cache, "a", 40)
    _add(cache, "b", 40)
    cache.restore.touch_session("a")  # b is now the least recently used
    _add(cache, "c", 40)

    assert set(cache.sessions) == {"a", "c"}
    assert list(cache.restore._access_order) == ["a", "c"]


def test_cache_keeps_the_newest_entry_even_if_it_alone_exceeds_the_budget(cache, monkeypatch):
    monkeypatch.setattr(cache.restore, "SESSION_CACHE_MAX_POINTS", 10)
    _add(cache, "small", 5)
    _add(cache, "big", 50)

    assert set(cache.sessions) == {"big"}


def test_cache_budget_never_evicts_in_flight_sessions(cache, monkeypatch):
    from app.processing.analysis_state import PublicationState, publication_states

    monkeypatch.setattr(cache.restore, "SESSION_CACHE_MAX_POINTS", 50)
    _add(cache, "busy", 40)
    publication_states["busy"] = PublicationState(owner=cache.sessions["busy"], pending=True)
    try:
        _add(cache, "other", 40)
        assert "busy" in cache.sessions and "other" in cache.sessions
    finally:
        publication_states.pop("busy", None)


def test_cache_within_budget_is_untouched(cache, monkeypatch):
    monkeypatch.setattr(cache.restore, "SESSION_CACHE_MAX_POINTS", 1000)
    for sid in ("a", "b", "c"):
        _add(cache, sid, 10)
    assert set(cache.sessions) == {"a", "b", "c"}


def test_default_points_budget():
    from app.config import SESSION_CACHE_MAX_POINTS

    assert SESSION_CACHE_MAX_POINTS == 20_000_000


# ---------------------------------------------------------------------------
# The old static UI is gone
# ---------------------------------------------------------------------------


def test_legacy_ui_files_and_switch_are_gone():
    app_dir = Path(__file__).resolve().parents[1] / "app"
    assert not (app_dir / "static").exists()
    assert "USE_LEGACY" not in (app_dir / "main.py").read_text()


def test_old_static_paths_are_not_served(raw_file_client):
    client = raw_file_client.client
    for path in ("/js/app.js", "/css/style.css", "/js/scatter.js"):
        response = client.get(path)
        assert response.status_code == 404 or "text/html" in response.headers.get("content-type", "")
        assert "function " not in response.text[:200]
